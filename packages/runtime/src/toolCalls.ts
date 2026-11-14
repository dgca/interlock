import { randomUUID } from 'node:crypto';
import {
  agentTools,
  assertContract,
  InterlockError,
  type AssignmentTool,
  type Json,
  type NodeExecution,
  type Run,
  type ToolCallLink,
  type ToolCallRequest,
  type WorkflowDefinition,
  type WorkRequest,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

/** Larger outputs are read through get_run_result instead of the call response. */
const MAX_INLINE_OUTPUT_BYTES = 65_536;
/** Return early enough for the caller to renew before its lease ends. */
const LEASE_MARGIN_MS = 5_000;
const terminal = (status: string) =>
  ['completed', 'failed', 'cancelled'].includes(status);

interface ToolCallHost {
  run(id: string): Run;
  definition(run: Pick<Run, 'workflowId' | 'version'>): WorkflowDefinition;
  save(run: Run): void;
  event(run: Run, type: string, text: string): void;
  fail(run: Run, execution: NodeExecution, error: string): void;
  cancel(run: Run, reason: string): void;
  paused(run: Run): boolean;
  subscribe(listener: () => void): () => void;
  nowMs(): number;
}

export interface ToolCallResult {
  callId: string;
  name: string;
  runId: string;
  executionId: string | null;
  status: Run['status'];
  output?: Json;
  outputBytes?: number;
  error?: string;
  blockedBy?: 'pause' | 'resource' | 'approval';
  calls: {
    attempt: number;
    maxPerAttempt: number;
    execution: number;
    maxPerExecution: number;
  };
}

/**
 * Agent tool calls. Each call is a child run of the calling Agent's run that
 * executes one Script or Fetch node of the same published version, so it uses
 * the ordinary limits, resources, holds, approvals and recovery.
 */
export class ToolCalls {
  constructor(
    private store: Store,
    private host: ToolCallHost,
  ) {}

  /** The calling execution and tools available to an active claim. */
  private context(work: WorkRequest) {
    const parent = this.host.run(work.runId);
    const execution = parent.executions.find((e) => e.id === work.executionId);
    if (!execution || execution.status !== 'waiting')
      throw new InterlockError('The calling Agent execution is not active');
    const version = execution.version ?? parent.version;
    const definition = this.host.definition({ ...parent, version });
    return {
      parent,
      execution,
      version,
      definition,
      tools: agentTools(definition, work.nodeId),
    };
  }

  /** Tools offered with an assignment; omitted when the node has none. */
  forAssignment(work: WorkRequest) {
    const run = this.store.get<Run>('runs', work.runId);
    if (!run) return undefined;
    const execution = run.executions.find((e) => e.id === work.executionId);
    const tools = agentTools(
      this.host.definition({
        ...run,
        version: execution?.version ?? run.version,
      }),
      work.nodeId,
    );
    return tools.length
      ? tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          maxCallsPerAttempt: tool.maxCallsPerAttempt,
          maxCallsPerExecution: tool.maxCallsPerExecution,
        }))
      : undefined;
  }

  private calls(execution: NodeExecution, tool: AssignmentTool) {
    return execution.childRunIds.flatMap((id) => {
      const run = this.store.get<Run>('runs', id);
      return run?.toolCall?.edgeId === tool.edgeId ? [run] : [];
    });
  }

  /** Start a call, or return the existing run for a repeated callId. Runs in a claim transaction. */
  begin(work: WorkRequest, q: ToolCallRequest): string {
    const { parent, execution, version, definition, tools } =
      this.context(work);
    const tool = tools.find((t) => t.name === q.name);
    if (!tool)
      throw new InterlockError(
        `Unknown tool ${q.name}. Available: ${tools.map((t) => t.name).join(', ') || 'none'}`,
      );
    const calls = this.calls(execution, tool);
    if (q.callId) {
      const existing = calls.find((r) => r.toolCall!.callId === q.callId);
      if (existing) {
        if (existing.toolCall!.attempt !== work.attempt)
          throw new InterlockError(
            `Tool call ${q.callId} belongs to an earlier claim attempt`,
          );
        return existing.id;
      }
    }
    const attemptCalls = calls.filter(
      (r) => r.toolCall!.attempt === work.attempt,
    ).length;
    if (attemptCalls >= tool.maxCallsPerAttempt)
      throw new InterlockError(
        `Tool ${tool.name} reached its limit of ${tool.maxCallsPerAttempt} calls per claim attempt. No call was made.`,
      );
    if (calls.length >= tool.maxCallsPerExecution)
      throw new InterlockError(
        `Tool ${tool.name} reached its limit of ${tool.maxCallsPerExecution} calls for this Agent execution. No call was made.`,
      );
    const node = definition.nodes.find((n) => n.id === tool.nodeId)!;
    const args = q.arguments as Json;
    assertContract(node.inputSchema, args, `${tool.name} arguments`);
    const time = new Date(this.host.nowMs()).toISOString();
    const run: Run = {
      ...(parent.tags ? { tags: structuredClone(parent.tags) } : {}),
      ...(parent.triggerChain
        ? { triggerChain: [...parent.triggerChain] }
        : {}),
      ...(parent.comparison ? { comparison: parent.comparison } : {}),
      id: randomUUID(),
      workflowId: parent.workflowId,
      workflowName: `${parent.workflowName} · ${tool.name}`,
      version,
      parentRunId: parent.id,
      parentExecutionId: execution.id,
      toolCall: {
        workId: work.id,
        executionId: execution.id,
        attempt: work.attempt,
        edgeId: tool.edgeId,
        name: tool.name,
        callId: q.callId ?? randomUUID(),
      },
      status: 'running',
      input: args,
      cursor: node.id,
      value: args,
      executions: [],
      createdAt: time,
      updatedAt: time,
      // The same published version, so the parent's captures are complete.
      ...(parent.promptSnapshots
        ? { promptSnapshots: parent.promptSnapshots }
        : {}),
      ...(parent.variableCaptures
        ? { variableCaptures: parent.variableCaptures }
        : {}),
      ...(parent.modelAliasCaptures
        ? { modelAliasCaptures: parent.modelAliasCaptures }
        : {}),
    };
    this.host.save(run);
    this.host.event(run, 'run.started', `Tool call ${tool.name}`);
    execution.childRunIds.push(run.id);
    this.host.save(parent);
    this.host.event(
      parent,
      'tool.called',
      `${work.label}: called ${tool.name} (run ${run.id})`,
    );
    return run.id;
  }

  /** Wait for the call to end, bounded by waitMs and the remaining lease. */
  async wait(
    runId: string,
    work: WorkRequest,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<ToolCallResult> {
    const leaseMs = work.leaseUntil
      ? Date.parse(work.leaseUntil) - this.host.nowMs() - LEASE_MARGIN_MS
      : 0;
    const budget = Math.max(0, Math.min(waitMs, leaseMs));
    const done = () => terminal(this.store.get<Run>('runs', runId)!.status);
    if (budget > 0 && !done())
      await new Promise<void>((resolve) => {
        let unsubscribe = () => {};
        const finish = () => {
          clearTimeout(timer);
          unsubscribe();
          signal?.removeEventListener('abort', finish);
          resolve();
        };
        const timer = setTimeout(finish, budget);
        unsubscribe = this.host.subscribe(() => {
          if (done()) finish();
        });
        signal?.addEventListener('abort', finish, { once: true });
        if (done() || signal?.aborted) finish();
      });
    return this.describe(runId, work);
  }

  describe(runId: string, work: WorkRequest): ToolCallResult {
    const run = this.store.get<Run>('runs', runId)!;
    const link: ToolCallLink = run.toolCall!;
    const parent = this.host.run(run.parentRunId!);
    const execution = parent.executions.find((e) => e.id === link.executionId)!;
    const tool = agentTools(this.host.definition(run), work.nodeId).find(
      (t) => t.edgeId === link.edgeId,
    )!;
    const calls = this.calls(execution, tool);
    const step = run.executions.at(-1);
    const result: ToolCallResult = {
      callId: link.callId,
      name: link.name,
      runId: run.id,
      executionId: step?.id ?? null,
      status: run.status,
      calls: {
        attempt: calls.filter((r) => r.toolCall!.attempt === work.attempt)
          .length,
        maxPerAttempt: tool.maxCallsPerAttempt,
        execution: calls.length,
        maxPerExecution: tool.maxCallsPerExecution,
      },
    };
    if (run.status === 'completed' && step?.output !== undefined) {
      const bytes = Buffer.byteLength(JSON.stringify(step.output));
      if (bytes <= MAX_INLINE_OUTPUT_BYTES) result.output = step.output;
      else result.outputBytes = bytes;
    }
    if (run.error) result.error = run.error;
    if (!terminal(run.status)) {
      if (this.host.paused(run)) result.blockedBy = 'pause';
      else if (step?.scriptApproval) result.blockedBy = 'approval';
      else if (step?.resourceBlocked) result.blockedBy = 'resource';
    }
    return result;
  }

  /**
   * Settle calls nobody can receive. A call that has not started its operation
   * when its claim attempt ends is cancelled; a started one finishes and is
   * recorded. A call blocked by a resource its own Agent holds fails.
   */
  tick() {
    for (const { run: state } of this.store.activeRunState()) {
      const link = (state as Run).toolCall;
      if (!link) continue;
      const run = this.host.run(state.id);
      const step = run.executions.at(-1);
      const work = this.store.get<WorkRequest>('work', link.workId);
      const claimed =
        work?.status === 'claimed' && work.attempt === link.attempt;
      if (!claimed && !step?.operationStartedAt && !step?.resourceActive) {
        this.host.cancel(run, 'calling claim ended before the tool started');
        continue;
      }
      const own = step?.resourceBlocked?.owners.find(
        (owner) => owner.workId === link.workId,
      );
      if (step && own)
        this.host.fail(
          run,
          step,
          `${step.label}: resource ${own.name} is held by the calling Agent`,
        );
    }
  }
}
