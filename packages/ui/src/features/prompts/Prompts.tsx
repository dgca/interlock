import {
  ActionIcon,
  Button,
  Menu,
  Stack,
  Text,
  TextInput,
  Textarea,
  Modal,
  ModalBody,
  ModalFooter,
  EmptyState,
  ActionError,
  PageHeader,
  workspacePage,
} from '../../design-system';

import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  ArrowRight,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import type { PromptContent, PromptUsage, SavedPrompt } from '@interlock/core';

import type { Action } from '../../lib/useActionFeedback';
import { useBeforeUnloadWarning } from '../../lib/useBeforeUnloadWarning';
import { api, errorMessage } from '../../lib/api';
import { paths } from '../../routes/paths';
import layout from '../../components/PageLayout/PageLayout.module.css';

import { ListTable, ListTableRow } from '../../components/ListTable/ListTable';

import { promptColumns } from './PromptSkeleton';
import styles from './Prompts.module.css';

const fields = ({
  name,
  description,
  content,
}: PromptContent): PromptContent => ({ name, description, content });
const same = (a: PromptContent, b: PromptContent) =>
  JSON.stringify(fields(a)) === JSON.stringify(fields(b));

function PromptFields({
  value,
  onChange,
  editing = false,
}: {
  value: PromptContent;
  onChange: (value: PromptContent) => void;
  editing?: boolean;
}) {
  return (
    <Stack gap="md">
      <TextInput
        label="Name"
        required
        maxLength={120}
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <Textarea
        label="Description"
        rows={2}
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
      />
      <Textarea
        label="Instructions"
        description={
          editing
            ? 'Markdown instructions for future runs. Publish-pinned workflows keep their pinned revisions; active runs keep their captured instructions.'
            : "Markdown instructions added before the Agent node's task instructions."
        }
        required
        autosize
        minRows={editing ? 12 : 8}
        maxRows={40}
        value={value.content}
        onChange={(e) => onChange({ ...value, content: e.target.value })}
        styles={{ input: { fontFamily: 'var(--mono)', lineHeight: 1.6 } }}
      />
    </Stack>
  );
}

export function PromptLibrary({
  prompts,
  act,
}: {
  prompts: SavedPrompt[];
  act: Action;
}) {
  const navigate = useNavigate();
  const createFormId = useId();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<PromptContent>();
  const [busy, setBusy] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const openCreate = () => {
    setError('');
    setDraft({ name: '', description: '', content: '' });
  };
  const visible = prompts
    .filter((p) =>
      `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title="Prompts"
        subtitle={
          <>
            {query ? `${visible.length} of ${prompts.length}` : prompts.length}{' '}
            {prompts.length === 1 ? 'prompt' : 'prompts'}
          </>
        }
        controls={
          <TextInput
            className={workspacePage.search}
            ref={searchInput}
            aria-label="Search prompts"
            placeholder="Search prompts"
            leftSection={<Search size={15} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus size={14} /> New prompt
          </Button>
        }
      />
      <div className={workspacePage.content}>
        {visible.length ? (
          <ListTable columns={promptColumns}>
            {visible.map((p) => (
              <ListTableRow
                key={p.id}
                to={paths.prompt(p.id)}
                className={styles.listRow}
              >
                <span className={styles.identity}>
                  <strong>{p.name}</strong>
                  {p.description && <small>{p.description}</small>}
                </span>
                <span className={styles.revision}>Revision {p.revision}</span>
                <time className={styles.updated} dateTime={p.updatedAt}>
                  {new Date(p.updatedAt).toLocaleDateString()}
                </time>
                <ArrowRight size={16} aria-hidden="true" />
              </ListTableRow>
            ))}
          </ListTable>
        ) : (
          <EmptyState title={query ? 'No matching prompts' : 'No prompts yet'}>
            <Button
              variant="secondary"
              onClick={
                query
                  ? () => {
                      setQuery('');
                      searchInput.current?.focus();
                    }
                  : openCreate
              }
            >
              {query ? 'Clear search' : 'Create a prompt'}
            </Button>
          </EmptyState>
        )}
      </div>
      {draft && (
        <Modal
          onClose={() => !busy && setDraft(undefined)}
          title="New prompt"
          size={650}
          busy={busy}
        >
          <ModalBody>
            <form
              id={createFormId}
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  setBusy(true);
                  setError('');
                  let id: string | undefined;
                  await act(
                    async () => {
                      id = (await api.prompts.create.mutate(draft)).id;
                    },
                    'Prompt created.',
                    setError,
                  );
                  setBusy(false);
                  if (id) {
                    setDraft(undefined);
                    void navigate(paths.prompt(id));
                  }
                })();
              }}
            >
              <fieldset disabled={busy} className={styles.fields}>
                <PromptFields value={draft} onChange={setDraft} />
              </fieldset>
              <ActionError message={error} />
            </form>
          </ModalBody>
          <ModalFooter>
            <Button disabled={busy} onClick={() => setDraft(undefined)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={createFormId}
              variant="primary"
              disabled={busy || !draft.name.trim() || !draft.content.trim()}
            >
              {busy ? 'Creating…' : 'Create prompt'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}

export function PromptEditor({
  prompt,
  act,
  onDirty,
  tick,
}: {
  prompt: SavedPrompt;
  act: Action;
  onDirty: (dirty: boolean) => void;
  tick: number;
}) {
  const navigate = useNavigate();
  const [baseline, setBaseline] = useState(prompt);
  const [draft, setDraft] = useState(() => fields(prompt));
  const [usage, setUsage] = useState<PromptUsage[]>([]);
  const [usageError, setUsageError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [saveError, setSaveError] = useState('');
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const formId = useId();
  const dirty = !same(draft, baseline);
  useBeforeUnloadWarning(dirty);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!dirty && prompt.revision > baseline.revision) {
      setBaseline(prompt);
      setDraft(fields(prompt));
    }
  }, [prompt, baseline.revision, dirty]);
  useEffect(() => {
    let active = true;
    void api.prompts.get
      .query({ id: prompt.id })
      .then((p) => {
        if (active) {
          setUsage(p.usage);
          setUsageError('');
        }
      })
      .catch((e) => {
        if (active) setUsageError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [prompt.id, tick]);
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title={baseline.name}
        onBack={() => void navigate(paths.prompts)}
        backLabel="Back to prompts"
        busy={busy}
        status={
          <>
            {dirty ? 'Unsaved changes' : 'Saved'} · Revision {baseline.revision}
          </>
        }
        actions={
          <>
            <Button
              disabled={busy || !dirty}
              onClick={() => {
                const latest =
                  prompt.revision > baseline.revision ? prompt : baseline;
                setSaveError('');
                setBaseline(latest);
                setDraft(fields(latest));
              }}
            >
              Discard changes
            </Button>
            <Menu position="bottom-end" width={180}>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  ref={actionsTrigger}
                  aria-label="Prompt actions"
                  disabled={busy}
                >
                  <MoreHorizontal size={19} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  color="red"
                  leftSection={<Trash2 size={14} />}
                  disabled={dirty}
                  onClick={() => {
                    setDeleteError('');
                    setDeleting(true);
                  }}
                >
                  Delete prompt
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Button
              form={formId}
              type="submit"
              variant="primary"
              disabled={
                busy || !dirty || !draft.name.trim() || !draft.content.trim()
              }
            >
              <Save />
              {busy && !deleting ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />
      <div className={workspacePage.content}>
        <div className={workspacePage.formContent}>
          {dirty && prompt.revision > baseline.revision && (
            <Text role="alert" c="yellow" mb="md">
              This prompt changed elsewhere. Your edits are preserved. Discard
              changes to load the latest revision before editing again.
            </Text>
          )}
          <form
            id={formId}
            className={workspacePage.card}
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setBusy(true);
                setSaveError('');
                await act(
                  async () => {
                    const saved = await api.prompts.update.mutate({
                      id: prompt.id,
                      revision: baseline.revision,
                      ...draft,
                    });
                    setBaseline(saved);
                    setDraft(fields(saved));
                  },
                  'Prompt saved.',
                  setSaveError,
                );
                setBusy(false);
              })();
            }}
          >
            <ActionError message={saveError} />
            <fieldset disabled={busy} className={styles.fields}>
              <PromptFields value={draft} onChange={setDraft} editing />
            </fieldset>
            <section
              className={workspacePage.section}
              aria-labelledby={`${formId}-usage`}
            >
              <h2 id={`${formId}-usage`}>
                Used by{' '}
                {!usageError && (
                  <span className={layout.referenceCount}>{usage.length}</span>
                )}
              </h2>
              {usageError ? (
                <Text role="alert" c="red" size="sm">
                  {usageError}
                </Text>
              ) : !usage.length ? (
                <Text size="sm" c="dimmed">
                  No workflows use this prompt yet.
                </Text>
              ) : (
                <ul className={layout.referenceList}>
                  {usage.map((w) => (
                    <li key={w.workflowId}>
                      <Link
                        to={paths.workflow(w.workflowId)}
                        className={layout.workflowReference}
                      >
                        <span className={layout.referenceName}>
                          <strong>{w.name}</strong>
                          <Text component="span" size="xs" c="dimmed">
                            {[
                              w.draft ? 'Draft' : '',
                              ...w.versions.map((v) => `v${v} published`),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </span>
                        <ArrowRight size={16} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </form>
        </div>
      </div>
      {deleting && (
        <Modal
          busy={busy}
          onClose={() => !busy && setDeleting(false)}
          title={`Delete ${baseline.name}?`}
          returnFocusTo={() => actionsTrigger.current}
        >
          <ModalBody>
            <p>
              Prompts used by draft or published workflows cannot be deleted.
              Past runs keep their captured instructions.
            </p>
            {!!usage.length && (
              <Text mt="md" size="sm">
                Referenced by {usage.map((w) => w.name).join(', ')}.
              </Text>
            )}
            {deleteError && (
              <Text role="alert" c="red" mt="md">
                {deleteError}
              </Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button disabled={busy} onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  let deleted = false;
                  await act(
                    async () => {
                      await api.prompts.delete.mutate({ id: prompt.id });
                      deleted = true;
                    },
                    'Prompt deleted.',
                    setDeleteError,
                  );
                  setBusy(false);
                  if (deleted) void navigate(paths.prompts);
                })();
              }}
            >
              Delete
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}
