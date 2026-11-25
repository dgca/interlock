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
  effectiveRoots?: string[],
): DiagnosticCheck[] {
  if (!settings) return [];
  const {
    configFile,
    host,
    publicUrl,
    requireToken,
    allowedRoots,
    logLevel,
    syncDir,
  } = settings;
  const { forcedBy, ...tokenDetails } = requireToken;
  const suffix =
    forcedBy === 'public URL'
      ? '. Required when the public URL has a non-loopback hostname.'
      : forcedBy === 'non-loopback listener'
        ? '. Required on non-loopback listeners.'
        : '';
  // Saved shared roots add to the startup list unless the config file declares the key.
  const effective = effectiveRoots ?? allowedRoots.value;
  const saved = effective.length > allowedRoots.value.length;
  const roots = JSON.stringify(effective);
  const rows = [
    {
      name: 'Config file',
      message: `${configFile.found ? 'Found' : 'Not found'} · ${configFile.path}`,
      details: configFile,
    },
    {
      name: 'requireToken',
      message: `${requireToken.value} (${requireToken.source})${suffix}`,
      details: tokenDetails,
    },
    {
      name: 'host',
      message: `${host.value} (${host.source})`,
      details: { ...host },
    },
    {
      name: 'publicUrl',
      message: `${publicUrl.value ?? 'Not set'} (${publicUrl.source})`,
      details: { ...publicUrl },
    },
    {
      name: 'allowedRoots',
      message: `${roots} (${allowedRoots.source}${saved ? ' and saved shared roots' : ''})${
        allowedRoots.controlledByConfig
          ? '. Saved shared roots are ignored while the config file declares allowedRoots.'
          : ''
      }`,
      details: {
        ...allowedRoots,
        value: [...allowedRoots.value],
        effective: [...effective],
      },
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
