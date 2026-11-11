import { useLayoutEffect, useRef, useState } from 'react';
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router';
import {
  ArrowRight,
  ArrowUpRight,
  Columns3,
  Plus,
  Search,
  Settings2,
} from 'lucide-react';
import {
  boardStatusSchema,
  runDisplayTitle,
  type BoardStatus,
} from '@interlock/core';
import {
  ActionError,
  Anchor,
  Badge,
  Button,
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
import type { AppContext } from '../../App';
import { paths } from '../../routes/paths';
import { errorMessage, type api } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import { runProjectionLabels } from '../runs/runProjectionText';
import { parseRequestTarget, RequestView } from './RequestView';
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
  const boards = useQuery(trpc.boards.list.queryOptions());
  const { workflows } = useOutletContext<AppContext>();
  const byId = new Map(
    workflows.map((workflow) => [workflow.id, workflow.name]),
  );
  const visible = boards.data?.filter((board) =>
    board.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <div className={workspacePage.page}>
      <PageHeader
        title="Boards"
        controls={
          <TextInput
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
      <div className={classes.content}>
        {boards.error && <ActionError message={errorMessage(boards.error)} />}
        {boards.isPending && <Loader aria-label="Loading boards" />}
        {visible?.length === 0 && (
          <Text c="dimmed">
            {search ? 'No boards match your search.' : 'No boards yet.'}
          </Text>
        )}
        {!!visible?.length && (
          <ul className={classes.library} role="list">
            {visible.map((board) => (
              <li className={classes.libraryRow} key={board.id}>
                <div className={classes.libraryIcon} aria-hidden="true">
                  <Columns3 size={18} />
                </div>
                <div className={classes.libraryDetails}>
                  <h2>{board.name}</h2>
                  <Text size="sm" c="dimmed">
                    {workflowNames.format(
                      board.workflowIds
                        .map((id) => byId.get(id))
                        .filter((name) => name !== undefined),
                    ) || 'No workflows assigned'}
                  </Text>
                </div>
                <div className={classes.libraryActions}>
                  {board.attentionCount > 0 && (
                    <Badge variant="light" color="yellow" radius="sm" size="lg">
                      {board.attentionCount}{' '}
                      {board.attentionCount === 1 ? 'request' : 'requests'}
                    </Badge>
                  )}
                  <Button
                    component={Link}
                    to={paths.board(board.id)}
                    variant="secondary"
                    aria-label={`Open board: ${board.name}`}
                  >
                    <ArrowRight size={16} aria-hidden="true" /> Open board
                  </Button>
                </div>
              </li>
            ))}
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
  const { workflows } = useOutletContext<AppContext>();
  const status = boardStatusSchema.catch('all').parse(search.get('status'));
  const workflowId = search.get('workflow') || undefined;
  const target = parseRequestTarget(search.get('request'));
  const filters = { id, status, workflowId };
  const query = useQuery(
    trpc.boards.get.queryOptions({ ...filters, limit: pageSize }),
  );
  const scroll = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const previous = useRef(Boolean(target));
  const scrollKey = `${id}:${status}:${workflowId ?? ''}`;
  const boardName = query.data?.board.name ?? 'Board';
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
  const change = (key: string, value?: string, replace = false) =>
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace, preventScrollReset: true },
    );

  return (
    <>
      <div
        className={`${workspacePage.page} ${classes.boardPage}`}
        hidden={Boolean(target)}
      >
        <PageHeader
          title={boardName}
          onBack={() => void navigate(paths.boards)}
          backLabel="Back to boards"
          controls={
            <>
              <Select
                aria-label="Workflow"
                w={180}
                allowDeselect={false}
                value={workflowId ?? ''}
                onChange={(value) =>
                  void change('workflow', value || undefined)
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
                  void change(
                    'status',
                    value && value !== 'all' ? value : undefined,
                  )
                }
                data={Object.entries(statusLabels).map(([value, label]) => ({
                  value,
                  label,
                }))}
                renderOption={({ option }) => (
                  <Group justify="space-between" w="100%">
                    <span>{option.label}</span>
                    {option.value === 'attention' && (
                      <Badge color="yellow" variant="light" size="sm">
                        {query.data?.attentionCount ?? 0}
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
        {query.error && (
          <div className={classes.content}>
            <ActionError message={errorMessage(query.error)} />
          </div>
        )}
        {query.isPending && (
          <div className={classes.content}>
            <Loader aria-label="Loading board" />
          </div>
        )}
        {query.data && (
          <>
            {query.data.columns.every((column) => column.total === 0) && (
              <Group className={classes.empty} gap="md">
                <Text size="sm" c="dimmed">
                  {status === 'all' && !workflowId
                    ? 'No runs on this board.'
                    : 'No runs match these filters.'}
                </Text>
                {status !== 'all' && (
                  <Button variant="ghost" onClick={() => void change('status')}>
                    Clear status filter
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
          onBack={() => void change('request', undefined, true)}
          onSelect={(next) =>
            void change('request', JSON.stringify(next), true)
          }
        />
      )}
    </>
  );
}

function StageColumn({
  column,
  filters,
  search,
  rememberOpener,
}: {
  column: ColumnData;
  filters: { id: string; status: BoardStatus; workflowId?: string };
  search: URLSearchParams;
  rememberOpener: (element: HTMLAnchorElement) => void;
}) {
  const [pages, setPages] = useState(1);
  const visiblePages = Math.min(pages, Math.ceil(column.total / pageSize));
  const card = (item: Card) => (
    <BoardCard
      key={item.id}
      card={item}
      search={search}
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
        {column.cards.map(card)}
        {Array.from({ length: Math.max(0, visiblePages - 1) }, (_, page) => (
          <MoreCards
            key={page}
            filters={filters}
            column={column.id}
            offset={(page + 1) * pageSize}
            card={card}
          />
        ))}
        {pages * pageSize < column.total && (
          <Button
            variant="ghost"
            onClick={() => setPages((count) => count + 1)}
          >
            Load more in {column.name}
          </Button>
        )}
      </Stack>
    </section>
  );
}
function MoreCards({
  filters,
  column,
  offset,
  card,
}: {
  filters: { id: string; status: BoardStatus; workflowId?: string };
  column: string;
  offset: number;
  card: (item: Card) => React.ReactNode;
}) {
  const query = useQuery(
    trpc.boards.get.queryOptions({
      ...filters,
      column,
      offset,
      limit: pageSize,
    }),
  );
  if (query.error) return <ActionError message={errorMessage(query.error)} />;
  if (!query.data) return <Loader size="xs" aria-label="Loading more cards" />;
  return query.data.columns.find((item) => item.id === column)?.cards.map(card);
}

function BoardCard({
  card,
  search,
  rememberOpener,
}: {
  card: Card;
  search: URLSearchParams;
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
  const state = { returnLabel: 'Back to board' };
  const runLink = paths.run(card.runId);
  const requestSearch = card.request ? new URLSearchParams(search) : undefined;
  requestSearch?.set('request', JSON.stringify(card.request));
  return (
    <article className={classes.card}>
      <h3>{title}</h3>
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
        <Anchor
          className={classes.cardAction}
          component={Link}
          to={requestSearch ? { search: `?${requestSearch}` } : runLink}
          state={requestSearch ? undefined : state}
          preventScrollReset={Boolean(requestSearch)}
          onClick={
            requestSearch
              ? (event) => rememberOpener(event.currentTarget)
              : undefined
          }
          size="sm"
          underline="hover"
        >
          {requestSearch
            ? 'Review request'
            : card.status === 'failed'
              ? 'Inspect failure'
              : 'Open run'}
          <ArrowUpRight size={14} aria-hidden="true" />
        </Anchor>
        {card.request && card.status === 'failed' && (
          <Anchor component={Link} to={runLink} state={state} size="sm">
            Inspect failure
            <ArrowUpRight size={14} aria-hidden="true" />
          </Anchor>
        )}
        <ExternalTaskLink task={card.externalTask} withArrow />
      </Group>
    </article>
  );
}
