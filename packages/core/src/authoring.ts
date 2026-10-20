import { z } from 'zod';
import type { DraftDiagnostic } from './draftDiagnostics.js';

export const authoringSummarySchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  draftRevision: z.number().int().positive(),
  latestVersion: z.number().int().nonnegative(),
  draftMatchesLatest: z.boolean().nullable(),
  archived: z.boolean(),
});

export const draftDiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning']),
  category: z.enum(['save', 'publication', 'contract']),
  code: z.string(),
  path: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
  edgeId: z.string().optional(),
  operationIndex: z.number().int().nonnegative().optional(),
});
export const diagnosticSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  omitted: z.number().int().nonnegative(),
  unchangedWarnings: z.number().int().nonnegative(),
  counts: z.array(
    z.object({
      severity: z.enum(['error', 'warning']),
      code: z.string(),
      count: z.number().int().positive(),
    }),
  ),
});

function identity(d: DraftDiagnostic) {
  // Stable IDs identify graph members even when removals shift array indexes.
  const path = d.nodeId
    ? d.path.replace(/^nodes\.\d+(?=\.|$)/, 'nodes')
    : d.edgeId
      ? d.path.replace(/^edges\.\d+(?=\.|$)/, 'edges')
      : d.path;
  return JSON.stringify([
    d.severity,
    d.category,
    d.code,
    d.nodeId,
    d.edgeId,
    path,
    d.message,
    d.operationIndex,
  ]);
}

export function summarizeDiagnostics(
  before: DraftDiagnostic[],
  after: DraftDiagnostic[],
) {
  const existing = new Set(before.map(identity));
  const unique = [...new Map(after.map((d) => [identity(d), d])).values()];
  const unchanged = unique.filter(
    (d) => d.severity === 'warning' && existing.has(identity(d)),
  );
  const diagnostics = [
    ...unique.filter(
      (d) => d.severity === 'error' || !existing.has(identity(d)),
    ),
    ...unchanged.slice(0, 5),
  ];
  const counts = new Map<
    string,
    { severity: 'error' | 'warning'; code: string; count: number }
  >();
  for (const d of unique) {
    const key = JSON.stringify([d.severity, d.code]);
    const count = counts.get(key) ?? {
      severity: d.severity,
      code: d.code,
      count: 0,
    };
    count.count++;
    counts.set(key, count);
  }
  return {
    diagnostics,
    diagnosticSummary: {
      total: unique.length,
      returned: diagnostics.length,
      omitted: unique.length - diagnostics.length,
      unchangedWarnings: unchanged.length,
      counts: [...counts.values()],
    },
  };
}
