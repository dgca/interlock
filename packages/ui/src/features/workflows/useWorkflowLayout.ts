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
type Notice = {
  id: string;
  name: string;
  saving: boolean;
  error: string;
  retry: () => Promise<void>;
};
type Registry = {
  sessions: Map<string, LayoutSession>;
  snapshot: () => Notice[];
  subscribe: (listener: () => void) => () => void;
  publish: () => void;
};
const registries = new WeakMap<Client, Registry>();
function registryFor(client: Client): Registry {
  let existing = registries.get(client);
  if (existing) return existing;
  const sessions = new Map<string, LayoutSession>();
  const listeners = new Set<() => void>();
  let notices: Notice[] = [];
  let guarded = false;
  const beforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  };
  const registry: Registry = {
    sessions,
    snapshot: () => notices,
    subscribe: (listener) => {
      listeners.add(listener);
      registry.publish();
      return () => {
        listeners.delete(listener);
        queueMicrotask(() => registry.publish());
      };
    },
    publish: () => {
      notices = [...sessions.values()]
        .filter((session) => session.unsaved)
        .map((session) => ({
          id: session.id,
          name: session.name,
          saving: session.state.saving,
          error: session.state.error,
          retry: session.retry,
        }));
      const shouldGuard =
        Boolean(notices.length) &&
        (listeners.size > 0 ||
          [...sessions.values()].some((session) => session.observed));
      if (shouldGuard !== guarded) {
        guarded = shouldGuard;
        if (guarded) window.addEventListener('beforeunload', beforeUnload);
        else window.removeEventListener('beforeunload', beforeUnload);
      }
      listeners.forEach((listener) => listener());
    },
  };
  registries.set(client, registry);
  return registry;
}

class LayoutSession {
  state: State;
  private acknowledged: WorkflowPositions;
  private pending: WorkflowPositions = {};
  private writing?: Promise<void>;
  private deferred?: LayoutWorkflow;
  private forgotten = false;
  private listeners = new Set<() => void>();

  constructor(
    private client: Client,
    readonly id: string,
    workflow: LayoutWorkflow,
    private registry: Registry,
  ) {
    this.name = workflow.name;
    this.acknowledged = workflowPositions(workflow.draft);
    this.state = {
      revision: workflow.layoutRevision ?? 0,
      positions: this.acknowledged,
      saving: false,
      error: '',
    };
  }

  name: string;
  get observed() {
    return this.listeners.size > 0;
  }
  get unsaved() {
    return (
      !this.forgotten &&
      (this.state.saving ||
        Boolean(this.state.error) ||
        Boolean(Object.keys(this.pending).length))
    );
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    if (!this.forgotten) this.registry.sessions.set(this.id, this);
    this.listeners.add(listener);
    this.registry.publish();
    return () => {
      this.listeners.delete(listener);
      this.cleanup();
    };
  };
  private cleanup() {
    queueMicrotask(() => {
      this.registry.publish();
      if (
        !this.listeners.size &&
        !this.writing &&
        !Object.keys(this.pending).length &&
        this.registry.sessions.get(this.id) === this
      ) {
        this.registry.sessions.delete(this.id);
        this.registry.publish();
      }
    });
  }
  private publish(next: Partial<State>) {
    this.state = { ...this.state, ...next };
    this.registry.publish();
    this.listeners.forEach((listener) => listener());
  }

  receive(workflow: LayoutWorkflow) {
    if (this.forgotten) return;
    if (workflow.name !== this.name) {
      this.name = workflow.name;
      this.registry.publish();
    }
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
    if (this.forgotten) return;
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
        value.id !== this.id
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
    this.client.setQueriesData(
      trpc.workflows.get.queryFilter({ id: this.id }),
      patch,
    );
  }

  flush = (): Promise<void> => {
    if (this.forgotten) return Promise.resolve();
    if (this.writing) return this.writing;
    if (this.state.error) return Promise.reject(new Error(this.state.error));
    if (!Object.keys(this.pending).length) return Promise.resolve();
    const writing = Promise.resolve().then(async () => {
      try {
        while (Object.keys(this.pending).length) {
          const positions = this.pending;
          this.pending = {};
          try {
            const result = await api.workflows.saveLayout.mutate({
              id: this.id,
              expectedRevision: this.state.revision,
              positions,
            });
            if (this.forgotten) return;
            this.acknowledged = result.positions;
            this.publish({
              revision: result.revision,
              positions: merge(result.positions, this.pending),
            });
            this.cache();
          } catch (error) {
            if (this.forgotten) return;
            this.pending = merge(positions, this.pending);
            this.publish({ error: errorMessage(error) });
            throw error;
          }
        }
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
    });
    this.writing = writing;
    this.publish({ saving: true });
    return writing;
  };

  retry = async () => {
    if (this.forgotten) return;
    if (this.writing) return this.writing;
    this.publish({ saving: true });
    try {
      const workflow = await api.workflows.get.query({ id: this.id });
      this.receive(workflow);
      this.publish({ error: '', saving: false });
      await this.flush();
    } catch (error) {
      this.publish({ error: errorMessage(error), saving: false });
    }
  };
  forget = () => {
    this.forgotten = true;
    this.pending = {};
    this.publish({ saving: false, error: '' });
    if (this.registry.sessions.get(this.id) === this)
      this.registry.sessions.delete(this.id);
    this.registry.publish();
  };
}

export function useWorkflowLayout(workflow: LayoutWorkflow) {
  const client = useQueryClient();
  const session = useMemo(() => {
    const registry = registryFor(client);
    let current = registry.sessions.get(workflow.id);
    if (!current) {
      current = new LayoutSession(client, workflow.id, workflow, registry);
      registry.sessions.set(workflow.id, current);
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

export function usePendingWorkflowLayouts() {
  const client = useQueryClient();
  const registry = useMemo(() => registryFor(client), [client]);
  return useSyncExternalStore(registry.subscribe, registry.snapshot);
}

export function forgetWorkflowLayout(client: Client, workflowId: string) {
  registries.get(client)?.sessions.get(workflowId)?.forget();
}
