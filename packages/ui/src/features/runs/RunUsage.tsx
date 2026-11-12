import {
  LoadingSkeleton,
  Checkbox,
  Group,
  NativeSelect,
  Stack,
  Text,
  Button,
} from '../../design-system';

import { useEffect, useState } from 'react';

import type { UsageMetric } from '@interlock/core';
import { errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';

import styles from './RunUsage.module.css';

export function usageMetricText(metric: UsageMetric, scale = 1) {
  if (metric.overflow) return 'Too large to total';
  if (metric.value === null) return 'Unknown';
  const value = (metric.value / scale).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
  return metric.coverage === 'partial' ? `${value} · partial` : value;
}

export function RunUsage({ id }: { id: string }) {
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [offset, setOffset] = useState(0);
  const [groupBy, setGroupBy] = useState<'node' | 'attempt'>('node');
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    setOffset(0);
  }, [id]);
  const result = useQuery(
    trpc.runs.usage.queryOptions({
      runId: id,
      includeDescendants,
      offset,
      limit: 20,
      groupBy,
    }),
  );
  const report = result.data;
  const error = result.error ? errorMessage(result.error) : '';
  const totals = report?.totals;
  return (
    <section className={styles.panel} aria-label="Reported usage">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text component="h2" fw={600} size="lg" m={0}>
            Reported usage
          </Text>
          <Checkbox
            size="xs"
            label="Include child runs, including detached"
            checked={includeDescendants}
            onChange={(event) => {
              setOffset(0);
              setIncludeDescendants(event.currentTarget.checked);
            }}
          />
        </Group>
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        {!totals ? (
          !error && <LoadingSkeleton label="Loading usage…" />
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
                Executors or observers must report usage. Missing figures do not
                mean zero.
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
                  onChange={(event) => {
                    setOffset(0);
                    setGroupBy(event.currentTarget.value as 'node' | 'attempt');
                  }}
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
                            <th>Usage source</th>
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
                                  ? 'No preference'
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
                              <td>
                                {group.source === 'observer'
                                  ? 'Observer'
                                  : group.source === 'executor'
                                    ? 'Executor'
                                    : 'Unknown'}
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
