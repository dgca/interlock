import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Card,
  Group,
  Stack,
  Text,
  Title,
  Select,
  Alert,
  Loader,
  Paper,
  Button,
  SimpleGrid,
  Table,
  Progress,
} from '@mantine/core';
import {
  Clock,
  Coins,
  BarChart2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Layers,
  Cpu,
  UserCheck,
  AlertCircle,
} from 'lucide-react';
import type {
  WorkflowReport,
  ElapsedDistributionMetric,
} from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import layout from '../../components/PageLayout/PageLayout.module.css';
import { TagFields, tagRows, tagsFromRows, type TagRow } from '../runs/RunTags';
import tagStyles from '../runs/RunTags.module.css';

function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

type TimePreset = '24h' | '7d' | '30d' | 'all';

export function WorkflowReportView({
  workflowId: initialWorkflowId,
}: {
  workflowId?: string;
}) {
  const [report, setReport] = useState<WorkflowReport | null>(null);
  const [timeBasis, setTimeBasis] = useState<'wall' | 'activeMs' | 'pausedMs'>(
    'wall',
  );
  const metric = (value?: ElapsedDistributionMetric) =>
    timeBasis === 'wall' ? value : value?.[timeBasis];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    initialWorkflowId ?? null,
  );
  const [timePreset, setTimePreset] = useState<TimePreset>('7d');
  const [tags, setTags] = useState<Record<string, string>>();
  const [filterRows, setFilterRows] = useState<TagRow[]>(tagRows());
  const [filterError, setFilterError] = useState('');
  const requestSequence = useRef(0);
  const [workflowsList, setWorkflowsList] = useState<
    { value: string; label: string }[]
  >([]);

  // Load available workflows for filter dropdown
  useEffect(() => {
    api.workflows.list
      .query()
      .then((items) => {
        setWorkflowsList(
          items.map((w: any) => ({
            value: w.id,
            label: w.name || w.id,
          })),
        );
      })
      .catch(() => {});
  }, []);

  const fetchReport = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    setReport(null);
    setError(null);

    let since: string | undefined;
    const now = new Date();
    if (timePreset === '24h') {
      since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    } else if (timePreset === '7d') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (timePreset === '30d') {
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    try {
      const result = await api.report.summary.query({
        workflowId: selectedWorkflowId || undefined,
        since,
        limit: 1000,
        ...(tags !== undefined ? { tags } : {}),
      });
      if (request === requestSequence.current) setReport(result);
    } catch (err) {
      if (request === requestSequence.current) setError(errorMessage(err));
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [selectedWorkflowId, timePreset, tags]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  const summary = report?.summary;
  const claims = report?.claims;
  const usage = report?.usage;
  const outcomes = report?.terminalOutcomes;

  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <div>
          <Title order={1}>Performance & Cost Report</Title>
          <Text c="dimmed" size="sm">
            Operational latencies, admission waits, model token spend, and
            automation rates
          </Text>
        </div>
        <Group gap="sm">
          <Select
            aria-label="Duration basis"
            value={timeBasis}
            onChange={(value) =>
              setTimeBasis((value as typeof timeBasis) ?? 'wall')
            }
            data={[
              { value: 'wall', label: 'Wall time' },
              { value: 'activeMs', label: 'Active time (excludes pauses)' },
              { value: 'pausedMs', label: 'Paused time' },
            ]}
            size="sm"
            style={{ width: 230 }}
          />
          <Select
            placeholder="All Workflows"
            clearable
            searchable
            value={selectedWorkflowId}
            onChange={(val) => setSelectedWorkflowId(val)}
            data={workflowsList}
            size="sm"
            style={{ width: 220 }}
            aria-label="Filter by workflow"
          />
          <Select
            value={timePreset}
            onChange={(val) => setTimePreset((val as TimePreset) || '7d')}
            data={[
              { value: '24h', label: 'Past 24 Hours' },
              { value: '7d', label: 'Past 7 Days' },
              { value: '30d', label: 'Past 30 Days' },
              { value: 'all', label: 'All Time' },
            ]}
            size="sm"
            style={{ width: 140 }}
            aria-label="Filter by time window"
          />
          <Button
            variant="default"
            size="sm"
            leftSection={
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            }
            onClick={() => void fetchReport()}
            disabled={loading}
          >
            Refresh
          </Button>
        </Group>
      </header>

      <details className={tagStyles.filter}>
        <summary>
          Filter by tags
          {Object.keys(tags ?? {}).length
            ? ` (${Object.keys(tags!).length})`
            : ''}
        </summary>
        <TagFields
          label="Matching tags"
          showLabel={false}
          description="Match every key and value exactly. Up to 16 pairs."
          rows={filterRows}
          onChange={(rows) => {
            setFilterRows(rows);
            setFilterError('');
          }}
          error={filterError}
        />
        <Group mt="sm" gap="xs">
          <Button
            size="xs"
            onClick={() => {
              try {
                setTags(tagsFromRows(filterRows));
                setFilterError('');
              } catch (error) {
                setFilterError(errorMessage(error));
              }
            }}
          >
            Apply filters
          </Button>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => {
              setFilterRows([]);
              setFilterError('');
              setTags(undefined);
            }}
          >
            Clear filters
          </Button>
        </Group>
      </details>

      {error && (
        <Alert
          icon={<AlertCircle size={16} />}
          title="Failed to load report"
          color="red"
        >
          {error}
        </Alert>
      )}

      {loading && !report && (
        <Paper p="xl" withBorder style={{ textAlign: 'center' }}>
          <Stack align="center" gap="sm">
            <Loader size="md" />
            <Text size="sm" c="dimmed">
              Aggregating workflow performance and cost metrics…
            </Text>
          </Stack>
        </Paper>
      )}

      {report && (
        <Stack gap="lg">
          {/* Top Stat Cards */}
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 6 }} spacing="md">
            <Card withBorder padding="md">
              <Group justify="space-between" mb="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Total Runs
                </Text>
                <Layers size={16} />
              </Group>
              <Text fz="xl" fw={700}>
                {summary?.totalRuns ?? 0}
              </Text>
              <Text size="xs" c="dimmed">
                {outcomes?.completedRuns ?? 0} completed ·{' '}
                {outcomes?.failedRuns ?? 0} failed
              </Text>
            </Card>

            <Card withBorder padding="md">
              <Group justify="space-between" mb="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Run Duration
                </Text>
                <Clock size={16} />
              </Group>
              <Text fz="xl" fw={700}>
                {formatMs(metric(summary?.durationMs)?.median)}
              </Text>
              <Text size="xs" c="dimmed">
                p90: {formatMs(metric(summary?.durationMs)?.p90)}
              </Text>
            </Card>

            <Card withBorder padding="md">
              <Group justify="space-between" mb="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Admission Wait (H8)
                </Text>
                <Clock size={16} />
              </Group>
              <Text fz="xl" fw={700}>
                {formatMs(metric(summary?.admissionQueueWaitMs)?.median)}
              </Text>
              <Text size="xs" c="dimmed">
                p90: {formatMs(metric(summary?.admissionQueueWaitMs)?.p90)}
              </Text>
            </Card>

            <Card withBorder padding="md">
              <Group justify="space-between" mb="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Human Wait
                </Text>
                <UserCheck size={16} />
              </Group>
              <Text fz="xl" fw={700}>
                {formatMs(metric(summary?.humanWaitMs)?.median)}
              </Text>
              <Text size="xs" c="dimmed">
                p90: {formatMs(metric(summary?.humanWaitMs)?.p90)}
              </Text>
            </Card>

            <Card withBorder padding="md">
              <Group justify="space-between" mb="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Unattended Rate
                </Text>
                <CheckCircle2 size={16} color="green" />
              </Group>
              <Text fz="xl" fw={700}>
                {outcomes?.unattendedCompletionRate ?? 0}%
              </Text>
              <Text size="xs" c="dimmed">
                escalated: {outcomes?.humanEscalationRate ?? 0}%
              </Text>
            </Card>

            <Card withBorder padding="md">
              <Group justify="space-between" mb="xs">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Attributed Spend
                </Text>
                <Coins size={16} />
              </Group>
              <Text fz="xl" fw={700}>
                {usage?.costs[0]?.formatted ?? '0 USD'}
              </Text>
              <Text size="xs" c="dimmed">
                {usage?.coverage.measuredPercentage ?? 0}% measured
              </Text>
            </Card>
          </SimpleGrid>

          {/* Operational Reliability & Claim Latencies */}
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Card withBorder padding="md">
              <Title order={3} size="h4" mb="sm">
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
                  <Text size="sm">Continuing Session Wait (Median / P90):</Text>
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
            </Card>

            <Card withBorder padding="md">
              <Title order={3} size="h4" mb="sm">
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
                    H7 Model Refusal / Transient Recoveries:
                  </Text>
                  <Badge color="blue" variant="light">
                    {claims?.h7Recoveries ?? 0}
                  </Badge>
                </Group>
                <Group justify="space-between">
                  <Text size="sm">H12 Inactivity Stalls:</Text>
                  <Badge
                    color={claims?.h12Stalls ? 'yellow' : 'gray'}
                    variant="light"
                  >
                    {claims?.h12Stalls ?? 0}
                  </Badge>
                </Group>
              </Stack>
            </Card>
          </SimpleGrid>

          {/* Stages (H4) & Terminal Outcomes */}
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Card withBorder padding="md">
              <Title order={3} size="h4" mb="sm">
                Stage Durations (H4)
              </Title>
              {report.stages.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No stage transitions recorded in this window.
                </Text>
              ) : (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Stage</Table.Th>
                      <Table.Th>Runs</Table.Th>
                      <Table.Th>Median</Table.Th>
                      <Table.Th>P90</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {report.stages.map((st) => (
                      <Table.Tr key={st.stage}>
                        <Table.Td fw={500}>{st.stage}</Table.Td>
                        <Table.Td>{st.runCount}</Table.Td>
                        <Table.Td>
                          {formatMs(metric(st.durationMs)?.median)}
                        </Table.Td>
                        <Table.Td>
                          {formatMs(metric(st.durationMs)?.p90)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Card>

            <Card withBorder padding="md">
              <Title order={3} size="h4" mb="sm">
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
            </Card>
          </SimpleGrid>

          {/* Model Spend and Token Attribution */}
          <Card withBorder padding="md">
            <Group justify="space-between" mb="sm">
              <Title order={3} size="h4">
                Model Usage & Spend Attribution
              </Title>
              <Text size="xs" c="dimmed">
                Coverage: {usage?.coverage.measuredPercentage}% measured ·{' '}
                {usage?.coverage.unknownPercentage}% unknown
              </Text>
            </Group>

            <SimpleGrid cols={{ base: 2, sm: 4 }} mb="md">
              <Paper withBorder p="xs">
                <Text size="xs" c="dimmed">
                  Input Tokens
                </Text>
                <Text fw={600}>
                  {usage?.tokens.inputTokens.toLocaleString()}
                </Text>
              </Paper>
              <Paper withBorder p="xs">
                <Text size="xs" c="dimmed">
                  Output Tokens
                </Text>
                <Text fw={600}>
                  {usage?.tokens.outputTokens.toLocaleString()}
                </Text>
              </Paper>
              <Paper withBorder p="xs">
                <Text size="xs" c="dimmed">
                  Cached Input Tokens
                </Text>
                <Text fw={600}>
                  {usage?.tokens.cachedInputTokens.toLocaleString()}
                </Text>
              </Paper>
              <Paper withBorder p="xs">
                <Text size="xs" c="dimmed">
                  Reasoning Output Tokens
                </Text>
                <Text fw={600}>
                  {usage?.tokens.reasoningOutputTokens.toLocaleString()}
                </Text>
              </Paper>
            </SimpleGrid>

            {usage && usage.byProvider.length > 0 && (
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
                    const costFormatted = p.costMicros
                      ? `${(p.costMicros / 1_000_000).toFixed(4)} ${p.currency ?? ''}`
                      : '—';
                    return (
                      <Table.Tr key={p.provider}>
                        <Table.Td fw={500}>{p.provider}</Table.Td>
                        <Table.Td>{p.count}</Table.Td>
                        <Table.Td>{p.inputTokens.toLocaleString()}</Table.Td>
                        <Table.Td>{p.outputTokens.toLocaleString()}</Table.Td>
                        <Table.Td>{costFormatted}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            )}
          </Card>

          {/* Node Durations */}
          {report.nodes.length > 0 && (
            <Card withBorder padding="md">
              <Title order={3} size="h4" mb="sm">
                Node Durations (Median & P90)
              </Title>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Node</Table.Th>
                    <Table.Th>Kind</Table.Th>
                    <Table.Th>Stage</Table.Th>
                    <Table.Th>Executions</Table.Th>
                    <Table.Th>Median</Table.Th>
                    <Table.Th>P90</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {report.nodes.slice(0, 15).map((n) => (
                    <Table.Tr key={n.nodeId}>
                      <Table.Td fw={500}>{n.label || n.nodeId}</Table.Td>
                      <Table.Td>{n.kind}</Table.Td>
                      <Table.Td>{n.stage ?? '—'}</Table.Td>
                      <Table.Td>{n.executionCount}</Table.Td>
                      <Table.Td>
                        {formatMs(metric(n.durationMs)?.median)}
                      </Table.Td>
                      <Table.Td>{formatMs(metric(n.durationMs)?.p90)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          )}
        </Stack>
      )}
    </div>
  );
}

export default WorkflowReportView;
