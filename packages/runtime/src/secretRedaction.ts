import type { Json } from '@interlock/core';

/** Known-value masking is performed before validation, routing, or persistence. */
export function secretRedaction(secrets: string[]) {
  const variants = [
    ...new Set(
      secrets
        .filter(Boolean)
        .flatMap((value) => [
          value,
          encodeURIComponent(value),
          JSON.stringify(value).slice(1, -1),
          Buffer.from(value).toString('base64'),
        ]),
    ),
  ].sort((a, b) => b.length - a.length);
  // One pass prevents short secrets from matching text in the replacement itself.
  let pattern: RegExp | undefined;
  try {
    pattern = variants.length
      ? new RegExp(
          variants
            .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|'),
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
    return variants.reduce(
      (result, secret) => result.split(secret).join('[REDACTED]'),
      value,
    );
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
