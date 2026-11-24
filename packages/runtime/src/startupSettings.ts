import type { DiagnosticCheck, StartupSettings } from '@interlock/core';
import type { Store } from '@interlock/storage';

export function configuredAllowedRoots(
  store: Store,
  options: { startupSettings?: StartupSettings; allowedRoots?: string[] },
): string[] {
  const startup = options.startupSettings?.allowedRoots;
  if (startup?.controlledByConfig) return [...startup.value];
  const stored = store.get<{ id: string; allowedRoots?: string[] }>(
    'executorSettings',
    'shared',
  );
  return [
    ...(startup?.value ?? options.allowedRoots ?? []),
    ...(stored?.allowedRoots ?? []),
  ];
}

export function operatorConfigChecks(
  settings?: StartupSettings,
): DiagnosticCheck[] {
  if (!settings) return [];
  const { configFile, requireToken, allowedRoots, logLevel, syncDir } =
    settings;
  const suffix = requireToken.forced
    ? '. Required on non-loopback listeners.'
    : '';
  const roots = allowedRoots.value.length
    ? JSON.stringify(allowedRoots.value)
    : '[]';
  const rows = [
    {
      name: 'Config file',
      message: `${configFile.found ? 'Found' : 'Not found'} · ${configFile.path}`,
      details: configFile,
    },
    {
      name: 'requireToken',
      message: `${requireToken.value} (${requireToken.source})${suffix}`,
      details: { ...requireToken },
    },
    {
      name: 'allowedRoots',
      message: `${roots} (${allowedRoots.source})`,
      details: { ...allowedRoots, value: [...allowedRoots.value] },
    },
    {
      name: 'logLevel',
      message: `${logLevel.value} (${logLevel.source})`,
      details: { ...logLevel },
    },
    {
      name: 'syncDir',
      message: `${syncDir.value ?? 'Off'} (${syncDir.source})`,
      details: { ...syncDir },
    },
  ];
  return rows.map((row) => ({ ...row, category: 'system', status: 'ok' }));
}
