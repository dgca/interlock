import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  Link,
  useNavigate,
  useLocation,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router';
import { ArrowUpRight, Columns3, Plus, Search, Settings2 } from 'lucide-react';
import {
  boardStatusSchema,
  runDisplayTitle,
  type BoardStatus,
} from '@interlock/core';
import {
  Anchor,
  Badge,
  Button,
  EmptyState,
  Group,
  Loader,
  PageHeader,
  Select,
  Stack,
  Text,
  TextInput,
  workspacePage,
} from '../../design-system';
import { ExternalTaskLink } from '../../components/ExternalTaskLink';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import type { AppContext } from '../../App';
import { paths, runOffset } from '../../routes/paths';
import { requestActionLabel } from '../runs/runAttention';
import type { api } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import { runProjectionLabels } from '../runs/runProjectionText';
import { parseRequestTarget, RequestView } from './RequestView';
import { BoardRowsSkeleton, BoardColumnsSkeleton } from './BoardSkeleton';
import classes from './Boards.module.css';

type BoardData = Awaited<ReturnType<typeof api.boards.get.query>>;
type ColumnData = BoardData['columns'][number];
type Card = ColumnData['cards'][number];
const pageSize = 30;
const workflowNames = new Intl.ListFormat('en');
const statusLabels: Record<BoardStatus, string> = {
  all: 'All',
  attention: 'Needs attention',
  queued: 'Queued',
  running: 'Running',
  waiting: 'Waiting',
  failed: 'Failed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const scrollPositions = new Map<string, number>();

export function BoardLibrary() {
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const term = search.trim().toLocaleLowerCase();
  const boards = useQuery(trpc.boards.list.queryOptions());
  const boardsRead = workspaceRead('boards', boards, searchInput);
  const { workflows } = useOutletContext<AppContext>();
  const byId = new Map(
    workflows.map((workflow) => [workflow.id, workflow.name]),
  );
  const visible = boards.data?.filter((board) =>
    board.name.toLocaleLowerCase().includes(term),
  );
  return (
    <div className={workspacePage.page}>
      <PageHeader
        title="Boards"
        controls={
          <TextInput
            ref={searchInput}
            aria-label="Search boards"
            placeholder="Search boards"
            className={classes.librarySearch}
            leftSection={<Search size={16} aria-hidden="true" />}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        }
        actions={
          <Button component={Link} to={paths.boardNew} variant="primary">
            <Plus size={16} /> New board
          </Button>
        }
      />
      <div className={workspacePage.content}>
        <WorkspaceReadWarning reads={[boardsRead]} inline showDetails />
        {!boardsRead.ready && !boardsRead.error && <BoardRowsSkeleton />}
        {visible?.length === 0 && (
          <EmptyState title={term ? 'No matching boards' : 'No boards yet'}>
            {term ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  searchInput.current?.focus();
                }}
              >
                Clear search
              </Button>
            ) : (
              <Button component={Link} to={paths.boardNew} variant="secondary">
                Create a board
              </Button>
            )}
          </EmptyState>
        )}
        {!!visible?.length && (
          <ul className={classes.library} role="list">
            {visible.map((board) => {
              const names = board.workflowIds.flatMap(
                (id) => byId.get(id) ?? [],
              );
              const count = board.workflowIds.length;
              return (
                <li className={classes.libraryRow} key={board.id}>
                  <div className={classes.libraryIcon} aria-hidden="true">
                    <Columns3 size={18} />
                  </div>
                  <div className={classes.libraryDetails}>
                    <h2>
                      <Anchor
                        component={Link}
                        to={paths.board(board.id)}
                        underline="hover"
                      >
                        {board.name}
                      </Anchor>
                    </h2>
                    <Text size="sm" c="dimmed">
                      {!count
                        ? 'No workflows assigned'
                        : names.length === count
                          ? workflowNames.format(names)
                          : `${count} assigned ${count === 1 ? 'workflow' : 'workflows'}`}
                    </Text>
                  </div>
                  {board.attentionCount > 0 && (
                    <Badge
                      className={classes.libraryAttention}
                      variant="light"
                      color="yellow"
                      radius="sm"
                      size="lg"
                    >
                      {board.attentionCount}{' '}
                      {board.attentionCount === 1 ? 'request' : 'requests'}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function WorkflowBoardRoute() {
  const id = useParams().boardId!;
  return <WorkflowBoard key={id} id={id} />;
}

function WorkflowBoard({ id }: { id: string }) {
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const acknowledged = location.state?.savedBoard;
  const { workflows } = useOutletContext<AppContext>();
  const status = boardStatusSchema.catch('all').parse(search.get('status'));
  const workflowId = search.get('workflow') || undefined;
  const target = parseRequestTarget(search.get('request'));
  const filters = { id, status, workflowId };
  const query = useQuery(
    trpc.boards.get.queryOptions({ ...filters, limit: pageSize }),
  );
  const statusFilter = useRef<HTMLInputElement>(null);
  const workflowFilter = useRef<HTMLInputElement>(null);
  const boardRead = workspaceRead('board', query, statusFilter);
  const scroll = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const previous = useRef(Boolean(target));
  const scrollKey = `${id}:${status}:${workflowId ?? ''}`;
  const showAcknowledgement =
    acknowledged?.id === id &&
    (!query.data || query.data.board.revision < acknowledged.revision);
  const boardName = showAcknowledgement
    ? acknowledged.name
    : (query.data?.board.name ?? 'Board');
  useLayoutEffect(() => {
    if (!target && query.data && scroll.current) {
      scroll.current.scrollLeft = scrollPositions.get(scrollKey) ?? 0;
      if (previous.current)
        (opener.current?.isConnected ? opener.current : scroll.current).focus({
          preventScroll: true,
        });
    }
    previous.current = Boolean(target);
  }, [Boolean(target), Boolean(query.data), scrollKey]);
  const change = (
    updates: Record<string, string | undefined>,
    replace = false,
  ) =>
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        if (
          Object.hasOwn(updates, 'status') ||
          Object.hasOwn(updates, 'workflow')
        )
          for (const param of [...next.keys()])
            if (param.startsWith('page:')) next.delete(param);
        for (const [key, value] of Object.entries(updates)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace, preventScrollReset: true, state: location.state },
    );
  const filtered = status !== 'all' || Boolean(workflowId);
  const clearFilters = () => {
    void change({ status: undefined, workflow: undefined });
    (workflowId ? workflowFilter : statusFilter).current?.focus();
  };

  return (
    <>
      <div
        className={`${workspacePage.page} ${classes.boardPage}`}
        hidden={Boolean(target)}
      >
        <PageHeader
          title={boardName}
          status={showAcknowledgement ? 'Saved' : undefined}
          onBack={() => void navigate(paths.boards)}
          backLabel="Back to boards"
          controls={
            <>
              <Select
                ref={workflowFilter}
                aria-label="Workflow"
                w={180}
                allowDeselect={false}
                value={workflowId ?? ''}
                onChange={(value) =>
                  void change({ workflow: value || undefined })
                }
                data={[
                  { value: '', label: 'All workflows' },
                  ...workflows
                    .filter((workflow) => workflow.boardId === id)
                    .map((workflow) => ({
                      value: workflow.id,
                      label: workflow.name,
                    })),
                ]}
              />
              <Select
                ref={statusFilter}
                aria-label="Status"
                w={214}
                maxDropdownHeight={298}
                leftSectionWidth={58}
                leftSection={
                  <Text size="sm" c="dimmed">
                    Status
                  </Text>
                }
                allowDeselect={false}
                value={status}
                onChange={(value) =>
                  void change({
                    status: value && value !== 'all' ? value : undefined,
                  })
                }
                data={Object.entries(statusLabels).map(([value, label]) => ({
                  value,
                  label,
                }))}
                renderOption={({ option }) => (
                  <Group justify="space-between" w="100%">
                    <span>{option.label}</span>
                    {option.value === 'attention' && query.data && (
                      <Badge color="yellow" variant="light" size="sm">
                        {query.data.attentionCount}
                      </Badge>
                    )}
                  </Group>
                )}
              />
            </>
          }
          actions={
            <Button component={Link} to={paths.boardSettings(id)}>
              <Settings2 size={16} /> Board settings
            </Button>
          }
        />
        {boardRead.error && (
          <div className={classes.content}>
            <WorkspaceReadWarning reads={[boardRead]} inline showDetails />
          </div>
        )}
        {!boardRead.ready && !boardRead.error && <BoardColumnsSkeleton />}
        {query.data && (
          <>
            {query.data.columns.every((column) => column.total === 0) && (
              <Group className={classes.empty} gap="md">
                <Text size="sm" c="dimmed">
                  {filtered
                    ? 'No runs match these filters.'
                    : 'No runs on this board.'}
                </Text>
                {filtered && (
                  <Button variant="secondary" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
              </Group>
            )}
            <div
              className={classes.scroller}
              ref={scroll}
              tabIndex={0}
              role="region"
              aria-label="Board columns"
              onScroll={(event) => {
                if (!target)
                  scrollPositions.set(
                    scrollKey,
                    event.currentTarget.scrollLeft,
                  );
              }}
            >
              <div className={classes.columns}>
                {query.data.columns.map((column) => (
                  <StageColumn
                    key={`${scrollKey}:${column.id}`}
                    column={column}
                    filters={filters}
                    search={search}
                    onMore={(depth) =>
                      void change(
                        { [`page:${column.id}`]: String(depth) },
                        true,
                      )
                    }
                    rememberOpener={(element) => {
                      opener.current = element;
                    }}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      {target && (
        <RequestView
          target={target}
          backLabel={`Back to ${boardName}`}
          onBack={() => void change({ request: undefined }, true)}
          requestHref={(next) => {
            const query = new URLSearchParams(search);
            query.set('request', JSON.stringify(next));
            return `${paths.board(id)}?${query}`;
          }}
        />
      )}
    </>
  );
}

function StageColumn({
  column,
  filters,
  search,
  onMore,
  rememberOpener,
}: {
  column: ColumnData;
  filters: { id: string; status: BoardStatus; workflowId?: string };
  search: URLSearchParams;
  onMore: (depth: number) => void;
  rememberOpener: (element: HTMLAnchorElement) => void;
}) {
  const pages = Math.max(1, runOffset(search.get(`page:${column.id}`)));
  const visiblePages = Math.min(
    pages,
    Math.max(1, Math.ceil(column.total / pageSize)),
  );
  const [mountedDepth, setMountedDepth] = useState(2);
  const depth = Math.min(visiblePages, mountedDepth);
  const extraPages = useQueries({
    queries: Array.from({ length: depth - 1 }, (_, page) =>
      trpc.boards.get.queryOptions({
        ...filters,
        column: column.id,
        offset: (page + 1) * pageSize,
        limit: pageSize,
      }),
    ),
  });
  const ready = extraPages.every((page) => page.isSuccess && !page.isFetching);
  useEffect(() => {
    // Restore the requested depth one bounded read at a time.
    if (mountedDepth > Math.max(2, visiblePages))
      setMountedDepth(Math.max(2, visiblePages));
    else if (ready && depth < visiblePages) setMountedDepth(depth + 1);
  }, [depth, mountedDepth, ready, visiblePages]);
  const cardPages = [
    column.cards,
    ...extraPages.map(
      (page) =>
        page.data?.columns.find((item) => item.id === column.id)?.cards ?? [],
    ),
  ];
  const card = (item: Card) => (
    <BoardCard
      key={item.id}
      card={item}
      search={search}
      boardId={filters.id}
      rememberOpener={rememberOpener}
    />
  );
  return (
    <section className={classes.column} aria-label={column.name}>
      <Group gap="xs" className={classes.columnHeading}>
        <h2>{column.name}</h2>
        <Badge color="gray" variant="light" size="sm">
          {column.total}
        </Badge>
      </Group>
      <Stack gap="xs">
        {cardPages.some((page) => page.length) && (
          <ul className={classes.cards} role="list">
            {cardPages.map((page, index) => (
              <Fragment key={index}>{page.map(card)}</Fragment>
            ))}
          </ul>
        )}
        {extraPages.map((page, index) =>
          page.error ? (
            <WorkspaceReadWarning
              key={index}
              reads={[
                workspaceRead(`page ${index + 2} in ${column.name}`, page),
              ]}
              inline
              showDetails
            />
          ) : (
            !page.data && (
              <Loader key={index} size="xs" aria-label="Loading more cards" />
            )
          ),
        )}
        {pages * pageSize < column.total && (
          <Button
            variant="ghost"
            disabled={!ready || depth < visiblePages}
            onClick={() => onMore(pages + 1)}
          >
            Load more in {column.name}
          </Button>
        )}
      </Stack>
    </section>
  );
}

function BoardCard({
  card,
  search,
  boardId,
  rememberOpener,
}: {
  card: Card;
  search: URLSearchParams;
  boardId: string;
  rememberOpener: (element: HTMLAnchorElement) => void;
}) {
  const title = runDisplayTitle(card);
  const terminal =
    card.status === 'failed' ||
    card.status === 'completed' ||
    card.status === 'cancelled';
  const reason =
    card.requestSummary ||
    (card.status === 'failed' ? card.error?.split('\n')[0] : undefined) ||
    card.waiting?.detail.message ||
    runProjectionLabels(card).waiting ||
    (!terminal ? card.activity : undefined);
  const boardUrl = paths.board(boardId) + (search.size ? `?${search}` : '');
  const runLink = paths.run(card.runId, { returnTo: boardUrl });
  const requestSearch = card.request ? new URLSearchParams(search) : undefined;
  requestSearch?.set('request', JSON.stringify(card.request));
  return (
    <li className={classes.card}>
      <h3>
        <Anchor component={Link} to={runLink} underline="hover">
          {title}
        </Anchor>
      </h3>
      {(card.title || card.externalTask?.title) && (
        <Text c="dimmed" size="sm">
          {card.workflowName}
        </Text>
      )}
      <Group gap="xs" mt={5}>
        {terminal && <StatusBadge status={card.status} />}
        {!!card.attentionCount && (
          <Badge color="yellow" variant="light">
            Needs attention · {card.attentionCount}
          </Badge>
        )}
      </Group>
      {reason && <p className={classes.reason}>{reason}</p>}
      <Group mt={6} gap="sm" justify="space-between">
        {card.request && requestSearch && (
          <Anchor
            component={Link}
            to={{ search: `?${requestSearch}` }}
            preventScrollReset
            onClick={(event) => {
              if (
                event.button === 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              )
                rememberOpener(event.currentTarget);
            }}
            size="sm"
            underline="hover"
          >
            {requestActionLabel(card.request.kind)}
            <ArrowUpRight size={14} aria-hidden="true" />
          </Anchor>
        )}
        <ExternalTaskLink task={card.externalTask} withArrow />
      </Group>
    </li>
  );
}
