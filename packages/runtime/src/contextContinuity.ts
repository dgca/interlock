import { isDeepStrictEqual } from 'node:util';
import {
  InterlockError,
  contextGroupQuerySchema,
  contextHandoffSchema,
  sessionIdentitySchema,
  type ContextContinuity,
  type ContextEvent,
  type ContextGroupQuery,
  type ContextHandoffInput,
  type SessionIdentity,
  type Run,
  type WorkRequest,
} from '@interlock/core';
import type { Store } from '@interlock/storage';

type Binding = ContextContinuity & { id: string };
const bindings = 'contextGroups';
const events = 'contextEvents';
const key = (runId: string, group: string) => JSON.stringify([runId, group]);

/** Checks executor declarations, never creates or inspects harness sessions. */
export class ContextContinuityGroups {
  constructor(
    private store: Store,
    private notify: (runId: string) => void,
  ) {}

  describe(runId: string, group: string): ContextContinuity {
    const binding = this.store.get<Binding>(bindings, key(runId, group));
    if (!binding) return { runId, group, revision: 0, session: null };
    const { id: _id, ...descriptor } = binding;
    return descriptor;
  }
  read(input: ContextGroupQuery) {
    const { runId, group, offset, limit } =
      contextGroupQuerySchema.parse(input);
    if (!this.store.get<Run>('runs', runId))
      throw new InterlockError('Run not found');
    const history = this.store
      .list<ContextEvent>(events)
      .filter((event) => event.runId === runId && event.group === group);
    return {
      ...this.describe(runId, group),
      history: history.slice(offset, offset + limit),
      total: history.length,
      nextOffset: offset + limit < history.length ? offset + limit : null,
    };
  }
  private bind(binding: ContextContinuity) {
    this.store.put<Binding>(bindings, {
      id: key(binding.runId, binding.group),
      ...binding,
    });
    // Persist projection changes so continuation cursors observe a handoff.
    for (const work of this.store.work()) {
      if (
        work.runId !== binding.runId ||
        work.context.continuityGroup !== binding.group ||
        work.status !== 'available'
      )
        continue;
      work.continuity = binding;
      this.store.put('work', work);
    }
    const run = this.store.get<Run>('runs', binding.runId)!;
    run.contextRevision = (run.contextRevision ?? 0) + 1;
    this.store.put('runs', run);
    this.notify(run.id);
  }
  /** Called inside the successful claim transaction, after admission checks. */
  claimed(work: WorkRequest, declaration?: SessionIdentity) {
    const group = work.context.continuityGroup;
    if (!group) return;
    if (work.context.mode === 'fresh')
      throw new InterlockError('Fresh context cannot use a continuity group');
    if (!declaration)
      throw new InterlockError(
        'This continuity group requires executorId and sessionId in session',
      );
    const session = sessionIdentitySchema.parse(declaration);
    let binding = this.describe(work.runId, group);
    if (binding.session && !isDeepStrictEqual(binding.session, session))
      throw new InterlockError(
        'Context session conflict: resume the expected session or record an explicit context handoff',
      );
    if (!binding.session) {
      binding = { ...binding, revision: 1, session };
      this.bind(binding);
    }
    work.continuity = binding;
    this.store.put<ContextEvent>(events, {
      id: JSON.stringify(['claim', work.id, work.attempt]),
      kind: 'claim',
      runId: work.runId,
      group,
      revision: binding.revision,
      session,
      workId: work.id,
      attempt: work.attempt,
      workerId: work.workerId!,
      at: new Date().toISOString(),
    });
  }
  handoff(input: ContextHandoffInput) {
    const request = contextHandoffSchema.parse(input);
    return this.store.transaction(() => {
      const {
        runId,
        group,
        expectedRevision,
        session,
        actor,
        reason,
        checkpointRef,
      } = request;
      const run = this.store.get<Run>('runs', runId);
      if (!run) throw new InterlockError('Run not found');
      const binding = this.describe(runId, group);
      const eventId = JSON.stringify([
        'handoff',
        runId,
        group,
        expectedRevision + 1,
      ]);
      const previous = this.store.get<ContextEvent>(events, eventId);
      if (
        binding.revision === expectedRevision + 1 &&
        previous?.kind === 'handoff' &&
        isDeepStrictEqual(previous.session, session) &&
        previous.actor === actor &&
        previous.reason === reason &&
        previous.checkpointRef === checkpointRef
      )
        return { ...binding, applied: false };
      if (!binding.session || binding.revision !== expectedRevision)
        throw new InterlockError(
          'Context revision conflict; read the group before handing off',
        );
      if (run.status === 'completed' || run.status === 'cancelled')
        throw new InterlockError(
          'Cannot hand off a completed or cancelled run',
        );
      if (isDeepStrictEqual(binding.session, session))
        throw new InterlockError(
          'A context handoff must declare a different session',
        );
      if (
        this.store
          .work()
          .some(
            (work) =>
              work.runId === runId &&
              work.context.continuityGroup === group &&
              work.status === 'claimed',
          )
      )
        throw new InterlockError(
          'Cannot hand off while the group has an active claim',
        );
      const next = {
        ...binding,
        session,
        revision: expectedRevision + 1,
        checkpointRef,
      };
      this.store.put<ContextEvent>(events, {
        id: eventId,
        kind: 'handoff',
        runId,
        group,
        revision: next.revision,
        fromSession: binding.session,
        session,
        actor,
        reason,
        checkpointRef,
        at: new Date().toISOString(),
      });
      this.bind(next);
      return { ...next, applied: true };
    });
  }
  removeRuns(ids: Set<string>) {
    for (const collection of [bindings, events])
      for (const record of this.store.list<{ id: string; runId: string }>(
        collection,
      ))
        if (ids.has(record.runId)) this.store.remove(collection, record.id);
  }
}
