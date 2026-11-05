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
  let pattern: RegExp | undefined;
  let layouts: RegExp[] = [];
  try {
    layouts = [...new Set(inspected)].map((source) => new RegExp(source, 'y'));
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
    pattern = undefined;
  }
  const text = (value: string) => {
    if (!variants.length) return value;
    try {
      if (pattern) {
        // Find complete coverage before replacing anything. A shorter inspected
        // layout can also be a prefix of a longer literal credential, and
        // credentials can overlap at different offsets in the same diagnostic.
        const ranges: [number, number][] = [];
        let matches = 0;
        pattern.lastIndex = 0;
        for (
          let match = pattern.exec(value);
          match;
          match = pattern.exec(value)
        ) {
          // Bound repeated/overlapping matching work; discard text on excess.
          if (++matches > 10000) return '[REDACTED]';
          const start = match.index;
          let end = start + match[0].length;
          for (const literal of variants) {
            if (literal.length <= end - start) break;
            if (value.startsWith(literal, start)) {
              end = start + literal.length;
              break;
            }
          }
          for (const layout of layouts) {
            layout.lastIndex = start;
            if (layout.test(value)) end = Math.max(end, layout.lastIndex);
          }
          const previous = ranges.at(-1);
          if (previous && start <= previous[1])
            previous[1] = Math.max(previous[1], end);
          else ranges.push([start, end]);
          pattern.lastIndex = start + 1;
        }
        // Replacement text is never scanned, even with short Secret values.
        let cursor = 0;
        const output = ranges.map(([start, end]) => {
          const before = value.slice(cursor, start);
          cursor = end;
          return `${before}[REDACTED]`;
        });
        return output.join('') + value.slice(cursor);
      }
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
