import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

/**
 * Keeps protected-variable keys out of the user's Interlock key folder.
 * Each test file gets its own temporary key file, inherited by spawned servers.
 */
const userKeys = join(
  process.platform === 'darwin'
    ? join(homedir(), 'Library/Application Support/Interlock')
    : join(
        process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
        'interlock',
      ),
  'keys',
);
const listKeys = () => {
  try {
    return readdirSync(userKeys);
  } catch {
    return [];
  }
};
const before = new Set(listKeys());
const dir = mkdtempSync(join(tmpdir(), 'interlock-keys-'));
process.env.INTERLOCK_SECRET_KEY_FILE = join(dir, 'secret.key');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  const added = listKeys().filter((name) => !before.has(name));
  if (added.length)
    throw new Error(
      `Tests wrote ${added.join(', ')} to the user key folder ${userKeys}. Use a temporary key file.`,
    );
});
