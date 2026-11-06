import { InterlockError, type Json } from './index.js';

export function parseDataPath(path: string): string[] {
  if (!path || path === '$') return [];
  const keys = path.replace(/^\$\./, '').split('.');
  if (
    keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))
  )
    throw new InterlockError('Invalid data path');
  return keys;
}

export function readPath(value: Json, path: string): Json {
  let result: Json | undefined = value;
  for (const key of parseDataPath(path)) {
    result =
      result !== null &&
      typeof result === 'object' &&
      Object.hasOwn(result, key)
        ? (result as Record<string, Json>)[key]
        : undefined;
  }
  if (result === undefined)
    throw new InterlockError(`Input has no path "${path}"`);
  return result;
}
