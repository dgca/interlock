import {
  InterlockError,
  type EventConfig,
  type EventDelivery,
  type EventPayload,
  type EventTrigger,
  type Json,
  type Run,
  type RunEvent,
  type Workflow,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { fingerprint } from './versionIdentity.js';
import type { sourceQuiescence } from './quiescence.js';

const active = (run: Run) =>
  ['queued', 'running', 'waiting'].includes(run.status);
/** Persist recipients with the source transition; dispatch under the ordinary start transaction. */
export class EventTriggers {
  constructor(
    private store: Store,
    private start: (
      trigger: EventTrigger,
      payload: EventPayload,
      eventId: string,
      chain: string[],
    ) => Run,
    private quiescence: (runId: string) => ReturnType<typeof sourceQuiescence>,
  ) {}
  validate(config: EventConfig) {
    if (config.scope.type === 'workflow') {
      const source = this.store.get<Workflow>(
        'workflows',
        config.scope.workflowId,
      );
      if (!source) throw new InterlockError('Event source workflow not found');
      if (config.exitNodeId) {
        const version =
          source.latestVersion &&
          this.store.getVersion(source.id, source.latestVersion);
        if (
          !version ||
          !version.definition.nodes.some(
            (n) => n.kind === 'exit' && n.id === config.exitNodeId,
          )
        )
          throw new InterlockError(
            'Completed Exit node not found in the published source workflow',
          );
      }
    } else if (config.exitNodeId)
      throw new InterlockError(
        'Exit node filters require a workflow source scope',
      );
  }
  capture(run: Run, event: RunEvent) {
    const type = ['run.completed', 'run.continued'].includes(event.type)
      ? 'completed'
      : event.type === 'run.cancelled'
        ? 'cancelled'
        : event.type === 'node.failed' && run.status === 'failed'
          ? 'failed'
          : event.type === 'needs_attention'
            ? 'needs_attention'
            : event.type === 'stalled'
              ? 'stalled'
              : undefined;
    if (!type) return;
    const execution = run.executions.at(-1);
    const waiting = event.waiting
      ? structuredClone(event.waiting)
      : event.waiting;
    if (waiting) {
      // Waiting context stays useful without copying polling output or long blocker lists.
      waiting.detail.blockers = waiting.detail.blockers
        ?.slice(0, 3)
        .map((s) => s.slice(0, 200));
      if (waiting.detail.lastCheck) delete waiting.detail.lastCheck.output;
      if (waiting.detail.message)
        waiting.detail.message = waiting.detail.message.slice(0, 500);
    }
    const node =
      execution &&
      this.store
        .getVersion(run.workflowId, run.version)
        ?.definition.nodes.find((node) => node.id === execution.nodeId);
    const payload: EventPayload = {
      eventId: event.id,
      type,
      occurredAt: event.at,
      runId: run.id,
      workflowId: run.workflowId,
      version: run.version,
      ...(run.externalTask ? { externalTask: run.externalTask } : {}),
      ...(run.tags !== undefined ? { tags: structuredClone(run.tags) } : {}),
      stage: event.stage ?? node?.stage ?? null,
      waiting,
      ...(type === 'failed' && execution
        ? {
            failingNode: {
              id: execution.nodeId,
              label: execution.label.slice(0, 200),
            },
          }
        : {}),
      ...(run.error
        ? { error: run.error.slice(0, 1000) }
        : type === 'stalled'
          ? { error: event.message.slice(0, 1000) }
          : {}),
    };
    for (const trigger of this.store.workflowTriggers()) {
      if (
        trigger.kind !== 'event' ||
        !trigger.enabled ||
        !trigger.events.includes(type)
      )
        continue;
      if (
        trigger.scope.type === 'workflow' &&
        trigger.scope.workflowId !== run.workflowId
      ) {
        const source = this.store.get<Workflow>('workflows', run.workflowId);
        if (
          !trigger.scope.includeChildren ||
          source?.ownerWorkflowId !== trigger.scope.workflowId
        )
          continue;
      }
      if (
        trigger.exitNodeId &&
        (execution?.kind !== 'exit' || execution.nodeId !== trigger.exitNodeId)
      )
        continue;
      const id = fingerprint([event.id, trigger.id]);
      if (this.store.get('eventTriggerReceipts', id)) continue;
      const chain = run.triggerChain ?? [];
      const reason = chain.includes(trigger.id)
        ? 'trigger_already_in_chain'
        : chain.length >= trigger.maxTriggerDepth
          ? 'max_trigger_depth'
          : undefined;
      const delivery: EventDelivery = {
        id,
        eventId: event.id,
        triggerId: trigger.id,
        workflowId: trigger.workflowId,
        sourceRunId: run.id,
        occurredAt: event.at,
        createdAt: event.at,
        outcome: reason
          ? 'suppressed'
          : trigger.waitForQuiescence
            ? 'pending_quiescence'
            : 'pending_pause',
        settled: !!reason,
        ...(reason ? { reason } : { payload, triggerChain: [...chain] }),
      };
      this.store.put('eventTriggerReceipts', {
        id,
        eventId: event.id,
        triggerId: trigger.id,
      });
      this.store.put('eventDeliveries', delivery);
      this.store.trimEventDeliveries(trigger.id);
    }
  }
  private failure(trigger: EventTrigger, detail: string) {
    trigger.consecutiveFailures++;
    if (
      trigger.pauseAfterConsecutiveFailures &&
      trigger.consecutiveFailures >= trigger.pauseAfterConsecutiveFailures
    )
      trigger.autoPaused = {
        at: new Date().toISOString(),
        reason:
          `Paused after ${trigger.consecutiveFailures} consecutive failures: ${detail}`.slice(
            0,
            1000,
          ),
      };
  }
  tick() {
    for (const delivery of this.store.pendingEventDeliveries()) {
      const trigger = this.store.get<EventTrigger>(
        'workflowTriggers',
        delivery.triggerId,
      );
      if (!trigger || trigger.kind !== 'event') continue;
      if (delivery.runId) {
        let run = this.store.get<Run>('runs', delivery.runId);
        const seen = new Set<string>();
        while (run?.chain?.nextRunId && !seen.has(run.id)) {
          seen.add(run.id);
          run = this.store.get<Run>('runs', run.chain.nextRunId);
        }
        if (run) delivery.runStatus = run.status;
        if (!run || !active(run)) {
          delivery.settled = true;
          if (run?.status === 'failed') {
            delivery.error = (run.error ?? 'Event handler failed').slice(
              0,
              1000,
            );
            this.failure(trigger, delivery.error);
          } else if (run?.status === 'completed')
            trigger.consecutiveFailures = 0;
          this.store.put('workflowTriggers', trigger);
        }
      } else if (!trigger.enabled) {
        delivery.outcome = 'suppressed';
        delivery.reason = 'trigger_disabled';
        delivery.settled = true;
      } else if (
        trigger.autoPaused ||
        this.store.pauseHolds(trigger.workflowId).length
      ) {
        delivery.outcome = 'pending_pause';
        delivery.reason = trigger.autoPaused
          ? 'automatic_pause'
          : 'target_paused';
      } else if (
        trigger.waitForQuiescence &&
        !this.quiescence(delivery.sourceRunId).quiescent
      ) {
        delivery.outcome = 'pending_quiescence';
        delivery.reason = 'source_tree_active_or_uncertain';
      } else {
        const chain = delivery.triggerChain ?? [];
        if (
          chain.includes(trigger.id) ||
          chain.length >= trigger.maxTriggerDepth
        ) {
          delivery.outcome = 'suppressed';
          delivery.reason = chain.includes(trigger.id)
            ? 'trigger_already_in_chain'
            : 'max_trigger_depth';
          delivery.settled = true;
        } else
          try {
            const target = this.store.get<Workflow>(
              'workflows',
              trigger.workflowId,
            );
            if (
              !target ||
              target.archived ||
              !target.latestVersion ||
              (target.ownerWorkflowId &&
                this.store.get<Workflow>('workflows', target.ownerWorkflowId)
                  ?.archived)
            )
              throw new InterlockError(
                'Publish and restore the target workflow before event dispatch',
              );
            if (!delivery.payload)
              throw new InterlockError('Pending event payload unavailable');
            const run = this.start(
              trigger,
              delivery.payload,
              delivery.eventId,
              [...chain, trigger.id],
            );
            delivery.runId = run.id;
            delivery.runStatus = run.status;
            delivery.outcome = run.status === 'queued' ? 'queued' : 'started';
            delivery.reason = undefined;
            delivery.payload = undefined;
            delivery.triggerChain = undefined;
            trigger.previousRunId = run.id;
            trigger.lastFireAt = new Date().toISOString();
            this.store.put('workflowTriggers', trigger);
          } catch (error) {
            if (!(error instanceof InterlockError)) throw error;
            delivery.outcome = 'failed';
            delivery.reason = error.message.slice(0, 1000);
            delivery.settled = true;
            this.failure(trigger, delivery.reason);
            this.store.put('workflowTriggers', trigger);
          }
      }
      if (delivery.settled) {
        delivery.payload = undefined;
        delivery.triggerChain = undefined;
      }
      this.store.put('eventDeliveries', delivery);
      this.store.trimEventDeliveries(trigger.id);
    }
  }
  disable(triggerId: string) {
    for (const delivery of this.store.pendingEventDeliveries()) {
      if (delivery.triggerId !== triggerId || delivery.runId) continue;
      this.store.put('eventDeliveries', {
        ...delivery,
        outcome: 'suppressed',
        reason: 'trigger_disabled',
        settled: true,
        payload: undefined,
        triggerChain: undefined,
      });
    }
    this.store.trimEventDeliveries(triggerId);
  }
  inspect(triggerId: string, offset: number, limit: number) {
    const page = this.store.eventDeliveries(triggerId, offset, limit);
    return {
      ...page,
      items: page.items.map(
        ({ payload: _payload, triggerChain: _chain, ...delivery }) => ({
          ...delivery,
          runAvailable:
            !!delivery.runId && !!this.store.get('runs', delivery.runId),
          ...(delivery.outcome === 'pending_quiescence'
            ? { quiescence: this.quiescence(delivery.sourceRunId) }
            : {}),
        }),
      ),
    };
  }
}
