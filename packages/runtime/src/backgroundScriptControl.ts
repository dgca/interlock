import {
  InterlockError,
  type NodeExecution,
  type Run,
  scriptOperationSchema,
  type ScriptOperation,
  type WorkflowDefinition,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { BackgroundScripts } from './backgroundScripts.js';
import type { Variables } from './variables.js';
import type { WorkResources } from './workResources.js';

const terminal = (s: string) =>
  ['completed', 'failed', 'cancelled'].includes(s);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Inspects, stops and reconciles background Script executions. */
export class BackgroundScriptControl {
  constructor(
    private readonly store: Store,
    private readonly run: (id: string) => Run,
    private readonly save: (run: Run) => void,
    private readonly event: (run: Run, type: string, text: string) => void,
    private readonly definition: (
      run: Pick<Run, 'workflowId' | 'version'>,
    ) => WorkflowDefinition,
    private readonly fail: (
      run: Run,
      execution: NodeExecution,
      error: string,
    ) => void,
    private readonly cancelTree: (id: string) => void,
    private readonly variables: Variables,
    private readonly backgroundScripts: BackgroundScripts,
    private readonly resources: WorkResources,
  ) {}
  manageScript(request: ScriptOperation): {
    runId: string;
    executionId: string;
    status: NodeExecution['status'];
    background: NonNullable<NodeExecution['background']>;
  } {
    const input = scriptOperationSchema.parse(request);
    const run = this.run(input.runId);
    const execution = run.executions.find(
      (step) => step.id === input.executionId,
    );
    if (!execution?.background)
      throw new InterlockError('Background Script execution not found');
    if (
      input.action === 'inspect' &&
      ['launching', 'running'].includes(execution.background.state)
    ) {
      try {
        const node = this.definition(run).nodes.find(
          (node) => node.id === execution.nodeId,
        );
        if (node?.kind !== 'script')
          throw new InterlockError('Script node not found');
        const resolved = this.variables.resolve(
          run,
          (node.environment ?? []).map((entry) => entry.variableId),
        );
        const snapshot = this.backgroundScripts.snapshot(
          run,
          execution,
          resolved.secrets,
        );
        if (snapshot) {
          execution.background = snapshot;
          this.save(run);
        }
      } catch {
        execution.background.state = 'uncertain';
        if (!terminal(run.status))
          this.fail(
            run,
            execution,
            'Background supervisor or protected receipts cannot be verified. Inspect processes and reconcile stopped.',
          );
        else this.save(run);
      }
    }
    if (
      input.action === 'stop' &&
      ['launching', 'running', 'uncertain'].includes(execution.background.state)
    ) {
      try {
        this.backgroundScripts.stop(run.id, execution.id);
        if (!terminal(run.status)) {
          this.cancelTree(run.id);
          return this.manageScript({
            action: 'inspect',
            runId: run.id,
            executionId: execution.id,
          });
        }
      } catch (error) {
        execution.background.state = 'uncertain';
        if (!terminal(run.status)) this.fail(run, execution, message(error));
        else this.save(run);
        throw new InterlockError(message(error));
      }
    }
    const background = execution.background;
    if (input.action === 'reconcile')
      this.store.transaction(() => {
        if (background.state !== 'uncertain')
          throw new InterlockError(
            'Only uncertain background Scripts can be reconciled',
          );
        background.state = 'reconciled';
        this.resources.endExecution(run.id, execution, true);
        this.resources.releaseExecution(
          run.id,
          execution.id,
          execution.resourceAttempt ?? 1,
          'script reconciliation',
        );
        this.save(run);
        this.event(
          run,
          'script.reconciled',
          'Original Script confirmed stopped and effects inspected: ' +
            input.reason,
        );
      });
    return {
      runId: run.id,
      executionId: execution.id,
      status: execution.status,
      background: execution.background,
    };
  }
}
