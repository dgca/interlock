import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { interlockConfigDir } from '@interlock/core/dataPaths';

export interface DesktopSettings {
  workdir?: string;
}

export function desktopSettingsPath(configDir?: string): string {
  return join(configDir ?? interlockConfigDir(), 'desktop-settings.json');
}

export function readDesktopSettings(configDir?: string): DesktopSettings {
  const filePath = desktopSettingsPath(configDir);
  try {
    if (!existsSync(filePath)) return {};
    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) return {};
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const candidate = parsed as Record<string, unknown>;
      return {
        workdir:
          typeof candidate.workdir === 'string' ? candidate.workdir : undefined,
      };
    }
    return {};
  } catch {
    return {};
  }
}

export function writeDesktopSettings(
  settings: DesktopSettings,
  configDir?: string,
): DesktopSettings {
  const filePath = desktopSettingsPath(configDir);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf8');
  return settings;
}

function isExistingDirectory(path?: string): boolean {
  if (!path || !path.trim()) return false;
  try {
    return statSync(path.trim()).isDirectory();
  } catch {
    return false;
  }
}

export function resolveDesktopWorkdir(options?: {
  envWorkdir?: string;
  configDir?: string;
  home?: string;
  cwd?: string;
}): string {
  const envWorkdir = options?.envWorkdir ?? process.env.INTERLOCK_WORKDIR;
  if (isExistingDirectory(envWorkdir)) {
    return envWorkdir!.trim();
  }

  const savedWorkdir = readDesktopSettings(options?.configDir).workdir;
  if (isExistingDirectory(savedWorkdir)) {
    return savedWorkdir!.trim();
  }

  return options?.home ?? homedir();
}
