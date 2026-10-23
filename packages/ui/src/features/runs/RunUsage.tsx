import { useEffect, useState } from 'react';
import { Checkbox, Group, NativeSelect, Stack, Text } from '@mantine/core';
import type { UsageMetric } from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import { Button } from '../../components/Button/Button';
import styles from './RunUsage.module.css';

type Report = Awaited<ReturnType<typeof api.runs.usage.query>>;
export function usageMetricText(metric: UsageMetric, scale = 1) {
  if (metric.overflow) return 'Too large to total';
  if (metric.value === null) return 'Unknown';
  const value = (metric.value / scale).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
  return metric.coverage === 'partial' ? `${value} · partial` : value;
}

export function RunUsage({ id, tick }: { id: string; tick: number }) {
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [offset, setOffset] = useState(0);
  const [groupBy, setGroupBy] = useState<'node' | 'attempt'>('node');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [data, setData] = useState<Report>();
  const [error, setError] = useState('');
  useEffect(() => {
    setOffset(0);
  }, [id, includeDescendants, groupBy]);
  useEffect(() => {
    let active = true;
    setError('');
    api.runs.usage
      .query({
        runId: id,
        includeDescendants,
        offset,
        limit: 20,
        groupBy,
      })
      .then((value) => {
        if (active) setData(value);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [id, tick, includeDescendants, offset, groupBy]);
  const report =
    data?.runId === id &&
    data.includeDescendants === includeDescendants &&
    data.groupBy === groupBy &&
    data.offset === offset
      ? data
      : undefined;
  const totals = report?.totals;
  return (
    <section className={styles.panel} aria-label="Reported usage">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600} size="sm">
            Reported usage
          </Text>
          <Checkbox
            size="xs"
            label="Include child runs, including detached"
            checked={includeDescendants}
            onChange={(event) =>
              setIncludeDescendants(event.currentTarget.checked)
            }
          />
        </Group>
        {error ? (
          <Text size="sm" c="red">
            {error}
          </Text>
        ) : !totals ? (
          <Text size="sm">Loading usage…</Text>
        ) : (
          <>
            <Group gap="lg">
              <Text size="sm">
                Input tokens: {usageMetricText(totals.tokens.inputTokens)}
              </Text>
              <Text size="sm">
                Output tokens: {usageMetricText(totals.tokens.outputTokens)}
              </Text>
              <Text size="sm">
                Cost:{' '}
                {totals.costs.length
                  ? totals.costs
                      .map(
                        (cost) =>
                          `${usageMetricText(cost.amountMicros, 1_000_000)} ${cost.currency}`,
                      )
                      .join(' / ')
                  : 'Unknown'}
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              {totals.reportedAttempts} of {totals.attempts} claim attempts
              reported · {totals.finalAttempts} final
              {includeDescendants
                ? ` · ${report.includedDetachedRuns} detached runs included`
                : ''}
            </Text>
            {!totals.reportedAttempts && (
              <Text size="xs" c="dimmed">
                Executors must report usage. Missing figures do not mean zero.
              </Text>
            )}
            {!!report.groups.length && (
              <details
                open={detailsOpen}
                onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
              >
                <summary>Usage and model attribution</summary>
                <NativeSelect
                  label="Group usage by"
                  value={groupBy}
                  data={[
                    { value: 'node', label: 'Node' },
                    { value: 'attempt', label: 'Claim attempt' },
                  ]}
                  onChange={(event) =>
                    setGroupBy(event.currentTarget.value as 'node' | 'attempt')
                  }
                  mt="xs"
                  mb="xs"
                />
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Node</th>
                        <th>
                          {groupBy === 'attempt' ? 'Attempt' : 'Attempts'}
                        </th>
                        {groupBy === 'attempt' && (
                          <>
                            <th>Requested tier</th>
                            <th>Declared selection</th>
                            <th>Usage-reported models</th>
                          </>
                        )}
                        <th>Input tokens</th>
                        <th>Output tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.groups.map((group) => (
                        <tr key={group.key}>
                          <td>
                            {group.label}
                            {includeDescendants && (
                              <Text size="xs" c="dimmed">
                                Run {group.runId?.slice(0, 8)}
                              </Text>
                            )}
                          </td>
                          <td>
                            {groupBy === 'attempt'
                              ? group.attempt
                              : group.totals.attempts}
                          </td>
                          {groupBy === 'attempt' && (
                            <>
                              <td>
                                {group.requestedTier === null
                                  ? 'Executor default'
                                  : (group.requestedTier ?? 'Unknown')}
                              </td>
                              <td>
                                {group.modelSelection
                                  ? `Tier: ${group.modelSelection.tier ?? 'Unknown'}; provider: ${group.modelSelection.provider ?? 'Unknown'}; model: ${group.modelSelection.model ?? 'Unknown'}`
                                  : 'Unknown'}
                              </td>
                              <td>
                                {group.snapshot?.models
                                  .map(
                                    (model) =>
                                      `${model.provider} / ${model.model}`,
                                  )
                                  .join(', ') ?? 'Unknown'}
                              </td>
                            </>
                          )}
                          <td>
                            {usageMetricText(group.totals.tokens.inputTokens)}
                          </td>
                          <td>
                            {usageMetricText(group.totals.tokens.outputTokens)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(offset > 0 || report.nextOffset !== null) && (
                  <Group justify="space-between" mt="xs">
                    <Button
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 20))}
                    >
                      Previous {groupBy === 'node' ? 'nodes' : 'attempts'}
                    </Button>
                    <Text size="xs">
                      {offset + 1}–{offset + report.groups.length} of{' '}
                      {report.totalGroups}
                    </Text>
                    <Button
                      disabled={report.nextOffset === null}
                      onClick={() => setOffset(report.nextOffset!)}
                    >
                      Next {groupBy === 'node' ? 'nodes' : 'attempts'}
                    </Button>
                  </Group>
                )}
              </details>
            )}
          </>
        )}
      </Stack>
    </section>
  );
}
