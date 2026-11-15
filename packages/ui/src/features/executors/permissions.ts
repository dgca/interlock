import {
  harnessPermissions,
  type ExecutorPermissionMode,
  type PermissionSource,
} from '@interlock/core';

export const permissionLabels: Record<ExecutorPermissionMode, string> = {
  'read-only': 'Read only',
  standard: 'Standard',
  'full-access': 'Full access',
};
export const permissionDescriptions: Record<ExecutorPermissionMode, string> = {
  'read-only': 'Inspect and analyze without modifying files.',
  standard: "Use the harness's Standard mode and ask for approval when needed.",
  'full-access':
    'Modify files and run commands without routine approval stops. Native and organization restrictions still apply.',
};
export const permissionOptions = (
  ['read-only', 'standard', 'full-access'] as const
).map((value) => ({ value, label: permissionLabels[value] }));

/** Where a level came from, for helper lines and execution details. */
export function permissionSourceLabel(
  source: PermissionSource,
  harness?: string,
) {
  if (source === 'preset') return 'agent preset';
  if (source === 'workflow') return 'workflow override';
  if (source === 'global') return 'from AI Settings';
  return harness ? `set on ${harness}` : 'harness default';
}

/**
 * The inherited level, or undefined while the shared default is still loading
 * or failed to load and the harness sets no level of its own.
 */
export function knownPermissions(
  profile: { permissions?: ExecutorPermissionMode } | undefined,
  settings: { defaultPermissions?: ExecutorPermissionMode } | undefined,
) {
  return profile?.permissions || settings
    ? harnessPermissions(profile, settings?.defaultPermissions)
    : undefined;
}
/** "Use default", with the level it resolves to once that is known. */
export function defaultOptionLabel(
  settings: { defaultPermissions?: ExecutorPermissionMode } | undefined,
) {
  const level = knownPermissions(undefined, settings)?.permissions;
  return level ? `Use default · ${permissionLabels[level]}` : 'Use default';
}
