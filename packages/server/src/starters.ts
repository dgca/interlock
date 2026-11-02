import {
  definitionSchema,
  InterlockError,
  type WorkflowDefinition,
  type Workflow,
} from '@interlock/core';
import type { Engine } from '@interlock/runtime';
import { fingerprint } from '../../runtime/src/versionIdentity.js';
import sdlc from '../../../workflows/sdlc.json';
import evaluate from '../../../workflows/evaluate.json';

const catalog = [
  {
    id: 'sdlc',
    template: sdlc,
    summary: 'Plan, implement, and review a software change.',
    requirements:
      'Needs a coding agent with repository access and a fresh final reviewer.',
  },
  {
    id: 'evaluate-comparison',
    template: evaluate,
    summary: 'Evaluate retained comparison results against a fixed rubric.',
    requirements:
      'Needs a completed workflow comparison. Review mode requires a fresh reviewer.',
  },
] as const;
interface Copy {
  id: string;
  starterId: string;
}
interface Receipt {
  id: string;
  requestHash: string;
  workflowId: string;
  created: boolean;
}
function contentHash(definition: WorkflowDefinition) {
  const d = definitionSchema.parse(definition);
  const order = (a: { id: string }, b: { id: string }) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return fingerprint({
    ...d,
    nodes: d.nodes.map(({ position: _position, ...n }) => n).sort(order),
    edges: [...d.edges].sort(order),
  });
}
function existing(
  engine: Engine,
  starterId: string,
  definition: WorkflowDefinition,
) {
  const workflows = engine.store.workflows();
  const known = new Set(
    engine.store
      .list<Copy>('starterCopies')
      .filter((c) => c.starterId === starterId)
      .map((c) => c.id),
  );
  const tracked = workflows.find((w) => known.has(w.id));
  if (tracked) return tracked;
  const hash = contentHash(definition);
  const retained = engine.store.listVersions();
  return workflows.find((w) =>
    [
      w.draft,
      ...retained.filter((v) => v.workflowId === w.id).map((v) => v.definition),
    ].some((d) => contentHash(d) === hash),
  );
}
const reference = (w: Workflow) => ({
  id: w.id,
  name: w.name,
  archived: w.archived,
  latestVersion: w.latestVersion,
});
export function listStarters(engine: Engine) {
  return catalog.map((s) => {
    const definition = definitionSchema.parse(s.template.definition),
      copy = existing(engine, s.id, definition);
    return {
      id: s.id,
      name: s.template.name,
      description: s.summary,
      requirements: s.requirements,
      nodeCount: definition.nodes.length,
      ...(copy ? { existing: reference(copy) } : {}),
    };
  });
}
export function importStarter(
  engine: Engine,
  q: { starterId: string; requestId: string; copy?: boolean },
) {
  if (!q.requestId || q.requestId.length > 120 || !/\S/.test(q.requestId))
    throw new InterlockError(
      'Use a nonblank request key of at most 120 characters',
    );
  const starter = catalog.find((s) => s.id === q.starterId);
  if (!starter) throw new InterlockError('Starter not found');
  return engine.store.transaction(() => {
    const id = fingerprint(q.requestId),
      requestHash = fingerprint({
        starterId: q.starterId,
        copy: q.copy ?? false,
      });
    const prior = engine.store.get<Receipt>('starterImports', id);
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new InterlockError(
          'Starter requestId was already used with different arguments',
        );
      const workflow = engine.store.get<Workflow>(
        'workflows',
        prior.workflowId,
      );
      if (!workflow)
        throw new InterlockError(
          'The imported workflow was deleted. Inspect the library before intentionally adding a new copy.',
        );
      return { workflow: reference(workflow), created: prior.created };
    }
    const definition = definitionSchema.parse(starter.template.definition);
    const found = q.copy ? undefined : existing(engine, starter.id, definition);
    const workflow =
      found ??
      engine.create(
        starter.template.name,
        starter.template.description,
        definition,
      );
    if (!found) engine.publish(workflow.id);
    engine.store.put<Copy>('starterCopies', {
      id: workflow.id,
      starterId: starter.id,
    });
    engine.store.put<Receipt>('starterImports', {
      id,
      requestHash,
      workflowId: workflow.id,
      created: !found,
    });
    return {
      workflow: reference(engine.workflow(workflow.id)),
      created: !found,
    };
  });
}
