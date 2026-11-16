import { randomUUID } from 'node:crypto';
import {
  composePrompt,
  InterlockError,
  resolveBindingFields,
  resourceNamesSchema,
  workTools,
  type NodeExecution,
  type Run,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkRequest,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { AgentExecutorSettings } from './agentExecutorSettings.js';
import type { Budgets } from './budgets.js';
import type { ContextContinuityGroups } from './contextContinuity.js';
import { now } from './engineHelpers.js';
import type { WorkflowMemory } from './memory.js';
import type { StepCompletion } from './stepCompletion.js';
import type { TrialEnvironments } from './trialEnvironments.js';
import type { ManagedWorkspaces } from './workspaces.js';
import type { WorkResources } from './workResources.js';

/**
 * Agent steps: offers the step as available work with its prompt, context,
 * executor settings and resources, and follows Timeout when the work stays
 * unclaimed past its deadline.
 */
export class AgentWork {
  constructor(
    private readonly store: Store,
    private readonly nowMs: () => number,
    private readonly save: (run: Run) => void,
    private readonly event: (run: Run, type: string, text: string) => void,
    private readonly definition: (
      run: Pick<Run, 'workflowId' | 'version'>,
    ) => WorkflowDefinition,
    private readonly bindingSource: StepCompletion['bindingSource'],
    private readonly finish: StepCompletion['finish'],
    private readonly trials: TrialEnvironments,
    private readonly workspaces: ManagedWorkspaces,
    private readonly agentSettings: AgentExecutorSettings,
    private readonly memory: WorkflowMemory,
    private readonly contextGroups: ContextContinuityGroups,
    private readonly budgets: Budgets,
    private readonly resources: WorkResources,
  ) {}
  advanceAgent(
    run: Run,
    execution: NodeExecution,
    node: Extract<WorkflowNode, { kind: 'agent' }>,
    starting: boolean,
  ): boolean {
    if (execution.status === 'waiting') {
      const work = this.store
        .work('available', run.id)
        .find((w) => w.executionId === execution.id);
      if (node.unclaimedTimeoutMs === undefined) return false;
      if (
        work?.budgetBlocked ||
        work?.resourceBlocked ||
        !work?.availableUntil ||
        Date.parse(work.availableUntil) > this.nowMs()
      )
        return false;
      work.status = 'timed_out';
      this.store.put('work', work);
      this.event(
        run,
        'work.timed_out',
        `${node.label}: unclaimed deadline reached`,
      );
      this.finish(run, execution, node, execution.input, 'timeout');
      return true;
    }
    const savedPrompts = (node.promptIds ?? []).map((id) => {
      const snapshot = run.promptSnapshots?.find((p) => p.id === id);
      if (!snapshot) throw new InterlockError(`Missing captured prompt ${id}`);
      return snapshot;
    });
    const trialEnvironment = this.trials.context(run);
    const resources = node.resources?.length
      ? resourceNamesSchema
          .parse(
            Object.values(
              resolveBindingFields(
                Object.fromEntries(
                  node.resources.map((binding, i) => [String(i), binding]),
                ),
                this.bindingSource(run, execution.input),
              ),
            ),
          )
          .sort()
      : undefined;
    const definition = this.definition(run);
    const { resolvedCwd, cwdBlocked } = this.workspaces.agentCwd(
      run,
      node,
      definition,
      this.bindingSource(run, execution.input),
    );
    if (resolvedCwd) execution.resolvedCwd = resolvedCwd;
    const executorSettings = this.agentSettings.resolve(run, definition, node);
    if (!executorSettings) {
      // The async version check will resume this same node execution.
      if (starting) this.save(run);
      return false;
    }
    const work: WorkRequest = {
      ...executorSettings,
      ...(resources ? { resources } : {}),
      ...(resolvedCwd ? { resolvedCwd } : {}),
      ...(cwdBlocked ? { cwdBlocked } : {}),
      id: randomUUID(),
      runId: run.id,
      executionId: execution.id,
      nodeId: node.id,
      label: node.label,
      prompt: composePrompt(
        node.prompt,
        savedPrompts,
        this.memory.section(run, node.id, executorSettings),
      ),
      ...(savedPrompts.length ? { savedPrompts } : {}),
      input: execution.input,
      context: trialEnvironment
        ? {
            ...node.context,
            skills: [
              ...new Set([...node.context.skills, 'interlock-local-trials']),
            ],
          }
        : node.context,
      ...(trialEnvironment ? { trialEnvironment } : {}),
      ...(node.context.continuityGroup
        ? {
            continuity: this.contextGroups.describe(
              run.id,
              node.context.continuityGroup,
            ),
          }
        : {}),
      outputSchema: node.outputSchema,
      ...workTools(definition, node.id),
      ...(node.resultRules ? { resultRules: node.resultRules } : {}),
      status: 'available',
      attempt: 0,
      maxAttempts: node.maxAttempts,
      ...(node.maxLeaseExpiries === undefined
        ? {}
        : {
            maxLeaseExpiries: node.maxLeaseExpiries,
            failureCount: 0,
            leaseExpiryCount: 0,
          }),
      maxExecutionMs: node.maxExecutionMs,
      leaseSeconds: node.leaseSeconds,
      availableUntil:
        node.unclaimedTimeoutMs === undefined
          ? undefined
          : new Date(this.nowMs() + node.unclaimedTimeoutMs).toISOString(),
      createdAt: now(),
    };
    this.store.put('work', work);
    this.budgets.refresh();
    this.resources.refresh();
    execution.status = 'waiting';
    run.status = 'waiting';
    this.save(run);
    this.event(run, 'work.available', `Awaiting agent: ${node.label}`);
    return true;
  }
}
