import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  applyWorkflowPositions,
  workflowPositions,
  type Workflow,
  type WorkflowDefinition,
  type WorkflowPositions,
} from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQueryClient } from '../../lib/query';

type Client = ReturnType<typeof useQueryClient>;
type LayoutWorkflow = Workflow & { layoutRevision?: number };
type State = {
  revision: number;
  positions: WorkflowPositions;
  saving: boolean;
  error: string;
};
const merge = (...positions: WorkflowPositions[]): WorkflowPositions =>
  Object.fromEntries(positions.flatMap(Object.entries));
const equal = (a: { x: number; y: number }, b?: { x: number; y: number }) =>
  b !== undefined && a.x === b.x && a.y === b.y;

// A route may unmount while a write is pending. Keep that write and any later
// queued positions together until acknowledged, or until the editor can retry.
const sessions = new WeakMap<Client, Map<string, LayoutSession>>();

class LayoutSession {
  state: State;
  private acknowledged: WorkflowPositions;
  private pending: WorkflowPositions = {};
  private writing?: Promise<void>;
  private deferred?: LayoutWorkflow;
  private listeners = new Set<() => void>();

  constructor(
    private client: Client,
    private workflowId: string,
    workflow: LayoutWorkflow,
    private release: () => void,
  ) {
    this.acknowledged = workflowPositions(workflow.draft);
    this.state = {
      revision: workflow.layoutRevision ?? 0,
      positions: this.acknowledged,
      saving: false,
      error: '',
    };
  }

  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      this.cleanup();
    };
  };
  private cleanup() {
    if (
      !this.listeners.size &&
      !this.writing &&
      !Object.keys(this.pending).length
    )
      this.release();
  }
  private publish(next: Partial<State>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  receive(workflow: LayoutWorkflow) {
    const revision = workflow.layoutRevision ?? 0;
    const incoming = workflowPositions(workflow.draft);
    if (this.writing && revision > this.state.revision) {
      if (revision >= (this.deferred?.layoutRevision ?? 0))
        this.deferred = workflow;
      return;
    }
    if (revision > this.state.revision && !this.writing) {
      this.acknowledged = merge(this.acknowledged, incoming);
      this.publish({
        revision,
        positions: merge(this.acknowledged, this.pending),
      });
    } else {
      const added = Object.fromEntries(
        Object.entries(incoming).filter(
          ([id]) => !Object.hasOwn(this.state.positions, id),
        ),
      );
      if (Object.keys(added).length) {
        this.acknowledged = merge(this.acknowledged, added);
        this.publish({ positions: merge(this.state.positions, added) });
      }
    }
  }

  update(positions: WorkflowPositions) {
    const changed = Object.fromEntries(
      Object.entries(positions).filter(
        ([id, position]) =>
          !equal(
            position,
            Object.hasOwn(this.state.positions, id)
              ? this.state.positions[id]
              : undefined,
          ),
      ),
    );
    if (!Object.keys(changed).length) return;
    this.pending = merge(this.pending, changed);
    this.publish({ positions: merge(this.state.positions, changed) });
    if (!this.state.error) void this.flush().catch(() => {});
  }

  private cache() {
    const patch = (value: unknown): unknown => {
      if (
        !value ||
        typeof value !== 'object' ||
        !('draft' in value) ||
        !('id' in value) ||
        value.id !== this.workflowId
      )
        return value;
      const workflow = value as LayoutWorkflow;
      if ((workflow.layoutRevision ?? 0) > this.state.revision) return value;
      return {
        ...workflow,
        draft: applyWorkflowPositions(workflow.draft, this.acknowledged),
        layoutRevision: this.state.revision,
      };
    };
    for (const filter of [
      trpc.workflows.list.pathFilter(),
      trpc.workflows.get.pathFilter(),
    ])
      this.client.setQueriesData(filter, (value: unknown) =>
        Array.isArray(value) ? value.map(patch) : patch(value),
      );
  }

  flush = async (): Promise<void> => {
    if (this.writing) return this.writing;
    if (this.state.error) throw new Error(this.state.error);
    if (!Object.keys(this.pending).length) return;
    this.publish({ saving: true });
    const writing = (async () => {
      while (Object.keys(this.pending).length) {
        const positions = this.pending;
        this.pending = {};
        try {
          const result = await api.workflows.saveLayout.mutate({
            id: this.workflowId,
            expectedRevision: this.state.revision,
            positions,
          });
          this.acknowledged = result.positions;
          this.publish({
            revision: result.revision,
            positions: merge(result.positions, this.pending),
          });
          this.cache();
        } catch (error) {
          this.pending = merge(positions, this.pending);
          this.publish({ error: errorMessage(error) });
          throw error;
        }
      }
    })();
    this.writing = writing;
    try {
      await writing;
    } finally {
      this.writing = undefined;
      if (this.deferred) {
        const deferred = this.deferred;
        this.deferred = undefined;
        this.receive(deferred);
      }
      this.publish({ saving: false });
      this.cleanup();
    }
  };

  retry = async () => {
    if (this.writing) return this.writing;
    this.publish({ saving: true });
    try {
      const workflow = await api.workflows.get.query({ id: this.workflowId });
      this.receive(workflow);
      this.publish({ error: '', saving: false });
      await this.flush();
    } catch (error) {
      this.publish({ error: errorMessage(error), saving: false });
    }
  };
}

export function useWorkflowLayout(workflow: LayoutWorkflow) {
  const client = useQueryClient();
  const session = useMemo(() => {
    let layouts = sessions.get(client);
    if (!layouts) sessions.set(client, (layouts = new Map()));
    let current = layouts.get(workflow.id);
    if (!current) {
      current = new LayoutSession(client, workflow.id, workflow, () => {
        if (layouts.get(workflow.id) === current) layouts.delete(workflow.id);
      });
      layouts.set(workflow.id, current);
    }
    return current;
  }, [client, workflow.id]);
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  useEffect(() => session.receive(workflow), [session, workflow]);
  return {
    ...state,
    update: (positions: WorkflowPositions) => session.update(positions),
    flush: session.flush,
    retry: session.retry,
    receive: (next: LayoutWorkflow) => session.receive(next),
    apply: (definition: WorkflowDefinition) =>
      applyWorkflowPositions(definition, session.state.positions),
  };
}
