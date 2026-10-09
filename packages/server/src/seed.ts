import { definitionSchema } from '@interlock/core';
import type { Engine } from '@interlock/runtime';
import sdlcWorkflow from '../../../workflows/sdlc.json';

export function seed(engine: Engine) {
  // Seed exactly once per database. Deleting every workflow is permanent.
  if (engine.store.get('meta', 'seed')) return;
  engine.store.transaction(() => {
    // Existing libraries, including stores predating the marker, stay intact.
    if (!engine.store.workflows().length) {
      const workflow = engine.create(
        sdlcWorkflow.name,
        sdlcWorkflow.description,
        definitionSchema.parse(sdlcWorkflow.definition),
      );
      engine.publish(workflow.id);
    }
    engine.store.put('meta', {
      id: 'seed',
      seededAt: new Date().toISOString(),
    });
  });
}
