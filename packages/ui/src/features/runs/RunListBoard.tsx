import { Anchor, Badge, Button, Text } from '../../design-system';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import {
  WorkspaceReadWarning,
  type WorkspaceRead,
} from '../../components/WorkspaceReads';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import { useId, type MouseEventHandler, type ReactNode } from 'react';
import type { api } from '../../lib/api';
import { ComparisonContext } from './ComparisonContext';
import { RunTags } from './RunTags';
import {
  attentionText,
  waitReasonText,
  runReviewLink,
  type RunTab,
} from './runAttention';
import { runDisplayStatus, runProjectionText } from './runProjectionText';
import classes from './RunList.module.css';
import { runDisplayTitle } from '@interlock/core';

type Page = Awaited<ReturnType<typeof api.runs.summaries.query>>;
type RunItem = Page['items'][number];
export type BoardPreview = {
  attention?: Page;
  completed?: Page;
  attentionRead: WorkspaceRead;
  completedRead: WorkspaceRead;
};

function RunCard({
  run,
  runHref,
  returnTo,
}: {
  run: RunItem;
  runHref: (id: string, executionId?: string) => string;
  returnTo: string;
}) {
  const attention = run.attention;
  const review = runReviewLink(run, runHref, returnTo);
  const reason = run.actor
    ? runProjectionText(
        run,
        run.waiting?.kind === 'human_request' && attention ? '' : undefined,
      )
    : run.waitReason && !attention
      ? waitReasonText[run.waitReason]
      : undefined;
  return (
    <li
      className={`run-row ${classes.runCard}`}
      data-attention={!!review || undefined}
    >
      <span className={classes.cardBody}>
        <span className={classes.cardMetadata}>
          <span className={classes.runId} title={run.id}>
            {run.id.slice(0, 8)}
          </span>
          <span>v{run.version}</span>
        </span>
        <strong className={classes.cardTitle}>
          <Anchor component={Link} to={runHref(run.id)} underline="hover">
            {runDisplayTitle(run)}
          </Anchor>
        </strong>
        {(run.title || run.externalTask?.title) && (
          <span className={classes.cardNote}>{run.workflowName}</span>
        )}
        <span className={classes.cardStatuses}>
          <StatusBadge status={runDisplayStatus(run)} />
          {attention?.reasons.map((reason) => (
            <Badge key={reason} component="span" color="yellow" variant="light">
              {attentionText({ ...attention, reasons: [reason] })}
            </Badge>
          ))}
        </span>
        {reason && <span className={classes.cardReason}>{reason}</span>}
        <ComparisonContext comparison={run.comparison} />
        <RunTags tags={run.tags} compact />
        {run.parentMode === 'detached' && (
          <span className={classes.cardNote}>
            Started independently · from{' '}
            {run.parentWorkflowName ?? run.parentRunId?.slice(0, 8)}
          </span>
        )}
        <span className={classes.cardMetadata}>
          <span>
            {run.executionCount}{' '}
            {run.executionCount === 1 ? 'execution' : 'executions'}
          </span>
          <time
            dateTime={run.createdAt}
            title={new Date(run.createdAt).toLocaleString()}
          >
            {new Date(run.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}{' '}
            ·{' '}
            {new Date(run.createdAt).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              timeZoneName: 'short',
            })}
          </time>
        </span>
      </span>
      {review && (
        <Anchor
          component={Link}
          to={review.href}
          className={classes.cardAction}
        >
          {review.label}
          <ArrowUpRight size={16} aria-hidden="true" />
        </Anchor>
      )}
    </li>
  );
}

function BoardColumn({
  title,
  count,
  tone,
  children,
}: {
  title: string;
  count?: number;
  tone: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={classes.boardColumn} aria-labelledby={id}>
      <div className={classes.columnHeading}>
        <span
          className={classes.columnDot}
          data-tone={tone}
          aria-hidden="true"
        />
        <h2 id={id}>{title}</h2>
        {count !== undefined && <Badge color="gray">{count}</Badge>}
      </div>
      {children}
    </section>
  );
}

export function RunListBoard({
  page,
  preview,
  runHref,
  returnTo,
  onTabChange,
  onClearFilters,
}: {
  page: Page;
  preview: BoardPreview;
  runHref: (id: string, executionId?: string) => string;
  returnTo: string;
  onTabChange: (tab: RunTab) => void;
  onClearFilters?: MouseEventHandler<HTMLButtonElement>;
}) {
  // Keep every run in the bounded active preview visible. The bounded attention
  // preview also includes terminal runs still waiting for recovery confirmation.
  const needsAttention = (run: RunItem) =>
    Boolean(run.request || run.attention);
  const activeIds = new Set(page.items.map((run) => run.id));
  const attention = [
    ...page.items.filter(needsAttention),
    ...(preview.attention?.items.filter(
      (run) => needsAttention(run) && !activeIds.has(run.id),
    ) ?? []),
  ];
  const running = page.items.filter((run) => !needsAttention(run));
  const completed =
    preview.completed?.items.filter((run) => run.status === 'completed') ?? [];
  const cards = (items: RunItem[]) =>
    items.length > 0 && (
      <ul className={classes.cards} role="list">
        {items.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            runHref={runHref}
            returnTo={returnTo}
          />
        ))}
      </ul>
    );
  return (
    <div className={classes.board}>
      <BoardColumn title="Active runs" count={running.length} tone="running">
        {cards(running)}
        {!running.length && (
          <Text size="sm" c="dimmed">
            {page.total
              ? 'Active runs in this preview need attention.'
              : onClearFilters
                ? 'No active runs match these tags.'
                : 'No active runs.'}
          </Text>
        )}
        {!page.total && onClearFilters && (
          <>
            <Text size="sm" c="dimmed">
              Change or clear the tag filters to see other runs.
            </Text>
            <Button variant="ghost" onClick={onClearFilters}>
              Clear filters
            </Button>
          </>
        )}
        {page.total > page.items.length && (
          <Text size="xs" c="dimmed">
            Showing the first {page.items.length} of {page.total} active runs
            across these columns.
          </Text>
        )}
        <Button variant="ghost" onClick={() => onTabChange('active')}>
          View all active
        </Button>
      </BoardColumn>
      <BoardColumn
        title="Needs attention"
        count={page.counts.attention + (page.scheduleAttentionCount ?? 0)}
        tone="attention"
      >
        {cards(attention)}
        <WorkspaceReadWarning
          reads={[preview.attentionRead]}
          inline
          showDetails
        />
        {preview.attentionRead.error ? null : !preview.attention ? (
          <Text size="sm" c="dimmed" role="status">
            Loading attention preview…
          </Text>
        ) : !attention.length ? (
          <Text size="sm" c="dimmed">
            {onClearFilters
              ? 'No matching runs need your attention.'
              : 'No runs need your attention.'}
          </Text>
        ) : null}
        {(page.scheduleAttentionCount ?? 0) > 0 && (
          <Text size="sm" c="dimmed">
            {page.scheduleAttentionCount} automation{' '}
            {page.scheduleAttentionCount === 1 ? 'alert' : 'alerts'}. View all
            attention to review.
          </Text>
        )}
        {attention.length > 0 && page.counts.attention > attention.length && (
          <Text size="xs" c="dimmed">
            Showing {attention.length} of {page.counts.attention} runs.
          </Text>
        )}
        <Button variant="ghost" onClick={() => onTabChange('attention')}>
          View all attention
        </Button>
      </BoardColumn>
      <BoardColumn
        title="Completed runs"
        count={preview.completed ? completed.length : undefined}
        tone="completed"
      >
        {cards(completed)}
        <WorkspaceReadWarning
          reads={[preview.completedRead]}
          inline
          showDetails
        />
        {preview.completedRead.error ? null : !preview.completed ? (
          <Text size="sm" c="dimmed" role="status">
            Loading completed preview…
          </Text>
        ) : !completed.length ? (
          <Text size="sm" c="dimmed">
            {onClearFilters
              ? 'No completed runs match these tags.'
              : 'No completed runs yet.'}
          </Text>
        ) : null}
        <Button variant="ghost" onClick={() => onTabChange('history')}>
          View history
        </Button>
      </BoardColumn>
    </div>
  );
}
