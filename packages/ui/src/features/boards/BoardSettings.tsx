import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';
import { TRPCClientError } from '@interlock/client';
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
import { WorkspaceReadWarning } from '../../components/WorkspaceReads';
import { api, errorMessage } from '../../lib/api';
import {
  refreshQueries,
  trpc,
  useQuery,
  useQueryClient,
} from '../../lib/query';
import { useEditorDraft } from '../../lib/useEditorDraft';
import { useDraftDismissal } from '../../lib/useDraftDismissal';
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
  const formId = useId();
  const [baseline, setBaseline] = useState(initial);
  const [name, setName] = useState(baseline?.name ?? '');
  const [columns, setColumns] = useState(() => draftColumns(baseline));
  const [selected, setSelected] = useState(baseline?.workflowIds ?? []);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [unconfirmedCreation, setUnconfirmedCreation] = useState(false);
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
  const { workflows, workflowsRead } = useOutletContext<AppContext>();
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
  const canSave =
    !busy &&
    dirty &&
    !conflict &&
    !unconfirmedCreation &&
    name.trim() &&
    (moves.length === 0 || boards.data);
  const goBack = () => void navigate(returnTo);
  const applySettings = (settings: Settings) => {
    setName(settings.name);
    setColumns(draftColumns(settings));
    setSelected(settings.workflowIds);
    setError('');
  };

  const loadLatest = async () => {
    if (!baseline || latestRequest.current) return;
    const request = new AbortController();
    latestRequest.current = request;
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
      applySettings(latest);
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
  const recovery = useDraftDismissal(dirty, busy, () => void loadLatest());
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
        subtitle={baseline?.name}
        status={
          dirty
            ? 'Unsaved changes'
            : baseline
              ? `Saved · Revision ${baseline.revision}`
              : undefined
        }
        onBack={goBack}
        backLabel={baseline ? 'Back to board' : 'Back to boards'}
        busy={busy}
        actions={
          <>
            <Button
              disabled={busy || Boolean(baseline && !dirty && !conflict)}
              loading={loadingLatest}
              onClick={() => {
                if (conflict) recovery.dismiss();
                else if (baseline) applySettings(baseline);
                else goBack();
              }}
            >
              {conflict
                ? 'Load latest'
                : baseline
                  ? 'Discard changes'
                  : 'Cancel'}
            </Button>
            <Button
              variant="primary"
              form={formId}
              type="submit"
              loading={saving}
              disabled={!canSave}
            >
              {baseline ? 'Save changes' : 'Create board'}
            </Button>
          </>
        }
      />
      <div className={classes.content}>
        <form
          id={formId}
          className={`${workspacePage.card} ${classes.form}`}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canSave || latestRequest.current || !beginSave()) return;
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
              if (finishSave(true))
                void navigate(paths.board(board.id), {
                  replace: !baseline,
                  state: {
                    savedBoard: {
                      id: board.id,
                      name: board.name,
                      revision: board.revision,
                    },
                  },
                });
            } catch (error) {
              if (!finishSave(false)) return;
              if (
                !baseline &&
                !(
                  error instanceof TRPCClientError &&
                  error.data?.code === 'BAD_REQUEST'
                )
              ) {
                setUnconfirmedCreation(true);
                setError(
                  'Interlock could not confirm whether the board was created. Check Boards before creating it again.',
                );
              } else {
                setError(errorMessage(error));
              }
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
            {conflict && <ActionError message={loadError} />}
            {unconfirmedCreation && (
              <Button
                component={Link}
                to={paths.boards}
                target="_blank"
                rel="noreferrer"
                variant="secondary"
              >
                Check Boards in a new tab
              </Button>
            )}
          </Stack>
        </form>
      </div>
      {recovery.confirmation}
    </div>
  );
}
