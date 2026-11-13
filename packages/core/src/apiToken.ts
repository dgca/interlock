import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Node-only helpers. Browser code must not import this module.

/** Per-user Interlock configuration folder that holds protected-value keys. */
export function interlockConfigDir() {
  return process.platform === 'darwin'
    ? join(homedir(), 'Library/Application Support/Interlock')
    : join(
        process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
        'interlock',
      );
}

/** The API token sits beside the protected-value key, including a configured key file. */
export function apiTokenPath() {
  const keyFile = process.env.INTERLOCK_SECRET_KEY_FILE;
  return keyFile
    ? join(dirname(resolve(keyFile)), 'api-token')
    : join(interlockConfigDir(), 'keys', 'api-token');
}

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

function readOwnerOnly(path: string): string {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error(
        `API token file ${path} must be a regular file readable only by its owner (chmod 600).`,
      );
    const token = readFileSync(fd, 'utf8').trim();
    if (!tokenPattern.test(token))
      throw new Error(
        `API token file ${path} is malformed. Delete it and restart Interlock to create a new token.`,
      );
    return token;
  } finally {
    closeSync(fd);
  }
}

/**
 * Reads the token for first-party clients. A missing or unusable file sends no
 * token: an engine that does not require one keeps working, and one that does
 * answers with its own explanation. Unusable files are reported on stderr.
 */
export function readApiToken(path = apiTokenPath()): string | undefined {
  try {
    return readOwnerOnly(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

/** Creates the owner-only token file on first use and returns its token. */
export function ensureApiToken(path = apiTokenPath()): string {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  let fd: number | undefined;
  try {
    fd = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(fd, `${randomBytes(32).toString('base64url')}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return readOwnerOnly(path);
}
