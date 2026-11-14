import type { ReactNode } from 'react';
import { Link, type To } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import {
  runDisplayTitle,
  type ExternalTask,
  type RequestTarget,
  type RunProjection,
  type RunStatus,
} from '@interlock/core';
import { Anchor, Badge, Group, Text } from '../../design-system';
import { ExternalTaskLink } from '../../components/ExternalTaskLink';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import stretched from '../../components/StretchedLink.module.css';
import { requestActionLabel } from '../runs/runAttention';
import {
  runDisplayStatus,
  runProjectionLabels,
} from '../runs/runProjectionText';
import classes from './Boards.module.css';

/** The card fields column boards and computed board views share. */
export type BoardCardData = RunProjection & {
  id: string;
  runId: string;
  workflowName: string;
  title?: string;
  externalTask?: ExternalTask;
  status: RunStatus;
  attentionCount: number;
  request?: RequestTarget;
  requestSummary?: string;
  error?: string;
  activity?: string;
  since?: string;
  held?: { reason: string };
  runCount?: number;
  fields?: Record<string, unknown>;
};

const units = [
  [86_400_000, 'd'],
  [3_600_000, 'h'],
  [60_000, 'm'],
] as const;
/** Compact elapsed time, such as "3h" or "2d". */
function elapsed(since: string, now = Date.now()) {
  const ms = Math.max(0, now - Date.parse(since));
  const [size, unit] = units.find(([size]) => ms >= size) ?? [60_000, 'm'];
  return `${Math.floor(ms / size)}${unit}`;
}

function FieldValue({ value }: { value: unknown }) {
  if (typeof value === 'string' && /^https?:\/\//.test(value))
    return (
      <Anchor
        href={value}
        target="_blank"
        rel="noreferrer"
        size="sm"
        className={stretched.action}
      >
        {value.replace(/^https?:\/\/(www\.)?/, '')}
        <ArrowUpRight size={14} aria-hidden="true" />
      </Anchor>
    );
  if (
    typeof value === 'string' &&
    !Number.isNaN(Date.parse(value)) &&
    /^\d{4}-\d\d-\d\dT/.test(value)
  )
    return (
      <time dateTime={value} title={new Date(value).toLocaleString()}>
        {elapsed(value)}
      </time>
    );
  return <>{String(value)}</>;
}

export function BoardCard({
  card,
  runLink,
  requestLink,
  onOpenRequest,
  fields = [],
  actions,
}: {
  card: BoardCardData;
  runLink: string;
  requestLink?: To;
  onOpenRequest?: (element: HTMLAnchorElement) => void;
  fields?: { id: string; label: string }[];
  actions?: ReactNode;
}) {
  const title = runDisplayTitle(card);
  const terminal =
    card.status === 'failed' ||
    card.status === 'completed' ||
    card.status === 'cancelled';
  const projection = runProjectionLabels(card);
  const reason =
    card.held?.reason ||
    card.requestSummary ||
    (card.status === 'failed' ? card.error?.split('\n')[0] : undefined) ||
    card.waiting?.detail.message ||
    projection.waiting ||
    projection.activity ||
    (!terminal ? card.activity : undefined);
  const shown = fields.filter(
    ({ id }) =>
      card.fields?.[id] !== undefined &&
      card.fields[id] !== card.externalTask?.url,
  );
  return (
    <li
      className={`${classes.card} ${stretched.container}`}
      data-card-run={card.runId}
    >
      <h3>
        <Link className={stretched.link} to={runLink}>
          {title}
        </Link>
      </h3>
      {(card.title || card.externalTask?.title) && (
        <Text c="dimmed" size="sm">
          {card.workflowName}
          {card.runCount && card.runCount > 1 ? ` · ${card.runCount} runs` : ''}
        </Text>
      )}
      <Group gap="xs" mt={5}>
        {card.held ? (
          <Badge color="gray" variant="light">
            Held
          </Badge>
        ) : (
          <StatusBadge status={runDisplayStatus(card)} />
        )}
        {!!card.attentionCount && (
          <Badge color="yellow" variant="light">
            Needs attention · {card.attentionCount}
          </Badge>
        )}
      </Group>
      {reason && <p className={classes.reason}>{reason}</p>}
      {card.since && card.stage && (
        <Text size="xs" c="dimmed" mt={6}>
          {card.stage}
          {!terminal && (
            <>
              {' · '}
              <time
                dateTime={card.since}
                title={`Since ${new Date(card.since).toLocaleString()}`}
              >
                {elapsed(card.since)}
              </time>
            </>
          )}
        </Text>
      )}
      {shown.length > 0 && (
        <dl className={classes.fields}>
          {shown.map(({ id, label }) => (
            <div key={id}>
              <dt>{label}</dt>
              <dd>
                <FieldValue value={card.fields![id]} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Group mt={6} gap="sm" justify="space-between">
        {card.request && requestLink && (
          <Anchor
            component={Link}
            to={requestLink}
            className={stretched.action}
            preventScrollReset
            onClick={(event) => {
              if (
                onOpenRequest &&
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              )
                onOpenRequest(event.currentTarget);
            }}
            size="sm"
            underline="hover"
          >
            {requestActionLabel(card.request.kind)}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Anchor>
        )}
        <ExternalTaskLink
          task={card.externalTask}
          withArrow
          className={stretched.action}
        />
        {actions && (
          <Group gap={4} ml="auto" wrap="nowrap">
            {actions}
          </Group>
        )}
      </Group>
    </li>
  );
}
