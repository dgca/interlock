/** Only visible content is serialized; binary and reasoning blocks never enter capture. */
export function transcriptText(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  if (depth > 6) return '[Nested content omitted]';
  if (Array.isArray(value))
    return value
      .slice(0, 100)
      .map((v) => transcriptText(v, depth + 1))
      .filter(Boolean)
      .join('\n');
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (
      [
        'image',
        'image_url',
        'input_image',
        'reasoning',
        'thinking',
        'redacted_thinking',
      ].includes(String(v.type))
    )
      return '[Non-text content omitted]';
    if (v.type === 'text' && typeof v.text === 'string') return v.text;
    const clean = Object.fromEntries(
      Object.entries(v)
        .slice(0, 100)
        .filter(
          ([k]) =>
            ![
              'reasoning',
              'thinking',
              'signature',
              'encrypted_content',
              'base64',
              'image',
              'data',
            ].includes(k),
        )
        .map(([k, v]) => [
          k,
          typeof v === 'object'
            ? transcriptText(v, depth + 1)
            : typeof v === 'string' && v.length > 1024 * 1024
              ? '[Oversized value omitted]'
              : v,
        ]),
    );
    return JSON.stringify(clean);
  }
  return JSON.stringify(value);
}
