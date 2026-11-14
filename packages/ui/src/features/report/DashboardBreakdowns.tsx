import type { ReactNode } from 'react';
import {
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  workspacePage,
} from '../../design-system';
import {
  basisMetric,
  describeChange,
  formatCost,
  formatMs,
  type TimeBasis,
} from './reportFormat';
import type { Dashboard } from './DashboardSummary';
import styles from './Dashboard.module.css';

type Metric = Dashboard['report']['nodes'][number]['durationMs'];

function ChangeCell({
  current,
  previous,
  compared,
}: {
  current: number | null | undefined;
  previous: number | null | undefined;
  compared: boolean;
}) {
  const change = compared ? describeChange(current, previous, formatMs) : null;
  return (
    <Table.Td className={styles.numeric} title={change?.description}>
      {change?.text ?? '—'}
    </Table.Td>
  );
}

function DurationTable({
  title,
  empty,
  rows,
  basis,
  compared,
  extra,
}: {
  title: string;
  empty: string;
  rows: {
    key: string;
    name: string;
    detail?: string;
    count: number;
    current: Metric;
    previous?: Metric;
  }[];
  basis: TimeBasis;
  compared: boolean;
  extra?: ReactNode;
}) {
  return (
    <section className={workspacePage.card}>
      <Title order={2} size="h4" mb="sm">
        {title}
      </Title>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          {empty}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={560}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th className={styles.numeric}>Count</Table.Th>
                <Table.Th className={styles.numeric}>Median</Table.Th>
                <Table.Th className={styles.numeric}>P90</Table.Th>
                <Table.Th className={styles.numeric}>Change</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.key}>
                  <Table.Th scope="row" className={styles.name} fw={500}>
                    {row.name}
                    {row.detail && (
                      <Text size="xs" c="dimmed" fw={400}>
                        {row.detail}
                      </Text>
                    )}
                  </Table.Th>
                  <Table.Td className={styles.numeric}>{row.count}</Table.Td>
                  <Table.Td className={styles.numeric}>
                    {formatMs(basisMetric(row.current, basis)?.median)}
                  </Table.Td>
                  <Table.Td className={styles.numeric}>
                    {formatMs(basisMetric(row.current, basis)?.p90)}
                  </Table.Td>
                  <ChangeCell
                    current={basisMetric(row.current, basis)?.median}
                    previous={basisMetric(row.previous, basis)?.median}
                    compared={compared}
                  />
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {extra}
    </section>
  );
}

const shownNodes = 15;

/** Stage and node duration percentiles, with the median change from the previous period. */
export function DashboardDurations({
  dashboard,
  basis,
}: {
  dashboard: Dashboard;
  basis: TimeBasis;
}) {
  const { report, previous } = dashboard;
  const compared = previous !== null;
  const previousStages = new Map(
    previous?.stages.map((stage) => [stage.stage, stage.durationMs]),
  );
  const previousNodes = new Map(
    previous?.nodes.map((node) => [node.nodeId, node.durationMs]),
  );
  return (
    <Stack gap="md">
      <DurationTable
        title="Stage durations"
        empty="No stage transitions recorded in this period."
        basis={basis}
        compared={compared}
        rows={report.stages.map((stage) => ({
          key: stage.stage,
          name: stage.stage,
          count: stage.runCount,
          current: stage.durationMs,
          previous: previousStages.get(stage.stage),
        }))}
      />
      <DurationTable
        title="Node durations"
        empty="No completed node executions in this period."
        basis={basis}
        compared={compared}
        rows={report.nodes.slice(0, shownNodes).map((node) => ({
          key: node.nodeId,
          name: node.label || node.nodeId,
          detail: [node.kind, node.stage].filter(Boolean).join(' · '),
          count: node.executionCount,
          current: node.durationMs,
          previous: previousNodes.get(node.nodeId),
        }))}
        extra={
          report.nodes.length > shownNodes && (
            <Text size="xs" c="dimmed" mt="xs">
              Showing the {shownNodes} most executed of {report.nodes.length}{' '}
              nodes.
            </Text>
          )
        }
      />
    </Stack>
  );
}

type SpendRow = {
  key: string;
  name: string;
  detail?: string;
  costMicros: number | null;
  currency?: string;
  coverage: string;
};

function SpendTable({
  title,
  coverageLabel,
  rows,
}: {
  title: string;
  coverageLabel: string;
  rows: SpendRow[];
}) {
  const currencies = new Set(rows.map((row) => row.currency).filter(Boolean));
  const single = currencies.size === 1 && !currencies.has('mixed');
  const total = rows.reduce((sum, row) => sum + (row.costMicros ?? 0), 0);
  const sorted = [...rows].sort(
    (a, b) => (b.costMicros ?? -1) - (a.costMicros ?? -1),
  );
  return (
    <section className={workspacePage.card}>
      <Title order={3} size="h5" mb="sm">
        {title}
      </Title>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          No usage reported in this period.
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={420}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th className={styles.numeric}>Cost</Table.Th>
                <Table.Th>Share</Table.Th>
                <Table.Th className={styles.numeric}>{coverageLabel}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sorted.map((row) => {
                const share =
                  single && total > 0 && row.costMicros !== null
                    ? Math.round((row.costMicros / total) * 100)
                    : null;
                return (
                  <Table.Tr key={row.key}>
                    <Table.Th scope="row" className={styles.name} fw={500}>
                      {row.name}
                      {row.detail && (
                        <Text size="xs" c="dimmed" fw={400}>
                          {row.detail}
                        </Text>
                      )}
                    </Table.Th>
                    <Table.Td className={styles.numeric}>
                      {formatCost(row.costMicros, row.currency)}
                    </Table.Td>
                    <Table.Td className={styles.share}>
                      {share === null ? (
                        '—'
                      ) : (
                        <>
                          <Text size="xs" className={styles.change}>
                            {share}%
                          </Text>
                          <Progress
                            value={share}
                            size="sm"
                            aria-label={`${row.name}: ${share}% of spend`}
                          />
                        </>
                      )}
                    </Table.Td>
                    <Table.Td className={styles.numeric}>
                      {row.coverage}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </section>
  );
}

const percentOf = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 1000) / 10}%` : '—';

/** Reported spend by node, model and stage, with how much usage reports cover. */
export function DashboardSpend({ dashboard }: { dashboard: Dashboard }) {
  const { usage, nodes } = dashboard.report;
  const stages = new Map(nodes.map((node) => [node.nodeId, node.stage]));
  const coverage = usage.coverage;
  return (
    <section aria-labelledby="spend-title">
      <Title order={2} size="h4" id="spend-title">
        Reported spend
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        Usage reported for {coverage.measuredAttempts} of{' '}
        {coverage.totalAttempts} attempts (
        {percentOf(coverage.measuredAttempts, coverage.totalAttempts)}). Spend
        covers reported usage only.
      </Text>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <SpendTable
          title="By node"
          coverageLabel="Reported"
          rows={usage.byNode.map((node) => ({
            key: node.nodeId,
            name: node.label || node.nodeId,
            detail: stages.get(node.nodeId) ?? undefined,
            costMicros: node.costMicros,
            currency: node.currency,
            coverage: `${node.measuredPercentage}%`,
          }))}
        />
        <SpendTable
          title="By model"
          coverageLabel="Reports"
          rows={usage.byModel.map((model) => ({
            key: `${model.provider}:${model.model}`,
            name: model.model,
            detail: model.provider,
            costMicros: model.costMicros,
            currency: model.currency,
            coverage: String(model.count),
          }))}
        />
        <SpendTable
          title="By stage"
          coverageLabel="Reported"
          rows={dashboard.spendByStage.map((stage) => ({
            key: stage.stage ?? '',
            name: stage.stage ?? 'No stage',
            costMicros: stage.costMicros,
            currency: stage.currency,
            coverage: percentOf(stage.measuredAttempts, stage.attempts),
          }))}
        />
      </SimpleGrid>
    </section>
  );
}
