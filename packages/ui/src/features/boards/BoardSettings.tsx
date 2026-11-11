import { useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import {
  ActionError,
  ActionIcon,
  Button,
  Group,
  Loader,
  MultiSelect,
  PageHeader,
  Stack,
  Text,
  TextInput,
  workspacePage,
} from '../../design-system';
import type { AppContext } from '../../App';
import { api, errorMessage } from '../../lib/api';
import {
  refreshQueries,
  trpc,
  useQuery,
  useQueryClient,
} from '../../lib/query';
import { paths } from '../../routes/paths';
import classes from './Boards.module.css';

type Settings = Awaited<ReturnType<typeof api.boards.settings.query>>;
type Column = { id?: string; name: string; key: string };

export function BoardSettingsRoute() {
  const { boardId } = useParams();
  const query = useQuery(
    trpc.boards.settings.queryOptions(
      { id: boardId ?? '' },
      { enabled: Boolean(boardId) },
    ),
  );
  if (!boardId || query.data)
    return <BoardSettings key={boardId ?? 'new'} initial={query.data} />;
  return (
    <div className={workspacePage.page}>
      <PageHeader title="Board settings" />
      <div className={classes.content}>
        {query.error ? (
          <ActionError message={errorMessage(query.error)} />
        ) : (
          <Loader aria-label="Loading board settings" />
        )}
      </div>
    </div>
  );
}

function BoardSettings({ initial }: { initial?: Settings }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [columns, setColumns] = useState<Column[]>(
    () =>
      initial?.columns.map((column) => ({ ...column, key: column.id })) ?? [],
  );
  const [selected, setSelected] = useState(initial?.workflowIds ?? []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision] = useState(initial?.revision);
  const { workflows } = useOutletContext<AppContext>();
  const boards = useQuery(trpc.boards.list.queryOptions());
  const client = useQueryClient();
  const navigate = useNavigate();
  const returnTo = initial ? paths.board(initial.id) : paths.boards;
  const moves = workflows.filter(
    (workflow) =>
      selected.includes(workflow.id) &&
      workflow.boardId &&
      workflow.boardId !== initial?.id,
  );
  const move = (index: number, offset: number) =>
    setColumns((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  return (
    <div className={workspacePage.page}>
      <PageHeader
        title={initial ? 'Board settings' : 'New board'}
        subtitle={initial?.name}
      />
      <div className={classes.content}>
        <form
          className={classes.form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError('');
            try {
              const board = await api.boards.save.mutate({
                id: initial?.id,
                expectedRevision: revision,
                name,
                columns: columns.map(({ id, name }) => ({ id, name })),
                workflowIds: selected,
                expectedBoards: Object.fromEntries(
                  workflows
                    .filter((workflow) => selected.includes(workflow.id))
                    .map((workflow) => [workflow.id, workflow.boardId ?? null]),
                ),
              });
              await refreshQueries(client);
              void navigate(paths.board(board.id));
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Stack gap="lg">
            <TextInput
              label="Board name"
              required
              maxLength={200}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <Stack gap="xs">
              <h2>Stage columns</h2>
              <Text size="sm" c="dimmed">
                Runs move when they reach a step bound to a column.
              </Text>
              {columns.map((column, index) => {
                const referenced =
                  column.id && initial?.protectedColumnIds.includes(column.id);
                return (
                  <div className={classes.columnEdit} key={column.key}>
                    <TextInput
                      aria-label={`Column ${index + 1} name`}
                      maxLength={200}
                      required
                      value={column.name}
                      disabled={busy}
                      onChange={(event) => {
                        const name = event.currentTarget.value;
                        setColumns((current) =>
                          current.map((item) =>
                            item.key === column.key ? { ...item, name } : item,
                          ),
                        );
                      }}
                    />
                    <Group gap={4}>
                      <ActionIcon
                        variant="subtle"
                        disabled={busy || index === 0}
                        aria-label={`Move ${column.name || 'column'} up`}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp size={15} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        disabled={busy || index === columns.length - 1}
                        aria-label={`Move ${column.name || 'column'} down`}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown size={15} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        disabled={busy || Boolean(referenced)}
                        aria-label={`Remove ${column.name || 'column'}`}
                        title={
                          referenced
                            ? 'Referenced by a workflow or retained run'
                            : undefined
                        }
                        onClick={() =>
                          setColumns((current) =>
                            current.filter((item) => item.key !== column.key),
                          )
                        }
                      >
                        <X size={15} />
                      </ActionIcon>
                    </Group>
                  </div>
                );
              })}
              <Group>
                <Button
                  variant="ghost"
                  disabled={busy || columns.length >= 100}
                  onClick={() =>
                    setColumns((current) => [
                      ...current,
                      { key: crypto.randomUUID(), name: '' },
                    ])
                  }
                >
                  <Plus size={16} /> Add column
                </Button>
              </Group>
            </Stack>
            <Stack gap="xs">
              <MultiSelect
                label="Workflows"
                placeholder="Select workflows"
                searchable
                comboboxProps={{ position: 'top-start' }}
                value={selected}
                disabled={busy}
                onChange={setSelected}
                data={workflows.map((workflow) => ({
                  value: workflow.id,
                  label: workflow.name,
                }))}
              />
              {moves.map((workflow) => {
                const source = boards.data?.find(
                  (board) => board.id === workflow.boardId,
                );
                return (
                  source && (
                    <Text key={workflow.id} size="sm">
                      {workflow.name} will move from {source.name}.
                    </Text>
                  )
                );
              })}
            </Stack>
            <ActionError message={error} />
            <Group justify="flex-end">
              <Button component={Link} to={returnTo}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={
                  busy || !name.trim() || (moves.length > 0 && !boards.data)
                }
              >
                {initial ? 'Save changes' : 'Create board'}
              </Button>
            </Group>
          </Stack>
        </form>
      </div>
    </div>
  );
}
