import type { ExecutorPermissionMode } from '@interlock/core';

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
