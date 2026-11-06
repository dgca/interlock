import {
  ExternalInputConflict,
  InterlockError,
  assertContract,
  externalInputMutationSchema,
  externalInputStatusSchema,
  type ExternalInputMutation,
  type ExternalInputStatusQuery,
  type Json,
  type NodeExecution,
  type Run,
  type WorkflowNode,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { fingerprint } from './versionIdentity.js';

type InputNode = Extract<WorkflowNode, { kind: 'input' }>;
type InputTarget = { runId: string; executionId: string };
type SubmissionReceipt = InputTarget & {
  revision: number;
  submittedAt: string;
};
type SavedReceipt = SubmissionReceipt & { id: string; valueHash: string };
type PendingValue = { id: string; runId: string; value: Json };

export class ExternalInputs {
  constructor(
    private store: Store,
    private engine: {
      run(id: string): Run;
      node(run: Run, execution: NodeExecution): InputNode;
      complete(
        run: Run,
        execution: NodeExecution,
        node: InputNode,
        value: Json,
      ): void;
      save(run: Run): void;
      event(run: Run, type: string, message: string): void;
      pump(): void;
    },
  ) {}

  status(query: ExternalInputStatusQuery) {
    const { runId, executionId, includeValue } =
      externalInputStatusSchema.parse(query);
    const run = this.engine.run(runId);
    const hold = run.externalInputHold ?? { revision: 0 };
    const heldByRunId = this.store.externalInputHoldOwner(runId);
    if (executionId === undefined) return { runId, hold, heldByRunId };
    const execution = this.execution(run, executionId);
    const {
      revision = 0,
      submittedAt,
      acceptedAt,
    } = execution.externalInput ?? {};
    const pending =
      includeValue && execution.status === 'waiting'
        ? this.pending(run, execution)
        : undefined;
    return {
      runId,
      executionId,
      state: execution.status,
      waitingSince: execution.startedAt,
      revision,
      submittedAt,
      acceptance:
        acceptedAt && submittedAt
          ? { runId, executionId, revision, submittedAt, acceptedAt }
          : undefined,
      hold,
      heldByRunId: execution.status === 'waiting' ? heldByRunId : undefined,
      ...(pending ? { value: pending.value } : {}),
    };
  }

  mutate(input: ExternalInputMutation) {
    const request = externalInputMutationSchema.parse(input);
    let advanced = false;
    const result = this.store.transaction(() => {
      const run = this.engine.run(request.runId);
      if (request.action === 'hold' || request.action === 'release')
        return this.changeHold(
          run,
          request.action === 'hold',
          request.expectedRevision,
        );
      const execution = this.execution(run, request.executionId);
      if (request.action === 'submit')
        return this.submit(run, execution, request);
      const accepted = this.accept(run, execution, request.expectedRevision);
      advanced = accepted.advanced;
      return accepted.receipt;
    });
    if (advanced) this.engine.pump();
    return result;
  }

  private execution(run: Run, id: string): NodeExecution {
    const execution = run.executions.find((candidate) => candidate.id === id);
    if (execution?.kind !== 'input')
      throw new InterlockError(
        'External-input execution not found in this run',
      );
    return execution;
  }

  private waiting(run: Run, execution: NodeExecution) {
    if (
      run.status !== 'waiting' ||
      execution.status !== 'waiting' ||
      run.executions.at(-1)?.id !== execution.id
    )
      throw new InterlockError('External-input execution is no longer waiting');
  }

  private pending(run: Run, execution: NodeExecution) {
    const pending = this.store.get<PendingValue>(
      'externalInputValues',
      execution.id,
    );
    return pending?.runId === run.id ? pending : undefined;
  }

  private submit(
    run: Run,
    execution: NodeExecution,
    request: Extract<ExternalInputMutation, { action: 'submit' }>,
  ) {
    const id = fingerprint([run.id, execution.id, request.requestId]);
    const valueHash = fingerprint(request.value);
    const saved = this.store.get<SavedReceipt>('externalInputReceipts', id);
    if (saved) {
      if (saved.valueHash !== valueHash)
        throw new ExternalInputConflict(
          'External-input requestId already used with a different value',
        );
      const { runId, executionId, revision, submittedAt } = saved;
      return { runId, executionId, revision, submittedAt };
    }
    this.waiting(run, execution);
    const revision = execution.externalInput?.revision ?? 0;
    if (
      request.expectedRevision !== undefined &&
      request.expectedRevision !== revision
    )
      throw new ExternalInputConflict('External-input revision conflict');
    assertContract(
      this.engine.node(run, execution).outputSchema,
      request.value,
      'Submitted value',
      { ownProperties: true },
    );
    const receipt = {
      runId: run.id,
      executionId: execution.id,
      revision: revision + 1,
      submittedAt: new Date().toISOString(),
    };
    this.store.put('externalInputReceipts', { id, valueHash, ...receipt });
    this.store.put('externalInputValues', {
      id: execution.id,
      runId: run.id,
      value: request.value,
    });
    execution.externalInput = {
      revision: receipt.revision,
      submittedAt: receipt.submittedAt,
    };
    this.engine.save(run);
    this.engine.event(
      run,
      'external_input.submitted',
      `${execution.label}: revision ${receipt.revision} submitted`,
    );
    return receipt;
  }

  private accept(run: Run, execution: NodeExecution, expectedRevision: number) {
    const metadata = execution.externalInput;
    if (metadata?.revision !== expectedRevision || !metadata.submittedAt)
      throw new ExternalInputConflict('External-input revision conflict');
    const receipt = {
      runId: run.id,
      executionId: execution.id,
      revision: metadata.revision,
      submittedAt: metadata.submittedAt,
      acceptedAt: metadata.acceptedAt ?? new Date().toISOString(),
    };
    if (metadata.acceptedAt) return { receipt, advanced: false };
    this.waiting(run, execution);
    if (this.store.externalInputHoldOwner(run.id))
      throw new ExternalInputConflict('External-input acceptance is on hold');
    const pending = this.pending(run, execution);
    if (!pending)
      throw new InterlockError('Pending external input is unavailable');
    execution.externalInput = { ...metadata, acceptedAt: receipt.acceptedAt };
    this.engine.complete(
      run,
      execution,
      this.engine.node(run, execution),
      pending.value,
    );
    this.store.remove('externalInputValues', execution.id);
    return { receipt, advanced: true };
  }

  private changeHold(run: Run, held: boolean, expectedRevision: number) {
    const current = run.externalInputHold ?? { revision: 0 };
    const already = Boolean(current.heldAt) === held;
    if (
      expectedRevision !== current.revision &&
      !(already && expectedRevision + 1 === current.revision)
    )
      throw new ExternalInputConflict('External-input hold revision conflict');
    if (already) return { runId: run.id, ...current };
    if (run.status !== 'running' && run.status !== 'waiting')
      throw new InterlockError('External-input hold requires an active run');
    const next = {
      revision: current.revision + 1,
      ...(held ? { heldAt: new Date().toISOString() } : {}),
    };
    run.externalInputHold = next;
    this.engine.save(run);
    this.engine.event(
      run,
      held ? 'external_input.held' : 'external_input.released',
      held
        ? 'External-input acceptance held'
        : 'External-input acceptance released',
    );
    for (const id of this.store.attachedExternalInputWaits(run.id))
      if (id !== run.id) this.store.touchRun(id);
    return { runId: run.id, ...next };
  }
}
