import { readFile } from 'node:fs/promises';

/** A JSON command argument, inline or read from `@file`. */
export async function parse(value: string | undefined) {
  if (value === undefined) throw new Error('Missing JSON argument');
  return JSON.parse(
    value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value,
  );
}
