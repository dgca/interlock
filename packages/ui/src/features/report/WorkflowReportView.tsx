import {
  Badge,
  Group,
  Stack,
  Text,
  Title,
  Select,
  Alert,
  Button,
  EmptyState,
  SimpleGrid,
  Table,
  Progress,
  PageHeader,
  PageToolbar,
  workspacePage,
} from '../../design-system';

import { useId, useState } from 'react';

import { RefreshCw, AlertCircle } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';

import { ReportLoadingContent } from './ReportSkeleton';
import { ReportApprovals } from './ReportApprovals';
import styles from './WorkflowReportView.module.css';
import { RunTagFilter, AppliedRunTagFilters } from '../runs/RunTagFilter';
import { PricingNote } from '../runs/PricingNote';
import { DashboardSummary, DashboardTrendTable } from './DashboardSummary';
import { DashboardDurations, DashboardSpend } from './DashboardBreakdowns';
import { DashboardRuns } from './DashboardRuns';
import {
  basisMetric,
  formatMs,
  periodLabels,
  type TimeBasis,
} from './reportFormat';

type TimePreset = '24h' | '7d' | '30d' | 'all';

/**
 * The library Report page, or a workflow's Report tab when `workflowId` is set.
 * Both show the dashboard and the detailed report from one bounded read.
 */
export function WorkflowReportView({ workflowId }: { workflowId?: string }) {
  const [timeBasis, setTimeBasis] = useState<TimeBasis>('wall');
  const metric = (value?: Parameters<typeof basisMetric>[0]) =>
    basisMetric(value, timeBasis);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    workflowId ?? null,
  );
  const [timePreset, setTimePreset] = useState<TimePreset>('7d');
  const [tags, setTags] = useState<Record<string, string>>();
  const tagFilterId = useId();
  const workflowsQuery = useQuery(
    trpc.workflows.catalog.queryOptions(undefined, { enabled: !workflowId }),
  );
  const workflowsList = (workflowsQuery.data ?? []).map((workflow) => ({
    value: workflow.id,
    label: workflow.name || workflow.id,
  }));
  const input = {
    workflowId: selectedWorkflowId || undefined,
    limit: 1000,
    ...(tags !== undefined ? { tags } : {}),
  };
  const reportQuery = useQuery({
    ...trpc.report.dashboard.queryOptions(input),
    // Relative windows identify a view; calculate the actual boundary on each
    // fetch so remounts reuse cached data without freezing the report window.
    queryKey: [
      trpc.report.dashboard.queryKey(input)[0],
      { input: { ...input, timePreset }, type: 'query' },
    ],
    queryFn: () => {
      const duration = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
      const now = Date.now();
      const window =
        timePreset === 'all'
          ? {}
          : {
              since: new Date(now - duration[timePreset]).toISOString(),
              until: new Date(now).toISOString(),
            };
      return api.report.dashboard.query({ ...input, ...window });
    },
  });
  const dashboard = reportQuery.data;
  const report = dashboard?.report;
  const loading = reportQuery.isFetching;
  const error = reportQuery.error ? errorMessage(reportQuery.error) : null;
  const fetchReport = () => reportQuery.refetch({ cancelRefetch: false });

  const claims = report?.claims;
  const usage = report?.usage;
  const noRuns =
    report?.summary.totalRuns === 0 && !dashboard?.previous?.summary.totalRuns;

  const controls = (
    <>
      {!workflowId && (
        <Select
          placeholder="All workflows"
          clearable
          searchable
          value={selectedWorkflowId}
          onChange={setSelectedWorkflowId}
          data={workflowsList}
          className={styles.workflowFilter}
          aria-label="Filter by workflow"
        />
      )}
      <Select
        aria-label="Duration basis"
        value={timeBasis}
        onChange={(value) => setTimeBasis((value as TimeBasis) ?? 'wall')}
        data={[
          { value: 'wall', label: 'Wall time' },
          { value: 'activeMs', label: 'Active time (excludes pauses)' },
          { value: 'pausedMs', label: 'Paused time' },
        ]}
        className={styles.durationFilter}
      />
      <Select
        value={timePreset}
        onChange={(value) => setTimePreset((value as TimePreset) || '7d')}
        data={[
          { value: '24h', label: 'Past 24 hours' },
          { value: '7d', label: 'Past 7 days' },
          { value: '30d', label: 'Past 30 days' },
          { value: 'all', label: 'All time' },
        ]}
        className={styles.timeFilter}
        aria-label="Filter by time window"
      />
      <RunTagFilter
        filterId={tagFilterId}
        key={selectedWorkflowId ?? 'all'}
        value={tags}
        onChange={setTags}
      />
    </>
  );
  const refresh = (
    <Button
      variant="secondary"
      leftSection={<RefreshCw size={14} />}
      onClick={() => void fetchReport()}
      disabled={loading}
    >
      Refresh
    </Button>
  );

  return (
    <section className={workspacePage.page} aria-busy={loading}>
      {workflowId ? (
        <PageToolbar>
          {controls}
          {refresh}
        </PageToolbar>
      ) : (
        <PageHeader
          title="Performance & cost report"
          controls={controls}
          actions={refresh}
        />
      )}
      <AppliedRunTagFilters
        filterId={tagFilterId}
        value={tags}
        onChange={setTags}
      />
      <div className={workspacePage.content}>
        <Stack gap="lg">
          {error && (
            <Alert
              icon={<AlertCircle size={16} />}
              title="Failed to load report"
              color="red"
            >
              {error}
            </Alert>
          )}

          {loading && !report && <ReportLoadingContent />}

          {dashboard && report && (
            <Stack gap="lg">
              {noRuns ? (
                <EmptyState
                  title="No runs in this period"
                  description="Durations, outcomes and spend appear after runs start in the selected period."
                />
              ) : (
                <DashboardSummary
                  dashboard={dashboard}
                  basis={timeBasis}
                  comparedWith={
                    timePreset === 'all' ? undefined : periodLabels[timePreset]
                  }
                />
              )}
              {dashboard.limited && (
                <Text size="sm" c="dimmed">
                  Each period includes its newest {input.limit} runs.
                </Text>
              )}
              <DashboardRuns
                workflowId={selectedWorkflowId ?? undefined}
                tags={tags}
              />
            </Stack>
          )}
          {dashboard && report && !noRuns && (
            <Stack gap="lg">
              <DashboardTrendTable dashboard={dashboard} basis={timeBasis} />
              <DashboardDurations dashboard={dashboard} basis={timeBasis} />
              <DashboardSpend dashboard={dashboard} />

              {/* Operational Reliability & Claim Latencies */}
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                <section className={workspacePage.card}>
                  <Title order={2} size="h4" mb="sm">
                    Claim Latency (Available → Claimed)
                  </Title>
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text size="sm">New Session Wait (Median / P90):</Text>
                      <Text size="sm" fw={600}>
                        {formatMs(metric(claims?.newSession)?.median)} /{' '}
                        {formatMs(metric(claims?.newSession)?.p90)}
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm">
                        Continuing Session Wait (Median / P90):
                      </Text>
                      <Text size="sm" fw={600}>
                        {formatMs(metric(claims?.continuingSession)?.median)} /{' '}
                        {formatMs(metric(claims?.continuingSession)?.p90)}
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm">Total Claim Attempts:</Text>
                      <Text size="sm" fw={600}>
                        {claims?.totalAttempts ?? 0}
                      </Text>
                    </Group>
                  </Stack>
                </section>

                <section className={workspacePage.card}>
                  <Title order={2} size="h4" mb="sm">
                    Execution Reliability & Recoveries
                  </Title>
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text size="sm">Lease Expiries:</Text>
                      <Badge
                        color={claims?.leaseExpiries ? 'red' : 'gray'}
                        variant="light"
                      >
                        {claims?.leaseExpiries ?? 0}
                      </Badge>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm">Node / Work Failures:</Text>
                      <Badge
                        color={claims?.failures ? 'orange' : 'gray'}
                        variant="light"
                      >
                        {claims?.failures ?? 0}
                      </Badge>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm">
                        Model Refusal / Transient Recoveries:
                      </Text>
                      <Badge color="blue" variant="light">
                        {claims?.transientRecoveries ?? 0}
                      </Badge>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm">Inactivity Stalls:</Text>
                      <Badge
                        color={claims?.stalls ? 'yellow' : 'gray'}
                        variant="light"
                      >
                        {claims?.stalls ?? 0}
                      </Badge>
                    </Group>
                  </Stack>
                </section>
              </SimpleGrid>

              {/* Terminal Outcomes */}
              <section className={workspacePage.card}>
                <Title order={2} size="h4" mb="sm">
                  Terminal Outcomes by Exit Node
                </Title>
                {report.terminalOutcomes.exitNodes.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No completed runs recorded in this window.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {report.terminalOutcomes.exitNodes.map((exit) => (
                      <div key={exit.nodeId}>
                        <Group justify="space-between" mb={4}>
                          <Text size="sm" fw={500}>
                            {exit.label} ({exit.nodeId})
                          </Text>
                          <Text size="xs" c="dimmed">
                            {exit.count} runs ({exit.percentage}%)
                          </Text>
                        </Group>
                        <Progress
                          value={exit.percentage}
                          color={
                            exit.label.toLowerCase().includes('escalat') ||
                            exit.label.toLowerCase().includes('human')
                              ? 'orange'
                              : 'teal'
                          }
                          size="sm"
                        />
                      </div>
                    ))}
                  </Stack>
                )}
              </section>

              {/* Model Spend and Token Attribution */}
              <section className={workspacePage.card}>
                <Group justify="space-between" mb="sm">
                  <Title order={2} size="h4">
                    Model Usage & Spend Attribution
                  </Title>
                  <Text size="xs" c="dimmed">
                    Coverage: {usage?.coverage.measuredPercentage}% measured ·{' '}
                    {usage?.coverage.unknownPercentage}% unknown
                  </Text>
                </Group>

                <SimpleGrid
                  cols={{ base: 2, sm: 4 }}
                  mb="md"
                  className={styles.tokens}
                >
                  <div>
                    <Text size="xs" c="dimmed">
                      Input Tokens
                    </Text>
                    <Text fw={600}>
                      {usage?.tokens.inputTokens.toLocaleString()}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Output Tokens
                    </Text>
                    <Text fw={600}>
                      {usage?.tokens.outputTokens.toLocaleString()}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Cached Input Tokens
                    </Text>
                    <Text fw={600}>
                      {usage?.tokens.cachedInputTokens.toLocaleString()}
                    </Text>
                  </div>
                  <div>
                    <Text size="xs" c="dimmed">
                      Reasoning Output Tokens
                    </Text>
                    <Text fw={600}>
                      {usage?.tokens.reasoningOutputTokens.toLocaleString()}
                    </Text>
                  </div>
                </SimpleGrid>
                {usage?.pricing && (
                  <Stack mb="md">
                    <PricingNote pricing={usage.pricing} />
                  </Stack>
                )}

                {usage && usage.byProvider.length > 0 && (
                  <Table.ScrollContainer minWidth={520}>
                    <Table striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Provider</Table.Th>
                          <Table.Th>Calls</Table.Th>
                          <Table.Th>Input Tokens</Table.Th>
                          <Table.Th>Output Tokens</Table.Th>
                          <Table.Th>Attributed Cost</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {usage.byProvider.map((p) => {
                          const costFormatted =
                            p.currency === 'mixed'
                              ? 'Mixed currencies'
                              : p.costMicros
                                ? `${(p.costMicros / 1_000_000).toFixed(4)} ${p.currency ?? ''}`
                                : '—';
                          return (
                            <Table.Tr key={p.provider}>
                              <Table.Td fw={500}>{p.provider}</Table.Td>
                              <Table.Td>{p.count}</Table.Td>
                              <Table.Td>
                                {p.inputTokens.toLocaleString()}
                              </Table.Td>
                              <Table.Td>
                                {p.outputTokens.toLocaleString()}
                              </Table.Td>
                              <Table.Td>{costFormatted}</Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                )}
                {usage?.byAlias && usage.byAlias.length > 0 && (
                  <>
                    <Title order={3} size="h5" mt="lg" mb="sm">
                      Captured model aliases
                    </Title>
                    <Text size="xs" c="dimmed" mb="sm">
                      Alias revisions describe assignment requests. Reported
                      models describe supplied usage. Unknown includes legacy
                      and native assignments; run overhead has no assigned
                      alias.
                    </Text>
                    <Table.ScrollContainer minWidth={900}>
                      <Table striped highlightOnHover>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Alias / revision</Table.Th>
                            <Table.Th>Requested candidate</Table.Th>
                            <Table.Th>Reported provider / model</Table.Th>
                            <Table.Th>Scope</Table.Th>
                            <Table.Th>Input tokens</Table.Th>
                            <Table.Th>Output tokens</Table.Th>
                            <Table.Th>Cost</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {usage.byAlias.map((group) => (
                            <Table.Tr
                              key={JSON.stringify([
                                group.alias,
                                group.scope,
                                group.provider,
                                group.model,
                                group.currency,
                              ])}
                            >
                              <Table.Td>
                                {group.alias
                                  ? `${group.alias.name} @${group.alias.revision}`
                                  : 'Unknown'}
                              </Table.Td>
                              <Table.Td>
                                {group.alias
                                  ? `${group.alias.candidateModel} (#${group.alias.candidateIndex + 1})`
                                  : '—'}
                                {group.alias &&
                                  (group.alias.candidateProfileId ||
                                    group.alias.candidateEffort !==
                                      undefined) && (
                                    <Text size="xs" c="dimmed">
                                      {group.alias.candidateProfileId ??
                                        'Inherited profile'}{' '}
                                      ·{' '}
                                      {group.alias.candidateEffort === null
                                        ? 'Native effort'
                                        : (group.alias.candidateEffort ??
                                          'Inherited effort')}
                                    </Text>
                                  )}
                              </Table.Td>
                              <Table.Td>
                                {group.provider} / {group.model}
                              </Table.Td>
                              <Table.Td>
                                {group.scope === 'run'
                                  ? 'Run overhead'
                                  : 'Attempt'}
                              </Table.Td>
                              <Table.Td>
                                {group.inputTokens.toLocaleString()}
                              </Table.Td>
                              <Table.Td>
                                {group.outputTokens.toLocaleString()}
                              </Table.Td>
                              <Table.Td>
                                {group.costMicros !== null
                                  ? `${(group.costMicros / 1_000_000).toFixed(4)} ${group.currency ?? ''}`
                                  : '—'}
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </Table.ScrollContainer>
                  </>
                )}
              </section>

              {report.approvals && report.approvals.byRun.length > 0 && (
                <ReportApprovals approvals={report.approvals} />
              )}
            </Stack>
          )}
        </Stack>
      </div>
    </section>
  );
}

export default WorkflowReportView;
