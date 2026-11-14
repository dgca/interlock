import { Fragment, useState, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Badge, Button, Group, Loader, Stack, Text } from '../../design-system';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import type { api } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import { BoardCard } from './BoardCard';
import { BoardColumnsSkeleton } from './BoardSkeleton';
import classes from './Boards.module.css';

export type BoardView = Awaited<ReturnType<typeof api.boards.view.query>>;
type Lane = BoardView['lanes'][number];
type ViewCard = Lane['cards'][number];
const pageSize = 30;

/**
 * Lanes computed from run state for a typed board or a workflow's own stage
 * board. Cards and placement come from `boards.view`; nothing here moves them.
 */
export function BoardLanes({
  scope,
  returnTo,
  empty,
  cardActions,
}: {
  scope: { id: string } | { workflowId: string };
  returnTo: string;
  empty?: ReactNode;
  cardActions?: (card: ViewCard, view: BoardView) => ReactNode;
}) {
  const query = useQuery(
    trpc.boards.view.queryOptions({ ...scope, limit: pageSize }),
  );
  const read = workspaceRead('board', query);
  if (read.error)
    return (
      <div className={classes.content}>
        <WorkspaceReadWarning reads={[read]} inline showDetails />
      </div>
    );
  if (!query.data) return <BoardColumnsSkeleton />;
  const view = query.data;
  return (
    <>
      {view.lanes.every((lane) => lane.total === 0) && (
        <Group className={classes.empty} gap="md">
          {empty ?? (
            <Text size="sm" c="dimmed">
              No runs on this board.
            </Text>
          )}
        </Group>
      )}
      <div
        className={classes.scroller}
        tabIndex={0}
        role="region"
        aria-label="Board lanes"
      >
        <div className={classes.columns}>
          {view.lanes.map((lane) => (
            <LaneColumn
              key={lane.id}
              lane={lane}
              scope={scope}
              render={(card) => (
                <BoardCard
                  key={card.id}
                  card={card}
                  fields={view.fields}
                  runLink={paths.run(card.runId, { returnTo })}
                  requestLink={
                    card.request && paths.request(card.request, returnTo)
                  }
                  actions={cardActions?.(card, view)}
                />
              )}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function LaneColumn({
  lane,
  scope,
  render,
}: {
  lane: Lane;
  scope: { id: string } | { workflowId: string };
  render: (card: ViewCard) => ReactNode;
}) {
  const [pages, setPages] = useState(1);
  const extra = useQueries({
    queries: Array.from({ length: pages - 1 }, (_, page) =>
      trpc.boards.view.queryOptions({
        ...scope,
        lane: lane.id,
        offset: (page + 1) * pageSize,
        limit: pageSize,
      }),
    ),
  });
  const ready = extra.every((page) => page.data && !page.isFetching);
  const cardPages = [
    lane.cards,
    ...extra.map(
      (page) =>
        page.data?.lanes.find((item) => item.id === lane.id)?.cards ?? [],
    ),
  ];
  return (
    <section className={classes.column} aria-label={lane.name}>
      <Group gap="xs" className={classes.columnHeading}>
        <h2>{lane.name}</h2>
        <Badge color="gray" variant="light" size="sm">
          {lane.total}
        </Badge>
      </Group>
      <Stack gap="xs">
        {cardPages.some((page) => page.length) && (
          <ul className={classes.cards} role="list">
            {cardPages.map((page, index) => (
              <Fragment key={index}>{page.map(render)}</Fragment>
            ))}
          </ul>
        )}
        {extra.map((page, index) =>
          page.error ? (
            <WorkspaceReadWarning
              key={index}
              reads={[workspaceRead(`page ${index + 2} in ${lane.name}`, page)]}
              inline
              showDetails
            />
          ) : (
            !page.data && (
              <Loader key={index} size="xs" aria-label="Loading more cards" />
            )
          ),
        )}
        {pages * pageSize < lane.total && (
          <Button
            variant="ghost"
            aria-label={`Load more in ${lane.name}`}
            disabled={!ready}
            onClick={() => setPages(pages + 1)}
          >
            Load more
          </Button>
        )}
      </Stack>
    </section>
  );
}
