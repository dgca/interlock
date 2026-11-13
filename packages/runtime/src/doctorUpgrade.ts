import type { DiagnosticCheck } from '@interlock/core';
import type { Engine } from './index.js';

/** 0.3.0 removes variable enable/disable and deletes variables that are disabled at upgrade time. */
export function upgradeChecks(engine: Engine): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  try {
    const disabled = engine.variables.disabledReferences();
    for (const variable of disabled) {
      const references = variable.workflows.map((w) => {
        const parts = [
          ...(w.draft ? ['draft'] : []),
          ...w.versions.map((v) => `v${v}`),
        ];
        return `"${w.name}" (${parts.join(', ')})`;
      });
      checks.push({
        category: 'system',
        name: `0.3.0 upgrade: disabled variable ${variable.name}`,
        status: 'warn',
        message: references.length
          ? `Variable "${variable.name}" is disabled and referenced by ${references.join(', ')}`
          : `Variable "${variable.name}" is disabled and not referenced by any workflow`,
        details: { variableId: variable.id, workflows: variable.workflows },
        remediation: `Enable "${variable.name}" in Variables to keep it, or leave it disabled and upgrading to 0.3.0 deletes it.`,
      });
    }
    if (disabled.length === 0)
      checks.push({
        category: 'system',
        name: '0.3.0 upgrade: disabled variables',
        status: 'ok',
        message:
          'No disabled variables; upgrading to 0.3.0 needs no manual step',
      });
  } catch (err) {
    checks.push({
      category: 'system',
      name: '0.3.0 upgrade: disabled variables',
      status: 'warn',
      message: `Failed to inspect disabled variables: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  return checks;
}
