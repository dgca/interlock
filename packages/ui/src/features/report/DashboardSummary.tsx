import type { ReactNode } from 'react';
import {
  CheckCircle2,
  Clock,
  Coins,
  Layers,
  Percent,
  UserCheck,
} from 'lucide-react';
import {
  Alert,
  Group,
  SimpleGrid,
  Table,
  Text,
  Title,
  TrendBars,
  workspacePage,
} from '../../design-system';
import type { api } from '../../lib/api';
import {
  basisMetric,
  bucketLabel,
  bucketRange,
  describeChange,
  formatMs,
  successRate,
  type Change,
  type TimeBasis,
} from './reportFormat';
import styles from './Dashboard.module.css';

export type Dashboard = Awaited<ReturnType<typeof api.report.dashboard.query>>;

function MetricCard({
  label,
  icon,
  value,
  detail,
  change,
  comparedWith,
  trend,
  ariaLabel,
}: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  change?: Change | null;
  comparedWith?: string;
  trend?: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <section className={workspacePage.card} aria-label={ariaLabel}>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Text size="sm" c="dimmed">
          {label}
        </Text>
        {icon}
      </Group>
      <Text fz="xl" fw={700} className={styles.metricValue}>
        {value}
      </Text>
      {change && (
        <Text
          size="xs"
          className={styles.change}
          title={`${change.description} (${comparedWith})`}
        >
          {change.text}
          <Text span size="xs" c="dimmed">
            {' '}
            vs {comparedWith}
          </Text>
        </Text>
      )}
      {detail && (
        <Text size="xs" c="dimmed">
          {detail}
        </Text>
      )}
      {trend && <div className={styles.trend}>{trend}</div>}
    </section>
  );
}

const percent = (value: number) => `${value.toFixed(1)}%`;
/** Spend changes are shown only when both periods' usage coverage is within this many points. */
const comparableCoveragePoints = 10;

/** Headline numbers for the period, each compared with the previous period. */
export function DashboardSummary({
  dashboard,
  basis,
  comparedWith,
}: {
  dashboard: Dashboard;
  basis: TimeBasis;
  comparedWith?: string;
}) {
  const { report, previous, trend, counts, limited } = dashboard;
  const usage = report.usage;
  const compare = previous && comparedWith;
  const change = (
    current: number | null | undefined,
    before: number | null | undefined,
    format: (value: number) => string,
    unit?: 'points',
  ) => (compare ? describeChange(current, before, format, unit) : undefined);
  // A limited window's report covers only its newest runs: keep exact counts, hide sampled changes.
  const sampledChange: typeof change = (...args) =>
    limited ? undefined : change(...args);
  const median = basisMetric(report.summary.durationMs, basis)?.median;
  const rate = successRate({
    completedRuns: counts.current.completed,
    failedRuns: counts.current.failed,
  });
  const previousCoverage = previous?.usage.coverage.measuredPercentage;
  const coverageComparable =
    previousCoverage !== undefined &&
    Math.abs(usage.coverage.measuredPercentage - previousCoverage) <=
      comparableCoveragePoints;
  const singleCost = usage.costs.length === 1 ? usage.costs[0] : undefined;
  const previousCost =
    singleCost &&
    previous?.usage.costs.find((cost) => cost.currency === singleCost.currency);
  const spanMs = trend.length
    ? Date.parse(trend.at(-1)!.end) - Date.parse(trend[0].start)
    : 0;
  const bars = (
    value: (bucket: Dashboard['trend'][number]) => number | null,
    format: (value: number | null) => string,
    label: string,
  ) =>
    !limited && trend.length > 1 && trend.some((bucket) => value(bucket)) ? (
      <TrendBars
        label={label}
        values={trend.map((bucket) => ({
          label: bucketLabel(bucket.start, bucket.end, spanMs),
          value: value(bucket),
          display: format(value(bucket)),
        }))}
      />
    ) : undefined;
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
      <MetricCard
        label="Runs"
        icon={<Layers size={16} aria-hidden />}
        value={counts.current.runs}
        change={change(counts.current.runs, counts.previous?.runs, String)}
        comparedWith={comparedWith}
        detail={`${counts.current.completed} completed · ${counts.current.failed} failed · ${counts.current.cancelled} cancelled`}
        trend={bars(
          (bucket) => bucket.runs,
          (value) => `${value ?? 0} runs`,
          'Runs started per interval. Values are listed in Runs over time.',
        )}
      />
      <MetricCard
        label="Success rate"
        icon={<Percent size={16} aria-hidden />}
        value={rate === null ? '—' : percent(rate)}
        change={change(
          rate,
          counts.previous
            ? successRate({
                completedRuns: counts.previous.completed,
                failedRuns: counts.previous.failed,
              })
            : null,
          percent,
          'points',
        )}
        comparedWith={comparedWith}
        detail="Completed of completed and failed runs"
      />
      <MetricCard
        label="Median run duration"
        icon={<Clock size={16} aria-hidden />}
        value={formatMs(median)}
        change={sampledChange(
          median,
          basisMetric(previous?.summary.durationMs, basis)?.median,
          formatMs,
        )}
        comparedWith={comparedWith}
        detail={`p90 ${formatMs(basisMetric(report.summary.durationMs, basis)?.p90)}`}
        trend={bars(
          (bucket) => basisMetric(bucket.durationMs, basis)?.median ?? null,
          formatMs,
          'Median run duration per interval. Values are listed in Runs over time.',
        )}
      />
      <MetricCard
        label="Attributed spend"
        ariaLabel="Attributed spend"
        icon={<Coins size={16} aria-hidden />}
        value={
          !usage.coverage.measuredPercentage || !usage.costs.length
            ? 'Unmeasured'
            : usage.costs.map((cost) => cost.formatted).join(' · ')
        }
        change={
          singleCost && usage.coverage.measuredPercentage && coverageComparable
            ? sampledChange(
                singleCost.amountMicros,
                previousCost ? previousCost.amountMicros : null,
                (micros) =>
                  `${(micros / 1_000_000).toFixed(4)} ${singleCost.currency}`,
              )
            : undefined
        }
        comparedWith={comparedWith}
        detail={
          compare && !coverageComparable
            ? `${usage.coverage.measuredPercentage}% of attempts measured · ${previousCoverage}% in the ${comparedWith}`
            : `${usage.coverage.measuredPercentage}% of attempts measured`
        }
      />
      <MetricCard
        label="Admission wait"
        icon={<Clock size={16} aria-hidden />}
        value={formatMs(
          basisMetric(report.summary.admissionQueueWaitMs, basis)?.median,
        )}
        detail={`p90 ${formatMs(basisMetric(report.summary.admissionQueueWaitMs, basis)?.p90)}`}
      />
      <MetricCard
        label="Human wait"
        icon={<UserCheck size={16} aria-hidden />}
        value={formatMs(basisMetric(report.summary.humanWaitMs, basis)?.median)}
        detail={`p90 ${formatMs(basisMetric(report.summary.humanWaitMs, basis)?.p90)}`}
      />
      <MetricCard
        label="Unattended rate"
        icon={<CheckCircle2 size={16} aria-hidden />}
        value={`${report.terminalOutcomes.unattendedCompletionRate}%`}
        detail={`escalated: ${report.terminalOutcomes.humanEscalationRate}%`}
      />
    </SimpleGrid>
  );
}

/** Explains that a window has more runs than the report reads. */
export function DashboardLimitNotice({
  dashboard,
  limit,
}: {
  dashboard: Dashboard;
  limit: number;
}) {
  if (!dashboard.limited) return null;
  const { counts } = dashboard;
  const read = (runs: number) => Math.min(runs, limit).toLocaleString();
  return (
    <Alert
      color="yellow"
      title="This period has more runs than the report reads"
    >
      {counts.current.runs.toLocaleString()} runs this period (
      {read(counts.current.runs)} read)
      {counts.previous
        ? `, ${counts.previous.runs.toLocaleString()} in the previous period (${read(counts.previous.runs)} read)`
        : ''}
      . Run counts and success rate are exact; durations, spend and outcomes
      cover the newest {limit.toLocaleString()} runs of each period, so their
      changes and trends are hidden. Choose a shorter period for complete
      figures.
    </Alert>
  );
}

/** The table equivalent of the summary trend bars. */
export function DashboardTrendTable({
  dashboard,
  basis,
}: {
  dashboard: Dashboard;
  basis: TimeBasis;
}) {
  const { trend } = dashboard;
  if (trend.length < 2 || dashboard.limited) return null;
  const spanMs = Date.parse(trend.at(-1)!.end) - Date.parse(trend[0].start);
  return (
    <section className={workspacePage.card} aria-labelledby="trend-title">
      <Title order={2} size="h4" mb="sm" id="trend-title">
        Runs over time
      </Title>
      <Table.ScrollContainer minWidth={520}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Interval</Table.Th>
              <Table.Th className={styles.numeric}>Runs</Table.Th>
              <Table.Th className={styles.numeric}>Completed</Table.Th>
              <Table.Th className={styles.numeric}>Failed</Table.Th>
              <Table.Th className={styles.numeric}>Median duration</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {trend.map((bucket) => (
              <Table.Tr key={bucket.start}>
                <Table.Th
                  scope="row"
                  fw={500}
                  title={bucketRange(bucket.start, bucket.end)}
                >
                  {bucketLabel(bucket.start, bucket.end, spanMs)}
                </Table.Th>
                <Table.Td className={styles.numeric}>{bucket.runs}</Table.Td>
                <Table.Td className={styles.numeric}>
                  {bucket.completed}
                </Table.Td>
                <Table.Td className={styles.numeric}>{bucket.failed}</Table.Td>
                <Table.Td className={styles.numeric}>
                  {formatMs(basisMetric(bucket.durationMs, basis)?.median)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </section>
  );
}
