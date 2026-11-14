import { Link, useLocation } from 'react-router';
import {
  Anchor,
  Group,
  LoadingSkeleton,
  Placeholder,
  SimpleGrid,
  Stack,
  Text,
  Title,
  workspacePage,
} from '../../design-system';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import {
  WorkspaceReadWarning,
  WorkspaceReads,
  workspaceRead,
} from '../../components/WorkspaceReads';
import type { api } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import { attentionText } from '../runs/runAttention';
import {
  runDisplayStatus,
  runProjectionLabels,
} from '../runs/runProjectionText';
import { formatWait } from './reportFormat';
import styles from './Dashboard.module.css';

type RunRow = Awaited<
  ReturnType<typeof api.runs.summaries.query>
>['items'][number];

type AttentionKind = 'person' | 'held' | 'stalled' | 'queued';
const kindLabels: Record<AttentionKind, string> = {
  person: 'Waiting on a person',
  held: 'Held',
  stalled: 'Stalled',
  queued: 'Queued',
};
const activePageSize = 100;
const shownAttention = 8;
const shownRecent = 8;

/** Places an active run in one pending-attention group, or none while it can proceed. */
function attentionEntry(run: RunRow) {
  const since = run.waiting?.since ?? run.updatedAt;
  const reason = run.attention
    ? attentionText(run.attention)
    : (runProjectionLabels(run).waiting ?? '');
  if (run.attention?.reasons.includes('stalled'))
    return { kind: 'stalled' as const, since, reason };
  if (run.waiting?.kind === 'hold' || run.waiting?.kind === 'pause')
    return { kind: 'held' as const, since, reason };
  if (
    run.attention ||
    run.actor === 'person' ||
    run.waiting?.kind === 'human_request' ||
    run.waiting?.kind === 'input_node'
  )
    return { kind: 'person' as const, since, reason };
  if (run.status === 'queued' || run.waiting?.kind === 'admission_queue')
    return {
      kind: 'queued' as const,
      since: run.waiting?.since ?? run.createdAt,
      reason,
    };
  return null;
}

function runName(run: RunRow) {
  return run.title || run.workflowName || run.workflowId;
}

function ListSkeleton() {
  return (
    <LoadingSkeleton label="Loading runs…">
      <Stack gap="sm">
        <Placeholder h={14} />
        <Placeholder h={14} />
        <Placeholder h={14} w="70%" />
      </Stack>
    </LoadingSkeleton>
  );
}

/** Runs needing a person or blocked now, and the latest runs, independent of the report period. */
export function DashboardRuns({
  workflowId,
  tags,
}: {
  workflowId?: string;
  tags?: Record<string, string>;
}) {
  const location = useLocation();
  const returnTo = location.pathname + location.search;
  const active = useQuery(
    trpc.runs.summaries.queryOptions({
      tab: 'active',
      workflowId,
      tags,
      limit: activePageSize,
    }),
  );
  const history = useQuery(
    trpc.runs.summaries.queryOptions({
      tab: 'history',
      workflowId,
      tags,
      limit: shownRecent,
    }),
  );
  const activeRead = workspaceRead('active runs', active);
  const historyRead = workspaceRead('recent runs', history);
  const nowMs = Date.now();
  const attention = (active.data?.items ?? [])
    .map((run) => ({ run, entry: attentionEntry(run) }))
    .filter(
      (item): item is { run: RunRow; entry: NonNullable<typeof item.entry> } =>
        item.entry !== null,
    )
    .sort((a, b) => Date.parse(a.entry.since) - Date.parse(b.entry.since));
  const counts = Object.fromEntries(
    (Object.keys(kindLabels) as AttentionKind[]).map((kind) => [
      kind,
      attention.filter((item) => item.entry.kind === kind).length,
    ]),
  ) as Record<AttentionKind, number>;
  const recent = [...(active.data?.items ?? []), ...(history.data?.items ?? [])]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, shownRecent);
  const runsHref = workflowId
    ? paths.workflowRuns(workflowId, 'active')
    : paths.runs('active');
  const runHref = (run: RunRow) =>
    paths.run(run.id, {
      returnTo,
      executionId: run.attention?.target.executionId,
    });
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
      <section className={workspacePage.card} aria-labelledby="attention-title">
        <Group justify="space-between" mb="xs" wrap="wrap">
          <Title order={2} size="h4" id="attention-title">
            Pending attention
          </Title>
          <Anchor component={Link} to={runsHref} size="sm">
            Active runs
          </Anchor>
        </Group>
        <WorkspaceReadWarning reads={activeRead.ready ? [activeRead] : []} />
        <WorkspaceReads
          reads={[activeRead]}
          subject="active runs"
          loading={<ListSkeleton />}
        >
          <Text size="sm" c="dimmed" mb="sm">
            {(Object.keys(kindLabels) as AttentionKind[])
              .map(
                (kind) => `${counts[kind]} ${kindLabels[kind].toLowerCase()}`,
              )
              .join(' · ')}
            {(active.data?.total ?? 0) > activePageSize &&
              ` · from the newest ${activePageSize} active runs`}
          </Text>
          {attention.length === 0 ? (
            <Text size="sm">Nothing is waiting on a person or blocked.</Text>
          ) : (
            <ul className={styles.list}>
              {attention.slice(0, shownAttention).map(({ run, entry }) => (
                <li key={run.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <Anchor component={Link} to={runHref(run)} fw={500}>
                      {runName(run)}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {kindLabels[entry.kind]}
                      {[...new Set(entry.reason.split(' · '))]
                        .filter(
                          (part) => part && part !== kindLabels[entry.kind],
                        )
                        .map((part) => ` · ${part}`)
                        .join('')}
                      {!workflowId && run.workflowName && run.title
                        ? ` · ${run.workflowName}`
                        : ''}
                    </Text>
                  </div>
                  <Text
                    size="sm"
                    className={styles.rowValue}
                    title={new Date(entry.since).toLocaleString()}
                  >
                    {formatWait(entry.since, nowMs)}
                  </Text>
                </li>
              ))}
            </ul>
          )}
          {attention.length > shownAttention && (
            <Text size="xs" c="dimmed" mt="xs">
              {attention.length - shownAttention} more in Active runs
            </Text>
          )}
        </WorkspaceReads>
      </section>
      <section className={workspacePage.card} aria-labelledby="recent-title">
        <Title order={2} size="h4" id="recent-title" mb="sm">
          Recent runs
        </Title>
        <WorkspaceReadWarning
          reads={[activeRead, historyRead].filter((read) => read.ready)}
        />
        <WorkspaceReads
          reads={[activeRead, historyRead]}
          subject="recent runs"
          loading={<ListSkeleton />}
        >
          {recent.length === 0 ? (
            <Text size="sm">No runs yet.</Text>
          ) : (
            <ul className={styles.list}>
              {recent.map((run) => (
                <li key={run.id} className={styles.row}>
                  <span className={styles.status}>
                    <StatusBadge status={runDisplayStatus(run)} />
                  </span>
                  <div className={styles.rowMain}>
                    <Anchor component={Link} to={runHref(run)} fw={500}>
                      {runName(run)}
                    </Anchor>
                    <Text
                      size="xs"
                      c="dimmed"
                      title={new Date(run.createdAt).toLocaleString()}
                    >
                      {new Date(run.createdAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {!workflowId && run.title && run.workflowName
                        ? ` · ${run.workflowName}`
                        : ''}
                    </Text>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </WorkspaceReads>
      </section>
    </SimpleGrid>
  );
}
