import type { Json } from '@interlock/core';
import { inspect } from 'node:util';

const escapePattern = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Known-value masking is performed before validation, routing, or persistence. */
export function secretRedaction(secrets: string[]) {
  const variants = [
    ...new Set(
      secrets.filter(Boolean).flatMap((value) => [
        value,
        encodeURIComponent(value),
        JSON.stringify(value).slice(1, -1),
        Buffer.from(value).toString('base64'),
        inspect(value),
        inspect(value, {
          maxStringLength: Infinity,
          breakLength: Infinity,
          compact: true,
        }),
        inspect(value, {
          maxStringLength: Infinity,
          breakLength: Infinity,
          compact: true,
        }).slice(1, -1),
      ]),
    ),
  ].sort((a, b) => b.length - a.length);
  // Node can split multiline strings into quoted pieces. Object nesting changes
  // continuation indentation, and can wrap values that fit on one line alone.
  const inspected = secrets.filter(Boolean).flatMap((value) =>
    [
      inspect(value, { breakLength: 1 }),
      inspect(value, { breakLength: 1, maxStringLength: Infinity }),
    ]
      .filter((layout) => layout.includes('\n'))
      .map((layout) =>
        layout
          .split(/\n[ \t]*/)
          .map(escapePattern)
          .join('\\n[ \\t]*'),
      ),
  );
  // One pass prevents short secrets from matching text in the replacement itself.
  let pattern: RegExp | undefined;
  try {
    pattern = variants.length
      ? new RegExp(
          [...new Set([...inspected, ...variants.map(escapePattern)])].join(
            '|',
          ),
          'g',
        )
      : undefined;
  } catch {
    /* Native regexp errors may quote their pattern; never propagate them. */
  }
  const text = (value: string) => {
    if (!variants.length) return value;
    try {
      if (pattern) return value.replace(pattern, '[REDACTED]');
    } catch {
      /* Fall back without exposing a native pattern diagnostic. */
    }
    // Preserve no diagnostic text if the complete matcher cannot run safely.
    return '[REDACTED]';
  };
  const json = (value: Json): Json => {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(json);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [text(key), json(v)]),
      );
    if (text(String(value)) !== String(value)) return '[REDACTED]';
    return value;
  };
  return { text, json };
}
