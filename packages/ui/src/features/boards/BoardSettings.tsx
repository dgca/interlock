import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { boardSettingsRevisionConflict } from '@interlock/core';
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
import { DiscardChangesDialog } from '../../components/DiscardChangesDialog';
import { WorkspaceReadWarning } from '../../components/WorkspaceReads';
import { api, errorMessage } from '../../lib/api';
import {
  refreshQueries,
  trpc,
  useQuery,
  useQueryClient,
} from '../../lib/query';
import { useEditorDraft } from '../../lib/useEditorDraft';
import { paths } from '../../routes/paths';
import classes from './Boards.module.css';

type Settings = Awaited<ReturnType<typeof api.boards.settings.query>>;
type Column = { id?: string; name: string; key: string };

const draftColumns = (settings?: Settings): Column[] =>
  settings?.columns.map((column) => ({ ...column, key: column.id })) ?? [];

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
  const [baseline, setBaseline] = useState(initial);
  const [name, setName] = useState(baseline?.name ?? '');
  const [columns, setColumns] = useState(() => draftColumns(baseline));
  const [selected, setSelected] = useState(baseline?.workflowIds ?? []);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const latestRequest = useRef<AbortController>(null);
  useEffect(() => () => latestRequest.current?.abort(), []);

  const conflict = Boolean(baseline && error === boardSettingsRevisionConflict);
  const originalColumns = baseline?.columns ?? [];
  const originalWorkflows = new Set(baseline?.workflowIds);
  const dirty =
    name !== (baseline?.name ?? '') ||
    columns.length !== originalColumns.length ||
    columns.some(
      (column, index) =>
        column.id !== originalColumns[index].id ||
        column.name !== originalColumns[index].name,
    ) ||
    selected.length !== originalWorkflows.size ||
    selected.some((id) => !originalWorkflows.has(id));
  const { busy: saving, beginSave, finishSave } = useEditorDraft(dirty);
  const busy = saving || loadingLatest;
  const { workflows, workflowsRead, editorNavigationBlocked } =
    useOutletContext<AppContext>();
  const boards = useQuery(trpc.boards.list.queryOptions());
  const client = useQueryClient();
  const navigate = useNavigate();
  const returnTo = baseline ? paths.board(baseline.id) : paths.boards;
  const selectedWorkflows = workflows.filter((workflow) =>
    selected.includes(workflow.id),
  );
  const moves = selectedWorkflows.filter(
    (workflow) =>
      !originalWorkflows.has(workflow.id) &&
      workflow.boardId &&
      workflow.boardId !== baseline?.id,
  );
  const protectedColumnIds =
    initial && (!baseline || initial.revision >= baseline.revision)
      ? initial.protectedColumnIds
      : baseline?.protectedColumnIds;

  const loadLatest = async () => {
    if (!baseline || latestRequest.current) return;
    const request = new AbortController();
    latestRequest.current = request;
    setConfirmLoad(false);
    setLoadingLatest(true);
    setLoadError('');
    try {
      const input = { id: baseline.id };
      // This decision needs its own read, even if the background query is in flight.
      const latest = await api.boards.settings.query(input, {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      const key = trpc.boards.settings.queryKey(input);
      const cached = client.getQueryData<Settings>(key);
      if (
        latest.revision <= baseline.revision ||
        (cached && latest.revision < cached.revision)
      ) {
        setLoadError('Could not read the latest board settings. Try again.');
        return;
      }
      void client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData(key, latest);
      setBaseline(latest);
      setName(latest.name);
      setColumns(draftColumns(latest));
      setSelected(latest.workflowIds);
      setError('');
    } catch (error) {
      if (!request.signal.aborted)
        setLoadError(`Could not load board settings. ${errorMessage(error)}`);
    } finally {
      if (!request.signal.aborted) {
        latestRequest.current = null;
        setLoadingLatest(false);
      }
    }
  };
  const move = (index: number, offset: number) =>
    setColumns((current) => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  return (
    <div className={workspacePage.page}>
      <PageHeader
        title={baseline ? 'Board settings' : 'New board'}
        subtitle={initial?.name}
      />
      <div className={classes.content}>
        <form
          className={classes.form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (conflict || latestRequest.current || !beginSave()) return;
            setError('');
            const expectedBoards = new Map(
              selectedWorkflows.map((workflow) => [
                workflow.id,
                workflow.boardId ?? null,
              ]),
            );
            if (baseline) {
              // Settings owns this board's membership even if the workflow list lags.
              for (const id of selected)
                if (originalWorkflows.has(id))
                  expectedBoards.set(id, baseline.id);
            }
            try {
              const board = await api.boards.save.mutate({
                id: baseline?.id,
                expectedRevision: baseline?.revision,
                name,
                columns: columns.map(({ id, name }) => ({ id, name })),
                workflowIds: selected,
                expectedBoards: Object.fromEntries(expectedBoards),
              });
              // The write omits protected columns. Reopen from a fresh settings read.
              client.removeQueries({
                ...trpc.boards.settings.queryFilter({ id: board.id }),
                exact: true,
              });
              void refreshQueries(client);
              if (finishSave(true)) void navigate(paths.board(board.id));
            } catch (error) {
              if (finishSave(false)) setError(errorMessage(error));
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
                  column.id && protectedColumnIds?.includes(column.id);
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
              <WorkspaceReadWarning reads={[workflowsRead]} inline />
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
            <ActionError
              message={
                conflict
                  ? 'Board settings changed elsewhere. Your edits are still here.'
                  : error
              }
            />
            {conflict && (
              <div>
                <ActionError message={loadError} />
                <Button
                  variant="secondary"
                  loading={loadingLatest}
                  onClick={() => {
                    if (dirty) setConfirmLoad(true);
                    else void loadLatest();
                  }}
                >
                  Load latest
                </Button>
              </div>
            )}
            <Group justify="flex-end">
              <Button disabled={busy} onClick={() => void navigate(returnTo)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={saving}
                disabled={
                  loadingLatest ||
                  conflict ||
                  !name.trim() ||
                  (moves.length > 0 && !boards.data)
                }
              >
                {baseline ? 'Save changes' : 'Create board'}
              </Button>
            </Group>
          </Stack>
        </form>
      </div>
      {confirmLoad && !editorNavigationBlocked && (
        <DiscardChangesDialog
          onKeepEditing={() => setConfirmLoad(false)}
          onDiscard={() => void loadLatest()}
        />
      )}
    </div>
  );
}
