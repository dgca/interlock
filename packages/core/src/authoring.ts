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

function warningIdentity(d: DraftDiagnostic, ignoreArrayIndex = false) {
  let path = d.path;
  // Compare warnings across edits by stable ID, but deduplicate exact paths.
  if (ignoreArrayIndex) {
    if (d.nodeId) path = path.replace(/^nodes\.\d+(?=\.|$)/, 'nodes');
    else if (d.edgeId) path = path.replace(/^edges\.\d+(?=\.|$)/, 'edges');
  }
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
  const existing = new Set(
    before
      .filter((d) => d.severity === 'warning')
      .map((d) => warningIdentity(d, true)),
  );
  const errors = after.filter((d) => d.severity === 'error');
  const warnings = [
    ...new Map(
      after
        .filter((d) => d.severity === 'warning')
        .map((d) => [warningIdentity(d), d]),
    ).values(),
  ];
  const isUnchanged = (d: DraftDiagnostic) =>
    existing.has(warningIdentity(d, true));
  const unchanged = warnings.filter(isUnchanged);
  const all = [...errors, ...warnings];
  const diagnostics = [
    ...errors,
    ...warnings.filter((d) => !isUnchanged(d)),
    ...unchanged.slice(0, 5),
  ];
  const counts = new Map<
    string,
    { severity: 'error' | 'warning'; code: string; count: number }
  >();
  for (const d of all) {
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
      total: all.length,
      returned: diagnostics.length,
      omitted: all.length - diagnostics.length,
      unchangedWarnings: unchanged.length,
      counts: [...counts.values()],
    },
  };
}
