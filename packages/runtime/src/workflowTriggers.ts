import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  scheduleMutationSchema,
  scheduleReadSchema,
  nextScheduleSlot,
  latestScheduleSlot,
  scheduleInput,
  SCHEDULE_LAG_THRESHOLD_MS,
  type ScheduleMutation,
  type ScheduleRead,
  type ScheduleTiming,
  type WorkflowTrigger,
  type ScheduleTrigger,
  type ScheduleFire,
  type Workflow,
  type Run,
  type Json,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Webhooks } from './webhooks.js';
import type { EventTriggers } from './eventTriggers.js';

const active = (run: Run) =>
  ['queued', 'running', 'waiting'].includes(run.status);
/** Durable periodic starts. Tick, input capture and admission share one transaction. */
export class WorkflowTriggers {
  constructor(
    private store: Store,
    private start: (trigger: ScheduleTrigger, input: Json, slot: string) => Run,
    private webhooks: Webhooks,
    readonly events: EventTriggers,
  ) {}
  private get(id: string) {
    const trigger = this.store.get<WorkflowTrigger>('workflowTriggers', id);
    if (!trigger) throw new InterlockError('Trigger not found');
    return trigger;
  }
  private assertTarget(
    trigger: Pick<WorkflowTrigger, 'workflowId'> &
      Partial<Pick<WorkflowTrigger, 'kind'>> & { action?: { type: string } },
  ) {
    const w = this.store.get<Workflow>('workflows', trigger.workflowId);
    if (!w) throw new InterlockError('Workflow not found');
    if (
      w.archived ||
      (w.ownerWorkflowId &&
        this.store.get<Workflow>('workflows', w.ownerWorkflowId)?.archived)
    )
      throw new InterlockError(
        'Restore this workflow before enabling its trigger',
      );
    if (trigger.kind === 'event' && trigger.action?.type === 'webhook')
      return w;
    if (!w.latestVersion || !this.store.getVersion(w.id, w.latestVersion))
      throw new InterlockError(
        'Publish this workflow before enabling its trigger',
      );
    return w;
  }
  preview(timing: ScheduleTiming, at = new Date().toISOString()) {
    const parsed = scheduleReadSchema.parse({ action: 'preview', timing });
    if (parsed.action !== 'preview') throw new Error('Invalid preview');
    const slots: string[] = [];
    let after = at;
    for (let i = 0; i < 3; i++) {
      after = nextScheduleSlot(parsed.timing, after, at);
      slots.push(after);
    }
    return { calculatedAt: at, upcoming: slots };
  }
  private summary<T extends WorkflowTrigger>(trigger: T, at = Date.now()) {
    const holds = this.store.pauseHolds(trigger.workflowId);
    const lagMs =
      trigger.kind === 'schedule'
        ? Math.max(
            trigger.lastLagMs ?? 0,
            trigger.enabled && !trigger.autoPaused && !holds.length
              ? Math.max(0, at - Date.parse(trigger.nextFireAt))
              : 0,
            this.store.pendingScheduleLag(trigger.id, at),
          )
        : 0;
    const workflow = this.store.get<Workflow>('workflows', trigger.workflowId);
    return {
      ...trigger,
      lagMs,
      lagThresholdMs: SCHEDULE_LAG_THRESHOLD_MS,
      excessiveLag: lagMs >= SCHEDULE_LAG_THRESHOLD_MS,
      holds: holds.slice(0, 20),
      holdCount: holds.length,
      workflowName: workflow?.name ?? 'Missing workflow',
      publishedVersion: workflow?.latestVersion ?? null,
      canEnable:
        !!workflow &&
        !workflow.archived &&
        !!workflow.latestVersion &&
        !!this.store.getVersion(workflow.id, workflow.latestVersion) &&
        !(
          workflow.ownerWorkflowId &&
          this.store.get<Workflow>('workflows', workflow.ownerWorkflowId)
            ?.archived
        ),
    };
  }
  list(
    workflowId?: string,
    offset = 0,
    limit = 20,
    kind?: 'schedule' | 'webhook' | 'event',
  ) {
    const q = scheduleReadSchema.parse({
      action: 'list',
      kind,
      workflowId,
      offset,
      limit,
    });
    if (q.action !== 'list') throw new Error('Invalid list');
    const rows = this.store
      .workflowTriggers(q.workflowId)
      .filter((t) => !q.kind || t.kind === q.kind);
    return {
      items: rows.slice(q.offset, q.offset + q.limit).map((t) => {
        const compact = { ...this.summary(t) };
        for (const key of [
          'input',
          'bindings',
          'authentication',
          'deliveryId',
          'timestamp',
          'filters',
          'action',
        ])
          delete (compact as Record<string, unknown>)[key];
        return compact;
      }),
      total: rows.length,
      nextOffset: q.offset + q.limit < rows.length ? q.offset + q.limit : null,
    };
  }
  inspect(id: string, offset = 0, limit = 20) {
    const q = scheduleReadSchema.parse({
      action: 'inspect',
      id,
      offset,
      limit,
    });
    if (q.action !== 'inspect') throw new Error('Invalid inspect');
    const trigger = this.get(id);
    if (trigger.kind === 'event')
      return {
        trigger: this.summary(trigger),
        deliveries: this.events.inspect(id, q.offset, q.limit),
        endpoint: null,
        upcoming: [],
        fires: {
          items: [] as (ScheduleFire & { runAvailable: boolean })[],
          total: 0,
          nextOffset: null,
        },
      };
    if (trigger.kind === 'webhook')
      return {
        trigger: this.summary(trigger),
        deliveries: this.store.webhookDeliveries(id, q.offset, q.limit),
        endpoint: `/hooks/${trigger.id}`,
        upcoming: [],
        fires: {
          items: [] as (ScheduleFire & { runAvailable: boolean })[],
          total: 0,
          nextOffset: null,
        },
      };
    const fires = this.store.scheduleFires(id, q.offset, q.limit);
    return {
      trigger: this.summary(trigger),
      upcoming: this.preview(trigger.timing).upcoming,
      deliveries: {
        items: [] as import('@interlock/core').WebhookDelivery[],
        total: 0,
        nextOffset: null,
      },
      endpoint: null,
      fires: {
        ...fires,
        items: fires.items.map((f) => ({
          ...f,
          runAvailable: !!f.runId && !!this.store.get('runs', f.runId),
        })),
      },
    };
  }
  attention(workflowId?: string, offset = 0, limit = 20) {
    const q = scheduleReadSchema.parse({
      action: 'attention',
      workflowId,
      offset,
      limit,
    });
    if (q.action !== 'attention') throw new Error('Invalid attention');
    const rows = this.store
      .workflowTriggers(workflowId)
      .map((t) => this.summary(t))
      .filter((t) => t.enabled && (t.autoPaused || t.excessiveLag))
      .map((t) => ({
        triggerId: t.id,
        workflowId: t.workflowId,
        name: t.name,
        reason:
          t.autoPaused?.reason ??
          `Schedule fire lag ${Math.floor(t.lagMs / 1000)} seconds exceeds 60 seconds`,
        kind: t.autoPaused
          ? ('automatic_pause' as const)
          : ('excessive_lag' as const),
        lagMs: t.lagMs,
      }));
    return {
      items: rows.slice(q.offset, q.offset + q.limit),
      total: rows.length,
      nextOffset: q.offset + q.limit < rows.length ? q.offset + q.limit : null,
    };
  }
  read(input: ScheduleRead) {
    const q = scheduleReadSchema.parse(input);
    switch (q.action) {
      case 'list':
        return this.list(q.workflowId, q.offset, q.limit, q.kind);
      case 'inspect':
        return this.inspect(q.id, q.offset, q.limit);
      case 'preview':
        return this.preview(q.timing);
      case 'attention':
        return this.attention(q.workflowId, q.offset, q.limit);
    }
  }
  mutate(input: ScheduleMutation) {
    const q = scheduleMutationSchema.parse(input);
    return this.store.transaction(() => {
      const at = new Date().toISOString();
      if (q.action === 'create') {
        if (!this.store.get('workflows', q.workflowId))
          throw new InterlockError('Workflow not found');
        if (q.config.kind === 'webhook') this.webhooks.validate(q.config);
        if (q.config.kind === 'event') this.events.validate(q.config);
        const trigger = {
          ...q.config,
          id: randomUUID(),
          workflowId: q.workflowId,
          revision: 1,
          enabled: false,
          createdAt: at,
          updatedAt: at,
          ...(q.config.kind === 'schedule'
            ? {
                anchorAt: at,
                nextFireAt: nextScheduleSlot(q.config.timing, at),
              }
            : q.config.kind === 'webhook'
              ? { ignoredCount: 0, rejectedCount: 0, deliveryCount: 0 }
              : {}),
          consecutiveFailures: 0,
        } as WorkflowTrigger;
        this.store.put('workflowTriggers', trigger);
        return { applied: true, trigger };
      }
      const trigger = this.get(q.id);
      if (trigger.revision !== q.expectedRevision)
        throw new InterlockError(
          'Trigger revision conflict; retain edits and reload the current trigger before reconciling',
        );
      if (q.action === 'delete') {
        this.store.remove('workflowTriggers', trigger.id);
        this.store.deleteScheduleFires(trigger.id);
        this.store.deleteWebhookHistory(trigger.id);
        this.store.deleteEventHistory(trigger.id);
        return { applied: true, trigger: null };
      }
      if (q.action === 'update') {
        if (q.config.kind !== trigger.kind)
          throw new InterlockError(
            'Trigger kind cannot change; create a new trigger',
          );
        if (q.config.kind === 'webhook')
          this.webhooks.validate(q.config, trigger.enabled);
        if (q.config.kind === 'event') this.events.validate(q.config);
        const changed =
          trigger.kind === 'schedule' &&
          q.config.kind === 'schedule' &&
          !isDeepStrictEqual(trigger.timing, q.config.timing);
        delete trigger.tags;
        Object.assign(trigger, q.config);
        if (changed && trigger.kind === 'schedule') {
          trigger.anchorAt = at;
          trigger.nextFireAt = nextScheduleSlot(trigger.timing, at);
          trigger.lastLagMs = undefined;
        }
      } else if (q.action === 'enable') {
        this.assertTarget(trigger);
        if (trigger.kind === 'webhook') this.webhooks.validate(trigger, true);
        if (trigger.kind === 'event') this.events.validate(trigger, true);
        trigger.enabled = true;
        trigger.autoPaused = undefined;
        trigger.consecutiveFailures = 0;
        if (
          trigger.kind === 'schedule' &&
          trigger.missedFirePolicy === 'skip' &&
          trigger.nextFireAt <= at
        )
          trigger.nextFireAt = nextScheduleSlot(
            trigger.timing,
            at,
            trigger.anchorAt,
          );
      } else {
        trigger.enabled = false;
        if (trigger.kind === 'event') this.events.disable(trigger.id);
      }
      trigger.revision++;
      trigger.updatedAt = at;
      this.store.put('workflowTriggers', trigger);
      return { applied: true, trigger };
    });
  }
  private failure(trigger: ScheduleTrigger, at: string, detail: string) {
    trigger.consecutiveFailures++;
    if (
      trigger.pauseAfterConsecutiveFailures &&
      trigger.consecutiveFailures >= trigger.pauseAfterConsecutiveFailures
    )
      trigger.autoPaused = {
        at,
        reason:
          `Paused after ${trigger.consecutiveFailures} consecutive failures: ${detail}`.slice(
            0,
            1000,
          ),
      };
  }
  tick() {
    this.store.transaction(() => {
      this.webhooks.tick();
      this.events.tick();
      const at = new Date().toISOString();
      const settledTriggers = new Set<string>();
      for (const fire of this.store.pendingScheduleFires()) {
        const origin = fire.runId
          ? this.store.get<Run>('runs', fire.runId)
          : undefined;
        let run = origin;
        const seen = new Set<string>();
        while (run?.chain?.nextRunId && !seen.has(run.id)) {
          seen.add(run.id);
          run = this.store.get<Run>('runs', run.chain.nextRunId);
        }
        const trigger = this.store.get<WorkflowTrigger>(
          'workflowTriggers',
          fire.triggerId,
        );
        if (!trigger || trigger.kind !== 'schedule') continue;
        if (run) {
          fire.runStatus = run.status;
          // Chain traversal resolves terminal state, not the originating admission.
          fire.admittedAt ??= origin?.admission
            ? origin.admission.admittedAt
            : origin?.createdAt;
          if (fire.admittedAt) {
            fire.lagMs = Math.max(
              0,
              Date.parse(fire.admittedAt) - Date.parse(fire.scheduledAt),
            );
            if (trigger.previousRunId === fire.runId)
              trigger.lastLagMs = fire.lagMs;
          }
        }
        if (!run || !active(run)) {
          fire.settled = true;
          settledTriggers.add(trigger.id);
          if (run?.status === 'failed')
            this.failure(trigger, at, run.error ?? 'Scheduled run failed');
          else if (run?.status === 'completed') trigger.consecutiveFailures = 0;
        }
        this.store.put('scheduleFires', fire);
        this.store.put('workflowTriggers', trigger);
      }
      for (const id of settledTriggers) this.store.trimScheduleFires(id);
      for (const trigger of this.store.workflowTriggers()) {
        if (
          trigger.kind !== 'schedule' ||
          !trigger.enabled ||
          trigger.autoPaused
        )
          continue;
        if (this.store.pauseHolds(trigger.workflowId).length) continue;
        if (trigger.nextFireAt > at) continue;
        const due = Date.parse(trigger.nextFireAt);
        const heldAtSlot = this.store
          .pauseHolds(trigger.workflowId, true)
          .some(
            (hold) =>
              Date.parse(hold.createdAt) <= due &&
              (!hold.releasedAt || Date.parse(hold.releasedAt) > due),
          );
        const missed = heldAtSlot || Date.parse(at) - due > 5000;
        const slot = missed
          ? latestScheduleSlot(trigger.timing, at, trigger.anchorAt)
          : trigger.nextFireAt;
        const fire: ScheduleFire = {
          id: `schedule:${trigger.id}:${slot}`,
          triggerId: trigger.id,
          workflowId: trigger.workflowId,
          scheduledAt: slot,
          firedAt: at,
          outcome: 'skipped_missed',
          settled: true,
        };
        const pending = this.store
          .activeRuns()
          .filter((r) => r.schedule?.triggerId === trigger.id);
        if (!(missed && trigger.missedFirePolicy === 'skip')) {
          if (
            (trigger.overlapPolicy === 'skip' && pending.length) ||
            (trigger.overlapPolicy === 'queue' &&
              pending.some((r) => r.status === 'queued'))
          )
            fire.outcome = 'skipped_overlap';
          else {
            try {
              this.assertTarget(trigger);
              const input = scheduleInput(trigger, {
                scheduledAt: slot,
                firedAt: at,
                triggerId: trigger.id,
                previousRunId: trigger.previousRunId ?? null,
              });
              const run = this.start(trigger, input, slot);
              fire.runId = run.id;
              fire.version = run.version;
              fire.outcome = run.status === 'queued' ? 'queued' : 'started';
              fire.settled = false;
              fire.admittedAt = run.status === 'queued' ? undefined : at;
              fire.lagMs = fire.admittedAt
                ? Math.max(0, Date.parse(at) - Date.parse(slot))
                : undefined;
              trigger.previousRunId = run.id;
              trigger.lastLagMs = fire.lagMs;
            } catch (error) {
              if (!(error instanceof InterlockError)) throw error;
              fire.outcome = 'failed';
              fire.error = error.message.slice(0, 1000);
              this.failure(trigger, at, fire.error);
            }
          }
        }
        trigger.lastFireAt = slot;
        trigger.nextFireAt = nextScheduleSlot(
          trigger.timing,
          at,
          trigger.anchorAt,
        );
        trigger.lastCheckedAt = at;
        this.store.put('scheduleFires', fire);
        this.store.put('workflowTriggers', trigger);
        this.store.trimScheduleFires(trigger.id);
      }
    });
  }
}
