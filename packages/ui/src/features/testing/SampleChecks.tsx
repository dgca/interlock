import { Text } from '../../design-system';
import { CircleHelp, CircleX } from 'lucide-react';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/query';
import type { ComparisonReport } from './comparisonText';
import { describeCheck } from './suiteDraft';
import styles from './Testing.module.css';

type Observation = NonNullable<
  ComparisonReport['samples'][number]['observation']
>;
type Check = Observation['checks'][number];
const pageSize = 10;

/**
 * Every check of one sample that did not pass. Reports page checks for all
 * samples together, so read this sample alone, one check page at a time.
 */
export async function notPassedChecks(
  id: string,
  sampleOffset: number,
  checkTotal: number,
) {
  const found: Check[] = [];
  for (let checkOffset = 0; checkOffset < checkTotal; checkOffset += pageSize) {
    const page = await api.testbench.report.query({
      id,
      offset: sampleOffset,
      limit: 1,
      checkOffset,
      checkLimit: pageSize,
      caseLimit: 1,
      judgmentLimit: 1,
    });
    const checks = page.samples[0]?.observation?.checks ?? [];
    if (!checks.length) break;
    found.push(...checks.filter((check) => check.status !== 'pass'));
  }
  return found;
}

/** Failed and unknown checks of one sample, reading past the report's first check page when needed. */
export function SampleChecks({
  comparisonId,
  sampleOffset,
  observation,
  label,
}: {
  comparisonId: string;
  sampleOffset: number;
  observation: Observation;
  label: string;
}) {
  const shown = observation.checks.filter((c) => c.status !== 'pass');
  const hidden =
    observation.checkCounts.fail + observation.checkCounts.unknown >
    shown.length;
  const all = useQuery({
    queryKey: [
      'comparisonSampleChecks',
      comparisonId,
      sampleOffset,
      observation.checkTotal,
    ],
    queryFn: () =>
      notPassedChecks(comparisonId, sampleOffset, observation.checkTotal),
    enabled: hidden,
    meta: { engineRefresh: false },
  });
  const checks = hidden && all.data ? all.data : shown;
  return (
    <>
      {!!checks.length && (
        <ul className={styles.checkResults} aria-label={label}>
          {checks.map((c) => (
            <li key={c.index} data-status={c.status}>
              {c.status === 'fail' ? (
                <CircleX size={16} aria-hidden="true" />
              ) : (
                <CircleHelp size={16} aria-hidden="true" />
              )}
              <span>
                <span className={styles.checkText}>
                  {c.status === 'fail' ? 'Failed: ' : 'Unknown: '}
                  {describeCheck(c.assertion, c.expectedOmitted)}
                </span>
                <small>{c.reason}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      {hidden && !all.data && (
        <Text size="sm" c="dimmed" role="status">
          {all.error
            ? 'Could not load the remaining checks.'
            : 'Loading the remaining checks…'}
        </Text>
      )}
    </>
  );
}
