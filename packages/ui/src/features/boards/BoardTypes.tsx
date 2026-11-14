import { useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { LayoutTemplate, Plus } from 'lucide-react';
import {
  boardTypeContentSchema,
  boardTypePresets,
  type BoardTypeContent,
} from '@interlock/core';
import {
  ActionError,
  Anchor,
  Button,
  EmptyState,
  Loader,
  PageHeader,
  Select,
  Stack,
  Text,
  TextInput,
  workspacePage,
} from '../../design-system';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import { api, errorMessage } from '../../lib/api';
import {
  refreshQueries,
  trpc,
  useQuery,
  useQueryClient,
} from '../../lib/query';
import { useEditorDraft } from '../../lib/useEditorDraft';
import { paths } from '../../routes/paths';
import { BoardRowsSkeleton } from './BoardSkeleton';
import { FieldsEditor, LanesEditor } from './BoardTypeFields';
import classes from './Boards.module.css';

export function BoardTypeLibrary() {
  const navigate = useNavigate();
  const types = useQuery(trpc.boardTypes.list.queryOptions());
  const read = workspaceRead('board types', types);
  return (
    <div className={workspacePage.page}>
      <PageHeader
        title="Board types"
        onBack={() => void navigate(paths.boards)}
        backLabel="Back to boards"
        actions={
          <Button component={Link} to={paths.boardTypeNew} variant="primary">
            <Plus size={16} /> New board type
          </Button>
        }
      />
      <div className={workspacePage.content}>
        <WorkspaceReadWarning reads={[read]} inline showDetails />
        {!read.ready && !read.error && <BoardRowsSkeleton />}
        {types.data?.length === 0 && (
          <EmptyState title="No board types yet">
            <Text size="sm" c="dimmed">
              A board type sets the lanes, the rules that place cards, and the
              card fields that boards built from it share.
            </Text>
            <Button
              component={Link}
              to={paths.boardTypeNew}
              variant="secondary"
            >
              Create a board type
            </Button>
          </EmptyState>
        )}
        {!!types.data?.length && (
          <ul className={classes.library} role="list">
            {types.data.map((type) => (
              <li className={classes.libraryRow} key={type.id}>
                <div className={classes.libraryIcon} aria-hidden="true">
                  <LayoutTemplate size={18} />
                </div>
                <div className={classes.libraryDetails}>
                  <h2>
                    <Anchor
                      component={Link}
                      to={paths.boardType(type.id)}
                      underline="hover"
                    >
                      {type.name}
                    </Anchor>
                  </h2>
                  <Text size="sm" c="dimmed">
                    {type.lanes.map((lane) => lane.name).join(' → ')}
                  </Text>
                </div>
                <Text size="sm" c="dimmed">
                  {type.boardCount === 0
                    ? 'Not used'
                    : `${type.boardCount} ${type.boardCount === 1 ? 'board' : 'boards'}`}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function BoardTypeRoute() {
  const { typeId } = useParams();
  const query = useQuery(
    trpc.boardTypes.get.queryOptions(
      { id: typeId ?? '' },
      { enabled: Boolean(typeId) },
    ),
  );
  if (!typeId || query.data)
    return <BoardTypeEditor key={typeId ?? 'new'} initial={query.data} />;
  return (
    <div className={workspacePage.page}>
      <PageHeader title="Board type" />
      <div className={classes.content}>
        {query.error ? (
          <ActionError message={errorMessage(query.error)} />
        ) : (
          <Loader aria-label="Loading board type" />
        )}
      </div>
    </div>
  );
}

type Saved = Awaited<ReturnType<typeof api.boardTypes.get.query>>;
const presets = {
  coding: 'Coding',
  design: 'Design',
  research: 'Research',
} as const;
const blank: BoardTypeContent = {
  name: '',
  lanes: [{ id: 'in-progress', name: 'In progress' }],
  fields: [],
  actions: ['open', 'answer', 'cancel', 'backlog', 'release'],
};
const content = ({ name, lanes, fields, actions }: BoardTypeContent) => ({
  name,
  lanes,
  fields,
  actions,
});

function BoardTypeEditor({ initial }: { initial?: Saved }) {
  const formId = useId();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState<BoardTypeContent>(() =>
    content(initial ?? { ...boardTypePresets.coding }),
  );
  const [preset, setPreset] = useState<string>('coding');
  const [error, setError] = useState('');
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify(content(baseline ?? { ...boardTypePresets.coding }));
  const { busy, beginSave, finishSave } = useEditorDraft(dirty);
  const parsed = boardTypeContentSchema.safeParse(draft);
  const problem = parsed.success ? '' : parsed.error.issues[0]?.message;
  const update = (patch: Partial<BoardTypeContent>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const save = async () => {
    if (!parsed.success || !beginSave()) return;
    setError('');
    try {
      const saved = await api.boardTypes.save.mutate({
        id: baseline?.id,
        expectedRevision: baseline?.revision,
        type: parsed.data,
      });
      void refreshQueries(client);
      if (finishSave(true)) {
        setBaseline(saved);
        setDraft(content(saved));
        if (!baseline)
          void navigate(paths.boardType(saved.id), { replace: true });
      }
    } catch (failure) {
      if (finishSave(false)) setError(errorMessage(failure));
    }
  };
  const remove = async () => {
    if (!baseline || !beginSave()) return;
    try {
      await api.boardTypes.delete.mutate({ id: baseline.id });
      void refreshQueries(client);
      if (finishSave(true)) void navigate(paths.boardTypes, { replace: true });
    } catch (failure) {
      if (finishSave(false)) setError(errorMessage(failure));
    }
  };
  return (
    <div className={workspacePage.page}>
      <PageHeader
        title={baseline ? 'Board type' : 'New board type'}
        subtitle={baseline?.name}
        status={
          dirty
            ? 'Unsaved changes'
            : baseline
              ? `Saved · Revision ${baseline.revision}`
              : undefined
        }
        onBack={() => void navigate(paths.boardTypes)}
        backLabel="Back to board types"
        busy={busy}
        actions={
          <>
            {baseline && (
              <Button disabled={busy} onClick={() => void remove()}>
                Delete
              </Button>
            )}
            <Button
              disabled={busy || (Boolean(baseline) && !dirty)}
              onClick={() =>
                baseline
                  ? setDraft(content(baseline))
                  : void navigate(paths.boardTypes)
              }
            >
              {baseline ? 'Discard changes' : 'Cancel'}
            </Button>
            <Button
              variant="primary"
              form={formId}
              type="submit"
              loading={busy}
              disabled={
                busy || (Boolean(baseline) && !dirty) || !parsed.success
              }
            >
              {baseline ? 'Save changes' : 'Create board type'}
            </Button>
          </>
        }
      />
      <div className={classes.content}>
        <form
          id={formId}
          className={`${workspacePage.card} ${classes.form}`}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Stack gap="lg">
            {!baseline && (
              <Select
                label="Start from"
                allowDeselect={false}
                value={preset}
                disabled={busy}
                onChange={(value) => {
                  if (!value) return;
                  setPreset(value);
                  setDraft(
                    content(
                      value === 'blank'
                        ? blank
                        : boardTypePresets[value as keyof typeof presets],
                    ),
                  );
                }}
                data={[
                  ...Object.entries(presets).map(([value, label]) => ({
                    value,
                    label,
                  })),
                  { value: 'blank', label: 'Blank' },
                ]}
              />
            )}
            <TextInput
              label="Name"
              required
              maxLength={80}
              value={draft.name}
              disabled={busy}
              onChange={(event) => update({ name: event.currentTarget.value })}
            />
            <LanesEditor
              lanes={draft.lanes}
              disabled={busy}
              onChange={(lanes) => update({ lanes })}
            />
            <FieldsEditor
              fields={draft.fields}
              disabled={busy}
              onChange={(fields) => update({ fields })}
            />
            <ActionError message={error || (dirty ? problem : '')} />
          </Stack>
        </form>
      </div>
    </div>
  );
}
