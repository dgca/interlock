import type { ExecutorProfile } from '@interlock/core';

/** The editable fields of a custom integration. */
export function profileDraft(profile: ExecutorProfile | null) {
  return {
    name: profile?.name ?? '',
    mode: profile?.mode ?? 'direct',
    transport: profile?.transport ?? 'subprocess',
    concurrency: profile?.concurrency ?? ('' as const),
    timeoutSeconds: profile?.timeoutSeconds ?? ('' as const),
    clientTimeoutSeconds: profile?.clientTimeoutSeconds ?? ('' as const),
    permissions: profile?.permissions ?? 'standard',
    env: profile?.env ?? {},
    headers: profile?.headers ?? {},
    turnCommand: profile?.turnCommand ?? profile?.command ?? '',
    turnUrl: profile?.turnUrl ?? '',
    launchCommand: profile?.launchCommand ?? '',
    launchUrl: profile?.launchUrl ?? '',
    statusCommand: profile?.statusCommand ?? '',
    statusUrl: profile?.statusUrl ?? '',
    messageCommand: profile?.messageCommand ?? '',
    messageUrl: profile?.messageUrl ?? '',
    stopCommand: profile?.stopCommand ?? '',
    stopUrl: profile?.stopUrl ?? '',
    archiveCommand: profile?.archiveCommand ?? '',
    archiveUrl: profile?.archiveUrl ?? '',
    cwd: profile?.cwd ?? '',
    allowedRoots: profile?.allowedRoots ?? [],
    sessionNameTemplate: profile?.sessionNameTemplate ?? '',
    resumeCommandTemplate: profile?.resumeCommandTemplate ?? '',
    deepLinkTemplate: profile?.deepLinkTemplate ?? '',
  };
}

/**
 * Saved fields the form does not edit, such as recovery policies or settings
 * added by newer versions, so saving the form keeps them.
 */
export function preservedFields(profile: ExecutorProfile | undefined) {
  const owned = new Set([
    ...Object.keys(profileDraft(null)),
    'command',
    'revision',
    'detection',
  ]);
  return Object.fromEntries(
    Object.entries(profile ?? {}).filter(([key]) => !owned.has(key)),
  );
}
