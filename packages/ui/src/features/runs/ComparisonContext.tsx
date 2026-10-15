import type { ComparisonRunContext } from '@interlock/core';

export function ComparisonContext({
  comparison,
}: {
  comparison?: ComparisonRunContext;
}) {
  if (!comparison) return null;
  return (
    <small className="comparison-context">
      {comparison.suiteName} · {comparison.caseName} ·{' '}
      {comparison.side === 'baseline' ? 'Baseline' : 'Candidate'} · Repeat{' '}
      {comparison.repetition}
    </small>
  );
}
