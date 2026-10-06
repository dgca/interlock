import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Group, Modal, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { Plus, Search } from 'lucide-react';
import type { PromptContent, PromptUsage, SavedPrompt } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import type { Action } from '../../lib/useActionFeedback';
import { useBeforeUnloadWarning } from '../../lib/useBeforeUnloadWarning';
import { api, errorMessage } from '../../lib/api';
import { paths } from '../../routes/paths';
import layout from '../../components/PageLayout/PageLayout.module.css';
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
        rows={2}
        value={value.description}
        onChange={(e) => onChange({ ...value, description: e.target.value })}
      />
      <Textarea
        label="Instructions"
        description="Markdown"
        required
        autosize
        minRows={12}
        maxRows={30}
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
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<PromptContent>();
  const [busy, setBusy] = useState(false);
  const visible = prompts
    .filter((p) =>
      `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <h1>Prompts</h1>
        <Button
          variant="primary"
          onClick={() => setDraft({ name: '', description: '', content: '' })}
        >
          <Plus size={16} />
          New prompt
        </Button>
      </header>
      <TextInput
        mb="lg"
        aria-label="Search prompts"
        placeholder="Search prompts"
        leftSection={<Search size={15} />}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className={styles.list}>
        {visible.map((p) => (
          <Link key={p.id} to={paths.prompt(p.id)} className={styles.row}>
            <div>
              <Text fw={500}>{p.name}</Text>
              {p.description && (
                <Text size="sm" c="dimmed">
                  {p.description}
                </Text>
              )}
            </div>
            <Text size="xs" c="dimmed">
              Revision {p.revision}
            </Text>
          </Link>
        ))}
        {!visible.length && (
          <Text c="dimmed">
            {query
              ? 'No matching prompts.'
              : 'Create a prompt to reuse instructions across Agent nodes.'}
          </Text>
        )}
      </div>
      <Modal
        opened={!!draft}
        onClose={() => !busy && setDraft(undefined)}
        title="New prompt"
        size="lg"
        centered
        closeOnClickOutside={false}
      >
        {draft && (
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
        )}
      </Modal>
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
    <div className={layout.page}>
      <header className={layout.header}>
        <div>
          <Link to={paths.prompts}>Prompts</Link>
          <h1>{baseline.name}</h1>
        </div>
        <Button
          variant="danger"
          disabled={busy || dirty}
          onClick={() => {
            setDeleteError('');
            setDeleting(true);
          }}
        >
          Delete prompt
        </Button>
      </header>
      <div className={styles.editor}>
        <Text size="sm" c="dimmed" mb="lg">
          Changes apply to future runs of every workflow using this prompt.
          Active runs keep their captured instructions.
        </Text>
        {dirty && prompt.revision > baseline.revision && (
          <Text role="alert" c="yellow" mb="md">
            This prompt changed elsewhere. Your edits are preserved. Discard
            changes to load the latest revision before editing again.
          </Text>
        )}
        <form
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
          <fieldset disabled={busy} className={styles.fields}>
            <PromptFields value={draft} onChange={setDraft} />
          </fieldset>
          <Group mt="lg">
            <Button
              type="submit"
              variant="primary"
              disabled={
                busy || !dirty || !draft.name.trim() || !draft.content.trim()
              }
            >
              Save
            </Button>
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
            <Text size="xs" c="dimmed">
              Revision {baseline.revision}
            </Text>
          </Group>
        </form>
        <section className={styles.usage}>
          <h2>Used by</h2>
          {usageError ? (
            <Text role="alert" c="red">
              {usageError}
            </Text>
          ) : !usage.length ? (
            <Text c="dimmed" size="sm">
              No workflow references.
            </Text>
          ) : (
            usage.map((w) => (
              <div key={w.workflowId} className={styles.row}>
                <Link to={paths.workflow(w.workflowId)}>{w.name}</Link>
                <Text size="xs" c="dimmed">
                  {[w.draft ? 'Draft' : '', ...w.versions.map((v) => `v${v}`)]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
              </div>
            ))
          )}
        </section>
      </div>
      <Modal
        opened={deleting}
        onClose={() => !busy && setDeleting(false)}
        title={`Delete ${baseline.name}?`}
        centered
      >
        <Text size="sm">
          Deletion removes this prompt from the library. Any draft or published
          workflow reference blocks deletion. Historical run instructions remain
          available.
        </Text>
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
    </div>
  );
}
