import type { api } from '../../lib/api';

export type HarnessProfile = Awaited<
  ReturnType<typeof api.executors.profiles.query>
>[number];

const builtInNames = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  pi: 'Pi',
};

export function isPrimaryHarness(profile: HarnessProfile) {
  return profile.harness === 'custom' || profile.id === profile.harness;
}

export function harnessLabel(profile: HarnessProfile) {
  return isPrimaryHarness(profile) && profile.harness !== 'custom'
    ? builtInNames[profile.harness]
    : profile.name;
}

export function isAvailableHarness(profile: HarnessProfile) {
  return harnessAvailability(profile) === undefined;
}

export function harnessAvailability(profile: HarnessProfile) {
  if (!profile.enabled) return 'disabled';
  if (profile.detection.status !== 'detected') return 'unavailable';
}

export function integrationReturnFocusId(profileId?: string) {
  return profileId ? `harness-defaults-${profileId}` : 'add-integration';
}
