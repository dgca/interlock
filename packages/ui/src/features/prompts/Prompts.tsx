import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ActionIcon,
  Group,
  Menu,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  GitBranch,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import type { PromptContent, PromptUsage, SavedPrompt } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import type { Action } from '../../lib/useActionFeedback';
import { useBeforeUnloadWarning } from '../../lib/useBeforeUnloadWarning';
import { api, errorMessage } from '../../lib/api';
import { paths } from '../../routes/paths';
import layout from '../../components/PageLayout/PageLayout.module.css';
import styles from './Prompts.module.css';
import cards from '../workflows/WorkflowLibrary.module.css';
import editorLayout from '../workflows/WorkflowEditor.module.css';

const fields = ({
  name,
  description,
  content,
}: PromptContent): PromptContent => ({ name, description, content });
const same = (a: PromptContent, b: PromptContent) =>
  JSON.stringify(fields(a)) === JSON.stringify(fields(b));

function PromptMetadata({
  value,
  onChange,
}: {
  value: PromptContent;
  onChange: (value: PromptContent) => void;
}) {
  return (
    <Stack>
      <TextInput
        label="Name"
        required
        maxLength={120}
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
      />
      <Textarea
        label="Description"
        rows={3}
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
      />
    </Stack>
  );
}

function InstructionsField({
  value,
  onChange,
  editing = false,
}: {
  value: PromptContent;
  onChange: (value: PromptContent) => void;
  editing?: boolean;
}) {
  return (
    <Textarea
      label="Instructions"
      description={
        editing
          ? 'Markdown instructions for future runs, including published workflows. Active runs keep their captured instructions.'
          : "Markdown instructions added before the Agent node's task instructions."
      }
      required
      autosize
      minRows={editing ? 20 : 10}
      maxRows={40}
      value={value.content}
      onChange={(e) => onChange({ ...value, content: e.target.value })}
      styles={{ input: { fontFamily: 'var(--mono)', lineHeight: 1.6 } }}
    />
  );
}

function PromptFields({
  value,
  onChange,
}: {
  value: PromptContent;
  onChange: (value: PromptContent) => void;
}) {
  return (
    <Stack>
      <PromptMetadata value={value} onChange={onChange} />
      <InstructionsField value={value} onChange={onChange} />
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
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<PromptContent>();
  const [busy, setBusy] = useState(false);
  const openCreate = () => setDraft({ name: '', description: '', content: '' });
  const visible = prompts
    .filter((p) =>
      `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <h1>Prompts</h1>
        <Button variant="primary" onClick={openCreate}>
          <Plus size={16} />
          New prompt
        </Button>
      </header>
      <div className={styles.toolbar}>
        <span>
          {query ? `${visible.length} of ${prompts.length}` : prompts.length}{' '}
          {prompts.length === 1 ? 'prompt' : 'prompts'}
        </span>
        <TextInput
          size="xs"
          className={styles.search}
          aria-label="Search prompts"
          placeholder="Search prompts..."
          leftSection={<Search size={15} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className={cards.grid}>
        {visible.map((p) => (
          <article key={p.id} className={`${cards.card} ${styles.promptCard}`}>
            <div className={cards.cardTop}>
              <span className={cards.cardIcon}>
                <FileText size={19} />
              </span>
            </div>
            <div className={cards.cardBody}>
              <h2>
                <Link to={paths.prompt(p.id)} className={cards.cardLink}>
                  {p.name}
                </Link>
              </h2>
              <p className={styles.cardDescription}>{p.description}</p>
            </div>
            <div className={cards.cardFooter}>
              <span>Revision {p.revision}</span>
              <span className={cards.cardArrow} aria-hidden="true">
                <ArrowRight size={15} />
              </span>
            </div>
          </article>
        ))}
        {!query && (
          <button className={cards.newCard} onClick={openCreate}>
            <span>
              <Plus size={23} />
            </span>
            Create a prompt<small>Reusable instructions for Agent nodes</small>
          </button>
        )}
      </div>
      {query && !visible.length && (
        <div className={styles.empty}>
          <FileText size={24} />
          <h2>No matching prompts</h2>
          <p>Try another name or description.</p>
          <Button onClick={() => setQuery('')}>Clear search</Button>
        </div>
      )}
      {draft && (
        <Modal
          onClose={() => !busy && setDraft(undefined)}
          title="New prompt"
          size={650}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setBusy(true);
                let id: string | undefined;
                await act(async () => {
                  id = (await api.prompts.create.mutate(draft)).id;
                }, 'Prompt created.');
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
            <Group justify="flex-end" mt="lg">
              <Button disabled={busy} onClick={() => setDraft(undefined)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !draft.name.trim() || !draft.content.trim()}
              >
                Create prompt
              </Button>
            </Group>
          </form>
        </Modal>
      )}
    </div>
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
    <section className={editorLayout.editor}>
      <header className={`${editorLayout.header} ${styles.detailHeader}`}>
        <Button
          variant="ghost"
          aria-label="Back to prompts"
          disabled={busy}
          onClick={() => void navigate(paths.prompts)}
        >
          <ArrowLeft />
        </Button>
        <div className={`${editorLayout.title} ${styles.detailTitle}`}>
          <span>PROMPT</span>
          <strong>{baseline.name}</strong>
        </div>
        <span className={editorLayout.saved}>
          {dirty ? 'Unsaved changes' : 'Saved'} · Revision {baseline.revision}
        </span>
        <div className="actions">
          <Button
            disabled={busy || !dirty}
            onClick={() => {
              const latest =
                prompt.revision > baseline.revision ? prompt : baseline;
              setBaseline(latest);
              setDraft(fields(latest));
            }}
          >
            Discard changes
          </Button>
          <Button
            form={formId}
            type="submit"
            disabled={
              busy || !dirty || !draft.name.trim() || !draft.content.trim()
            }
          >
            <Save />
            Save
          </Button>
          <Menu position="bottom-end" width={180}>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
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
        </div>
      </header>
      <div className={styles.editorBody}>
        <div className={styles.editorContent}>
          {dirty && prompt.revision > baseline.revision && (
            <Text role="alert" c="yellow" mb="md">
              This prompt changed elsewhere. Your edits are preserved. Discard
              changes to load the latest revision before editing again.
            </Text>
          )}
          <form
            id={formId}
            className={styles.editGrid}
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setBusy(true);
                await act(async () => {
                  const saved = await api.prompts.update.mutate({
                    id: prompt.id,
                    revision: baseline.revision,
                    ...draft,
                  });
                  setBaseline(saved);
                  setDraft(fields(saved));
                }, 'Prompt saved.');
                setBusy(false);
              })();
            }}
          >
            <aside className={styles.metadata}>
              <fieldset disabled={busy} className={styles.fields}>
                <PromptMetadata value={draft} onChange={setDraft} />
              </fieldset>
            </aside>
            <fieldset
              disabled={busy}
              className={`${styles.fields} ${styles.instructions}`}
            >
              <InstructionsField value={draft} onChange={setDraft} editing />
            </fieldset>
            <section className={styles.usage}>
              <h2>Used by</h2>
              {usageError ? (
                <Text role="alert" c="red" size="sm">
                  {usageError}
                </Text>
              ) : !usage.length ? (
                <div className={styles.usageEmpty}>
                  <GitBranch size={19} />
                  <p>No workflows use this prompt yet.</p>
                </div>
              ) : (
                usage.map((w) => (
                  <article
                    key={w.workflowId}
                    className={`${cards.card} ${styles.usageCard}`}
                  >
                    <div className={cards.cardTop}>
                      <span className={cards.cardIcon}>
                        <GitBranch size={19} />
                      </span>
                    </div>
                    <div className={cards.cardBody}>
                      <h2>
                        <Link
                          to={paths.workflow(w.workflowId)}
                          className={cards.cardLink}
                        >
                          {w.name}
                        </Link>
                      </h2>
                    </div>
                    <div className={cards.cardFooter}>
                      <span>
                        {[
                          w.draft ? 'Draft' : '',
                          ...w.versions.map((v) => `v${v} published`),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className={cards.cardArrow} aria-hidden="true">
                        <ArrowRight size={15} />
                      </span>
                    </div>
                  </article>
                ))
              )}
            </section>
          </form>
        </div>
      </div>
      {deleting && (
        <Modal
          onClose={() => !busy && setDeleting(false)}
          title={`Delete ${baseline.name}?`}
        >
          <p>
            Prompts used by draft or published workflows cannot be deleted. Past
            runs keep their captured instructions.
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
          <Group justify="flex-end" mt="lg">
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
                  await act(async () => {
                    try {
                      await api.prompts.delete.mutate({ id: prompt.id });
                    } catch (error) {
                      setDeleteError(errorMessage(error));
                      throw error;
                    }
                    deleted = true;
                  }, 'Prompt deleted.');
                  setBusy(false);
                  if (deleted) void navigate(paths.prompts);
                })();
              }}
            >
              Delete
            </Button>
          </Group>
        </Modal>
      )}
    </section>
  );
}
