import { z } from 'zod';
import { jsonSchema } from './index.js';
export const assignmentSizeQuerySchema = z.object({
  workId: z.string().min(1).optional(),
  workflowId: z.string().min(1).optional(),
  nodeId: z.string().min(1).optional(),
  version: z.number().int().positive().optional(),
  sample: z
    .object({
      input: z.lazy(() => jsonSchema).optional(),
      runInput: z.lazy(() => jsonSchema).optional(),
      rootInput: z.lazy(() => jsonSchema).optional(),
      itemInput: z.lazy(() => jsonSchema).optional(),
      outputs: z.record(z.lazy(() => jsonSchema)).optional(),
    })
    .optional(),
  warningBytes: z.number().int().min(1).max(100_000_000).default(100_000),
});
export type AssignmentSizeQuery = z.input<typeof assignmentSizeQuerySchema>;
export type SizePart =
  | { state: 'known'; value: unknown }
  | { state: 'absent' }
  | { state: 'unknown' };
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
const pointer = (value: string) =>
  value.replaceAll('~', '~0').replaceAll('/', '~1');

/** UTF-8 sizes of compact JSON field values, not tokens or transport envelopes. */
export function measureAssignment(
  parts: Record<string, SizePart>,
  warningBytes: number,
) {
  const components = Object.fromEntries(
    Object.entries(parts).map(([name, part]) => [
      name,
      {
        state: part.state,
        bytes:
          part.state === 'unknown'
            ? null
            : part.state === 'absent'
              ? 0
              : bytes(part.value),
      },
    ]),
  );
  const knownBytes = Object.values(components).reduce(
    (sum, part) => sum + (part.bytes ?? 0),
    0,
  );
  const complete = Object.values(parts).every(
    (part) => part.state !== 'unknown',
  );
  const largeFields: { path: string; bytes: number; pathTruncated: boolean }[] =
    [];
  const strings = new Map<string, { bytes: number; count: number }>();
  const stack = Object.entries(parts).flatMap(([name, part]) =>
    part.state === 'known'
      ? [{ path: '/' + name, value: part.value, depth: 0 }]
      : [],
  );
  let scanned = 0;
  while (stack.length && scanned < 10000) {
    const { path, value, depth } = stack.pop()!;
    scanned++;
    if (typeof value === 'string' && value.length >= 64) {
      const previous = strings.get(value);
      if (previous) previous.count++;
      else strings.set(value, { bytes: bytes(value), count: 1 });
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        const childPath = path + '/' + pointer(key);
        // Top-level fields are disjoint within a component; deep traversal only finds repetition.
        if (depth === 0)
          largeFields.push({
            path: childPath.slice(0, 256),
            bytes: bytes(child),
            pathTruncated: childPath.length > 256,
          });
        if (stack.length + scanned < 10001)
          stack.push({
            path: childPath.slice(0, 256),
            value: child,
            depth: depth + 1,
          });
        else break;
      }
    }
  }
  const repeats = [...strings.values()].filter((value) => value.count > 1);
  return {
    unit: 'utf8_bytes' as const,
    components,
    knownBytes,
    totalBytes: complete ? knownBytes : null,
    warningBytes,
    warnings: [
      ...(knownBytes >= warningBytes ? ['large_assignment'] : []),
      ...(!complete ? ['incomplete_preview'] : []),
    ],
    largeFields: largeFields
      .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
      .slice(0, 10),
    repetition: {
      groups: repeats.length,
      repeatedBytes: repeats.reduce(
        (sum, value) => sum + value.bytes * (value.count - 1),
        0,
      ),
    },
    diagnosticsTruncated: stack.length > 0 || largeFields.length > 10,
  };
}
