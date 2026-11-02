import {
  definitionSchema,
  InterlockError,
  type WorkflowDefinition,
  type Workflow,
} from '@interlock/core';
import type { Engine } from '@interlock/runtime';
import { fingerprint } from '../../runtime/src/versionIdentity.js';
import {
  starters,
  type Starter,
  type StarterInstallation,
} from './starters.js';

/** Legacy copy recognition ignores canvas layout and declaration order, not behavior. */
function contentHash(definition: WorkflowDefinition) {
  const parsed = definitionSchema.parse(definition);
  return fingerprint({
    ...parsed,
    nodes: parsed.nodes
      .map(({ position: _position, ...node }) => node)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: [...parsed.edges].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
  });
}

export function seed(engine: Engine, catalog: readonly Starter[] = starters) {
  const ids = catalog.map((s) => s.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
  )
    throw new InterlockError(
      'Starter catalog IDs must be unique, stable nonblank identifiers',
    );
  engine.store.transaction(() => {
    const pending = catalog.filter(
      (s) => !engine.store.get('starterInstallations', s.id),
    );
    if (!pending.length) return;
    const marker = engine.store.get('meta', 'seed');
    const existing = engine.store.workflows();
    const legacyLibrary = Boolean(marker) || existing.length > 0;
    const retained = new Map<string, WorkflowDefinition[]>();
    for (const version of engine.store.listVersions()) {
      const definitions = retained.get(version.workflowId) ?? [];
      definitions.push(version.definition);
      retained.set(version.workflowId, definitions);
    }
    const captured = new Map<string, Set<string>>();
    const signatures = (workflow: Workflow) => {
      let hashes = captured.get(workflow.id);
      if (!hashes) {
        hashes = new Set(
          [workflow.draft, ...(retained.get(workflow.id) ?? [])].map(
            contentHash,
          ),
        );
        captured.set(workflow.id, hashes);
      }
      return hashes;
    };
    for (const starter of pending) {
      const definition = definitionSchema.parse(starter.template.definition);
      const templateHash = contentHash(definition);
      const receipt: StarterInstallation = {
        id: starter.id,
        outcome: 'installed',
        templateHash,
        recordedAt: new Date().toISOString(),
      };
      const matched = existing.find((w) => signatures(w).has(templateHash));
      if (matched) {
        receipt.outcome = 'recognized';
        receipt.workflowId = matched.id;
      } else if (starter.legacySeed && legacyLibrary) {
        // A missing SDLC may have been deleted; the old decision is final.
        receipt.outcome = 'legacy-skipped';
      } else if (existing.some((w) => w.name === starter.template.name)) {
        // A name is ambiguity evidence, never proof of official identity.
        receipt.outcome = 'name-collision';
      } else {
        const workflow = engine.create(
          starter.template.name,
          starter.template.description,
          definition,
        );
        engine.publish(workflow.id);
        receipt.workflowId = workflow.id;
      }
      // Delivery knowledge outlives edits, archive, deletion and catalog updates.
      engine.store.put('starterInstallations', receipt);
    }
    if (!marker)
      engine.store.put('meta', {
        id: 'seed',
        seededAt: new Date().toISOString(),
      });
  });
}
