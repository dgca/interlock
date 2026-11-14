import type { SavedVariable, VariableRequirement } from '@interlock/core';
import type { Engine } from '@interlock/runtime';

/**
 * Give a starter's variable references a local identity without a value, as
 * a bundle import's "Provision locally, set the value later" does. An
 * identity already present, from an earlier copy or a file import, is kept,
 * so copies share one credential. A taken name gets a numbered suffix.
 */
export function provisionStarterVariables(
  engine: Engine,
  requirements: readonly VariableRequirement[] = [],
) {
  for (const requirement of requirements) {
    if (
      engine.store.get('variables', requirement.id) ||
      engine.store.get('variableBindings', requirement.id)
    )
      continue;
    const taken = new Set(
      engine.store
        .list<SavedVariable>('variables')
        .map((v) => v.name.toLowerCase()),
    );
    let name = requirement.name;
    for (let n = 2; taken.has(name.toLowerCase()); n++)
      name = `${requirement.name}_${n}`;
    engine.variables.importRequirements([requirement], {
      [requirement.id]: { action: 'provision', name },
    });
  }
}
