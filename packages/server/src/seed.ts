import { definitionSchema } from '@interlock/core';
import type { Engine } from '@interlock/runtime';
import sdlcDefinition from './workflows/sdlc.json';

export function seed(engine: Engine) {
  // Seed exactly once per database. Deleting every workflow is permanent.
  if (engine.store.get('meta', 'seed')) return;
  engine.store.transaction(() => {
    // Existing libraries, including stores predating the marker, stay intact.
    if (!engine.store.workflows().length) {
      const workflow = engine.create(
        'SDLC workflow',
        'Plan, implement, and verify a software change from a request. Resolve the target repository and task artifacts, pause for unresolved human decisions, and require a fresh-context final review. Finish locally by default, with optional PR creation.',
        definitionSchema.parse(sdlcDefinition),
      );
      engine.publish(workflow.id);
    }
    engine.store.put('meta', {
      id: 'seed',
      seededAt: new Date().toISOString(),
    });
  });
}
