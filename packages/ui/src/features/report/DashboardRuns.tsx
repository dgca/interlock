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

const activePageSize = 100;
const shownAttention = 8;
const shownRecent = 8;

type Pending = { run: RunRow; label: string; since: string };

/** Held and queued active runs; attention requests come from the server's attention read. */
function blockedEntry(run: RunRow): Pending | null {
  const reason = runProjectionLabels(run).waiting;
  if (run.waiting?.kind === 'hold' || run.waiting?.kind === 'pause')
    return {
      run,
      label: ['Held', reason].filter(Boolean).join(' · '),
      since: run.waiting.since,
    };
  if (run.status === 'queued' || run.waiting?.kind === 'admission_queue')
    return {
      run,
      label: reason ?? 'Queued',
      since: run.waiting?.since ?? run.createdAt,
    };
  return null;
}

/** Workflow-scoped lists name runs by task title or short ID; library lists fall back to the workflow. */
function runName(run: RunRow, workflowId?: string) {
  if (run.title) return run.title;
  return workflowId
    ? `Run ${run.id.slice(0, 8)}`
    : run.workflowName || run.workflowId;
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
  const scope = { workflowId, tags };
  const attention = useQuery(
    trpc.runs.summaries.queryOptions({
      ...scope,
      tab: 'attention',
      limit: activePageSize,
    }),
  );
  const active = useQuery(
    trpc.runs.summaries.queryOptions({
      ...scope,
      tab: 'active',
      limit: activePageSize,
    }),
  );
  const history = useQuery(
    trpc.runs.summaries.queryOptions({
      ...scope,
      tab: 'history',
      limit: shownRecent,
    }),
  );
  const attentionRead = workspaceRead('attention', attention);
  const activeRead = workspaceRead('active runs', active);
  const historyRead = workspaceRead('recent runs', history);
  const nowMs = Date.now();
  const requested = (attention.data?.items ?? []).filter(
    (run) => run.attention,
  );
  const requestedIds = new Set(requested.map((run) => run.id));
  const blocked = (active.data?.items ?? [])
    .filter((run) => !requestedIds.has(run.id))
    .map(blockedEntry)
    .filter((entry): entry is Pending => entry !== null);
  const pending = [
    ...requested.map((run) => ({
      run,
      label: attentionText(run.attention!),
      since: run.waiting?.since ?? run.updatedAt,
    })),
    ...blocked,
  ].sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
  const stalled = requested.filter((run) =>
    run.attention!.reasons.includes('stalled'),
  ).length;
  const held = blocked.filter((entry) => entry.label.startsWith('Held')).length;
  const summary = [
    `${attention.data?.counts.attention ?? 0} need attention${stalled ? ` (${stalled} stalled)` : ''}`,
    `${held} held`,
    `${blocked.length - held} queued`,
  ].join(' · ');
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
        <WorkspaceReadWarning
          reads={[attentionRead, activeRead].filter((read) => read.ready)}
        />
        <WorkspaceReads
          reads={[attentionRead, activeRead]}
          subject="pending runs"
          loading={<ListSkeleton />}
        >
          <Text size="sm" c="dimmed" mb="sm">
            {summary}
            {(active.data?.total ?? 0) > activePageSize &&
              ` · held and queued from the newest ${activePageSize} active runs`}
          </Text>
          {pending.length === 0 ? (
            <Text size="sm">Nothing is waiting on a person or blocked.</Text>
          ) : (
            <ul className={styles.list}>
              {pending.slice(0, shownAttention).map(({ run, label, since }) => (
                <li key={run.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <Anchor component={Link} to={runHref(run)} fw={500}>
                      {runName(run, workflowId)}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {label}
                      {!workflowId && run.workflowName && run.title
                        ? ` · ${run.workflowName}`
                        : ''}
                    </Text>
                  </div>
                  <Text
                    size="sm"
                    className={styles.rowValue}
                    title={new Date(since).toLocaleString()}
                  >
                    {formatWait(since, nowMs)}
                  </Text>
                </li>
              ))}
            </ul>
          )}
          {pending.length > shownAttention && (
            <Text size="xs" c="dimmed" mt="xs">
              {pending.length - shownAttention} more in Active runs
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
                      {runName(run, workflowId)}
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
