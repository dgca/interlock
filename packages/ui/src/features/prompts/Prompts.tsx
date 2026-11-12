import { isConfirmedWriteRejection } from '../../lib/isConfirmedWriteRejection';
import {
  Anchor,
  Button,
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

import { ArrowRight, Plus, Save, Search, Trash2 } from 'lucide-react';
import {
  promptContentSchema,
  promptRevisionConflict,
  samePromptContent,
  type PromptContent,
  type PromptUsage,
  type SavedPrompt,
} from '@interlock/core';

import type { Action } from '../../lib/useActionFeedback';
import { useDraftDismissal } from '../../lib/useDraftDismissal';
import { useEditorDraft } from '../../lib/useEditorDraft';
import { api, errorMessage } from '../../lib/api';
import { refreshQueries, trpc, useQueryClient } from '../../lib/query';
import { paths } from '../../routes/paths';
import layout from '../../components/PageLayout/PageLayout.module.css';

import { ListTable, ListTableRow } from '../../components/ListTable/ListTable';

import { promptTable } from './PromptSkeleton';
import styles from './Prompts.module.css';

const fields = ({
  name,
  description,
  content,
}: PromptContent): PromptContent => ({ name, description, content });

function PromptFields({
  value,
  onChange,
  editing,
}: {
  value: PromptContent;
  onChange: (value: PromptContent) => void;
  editing: boolean;
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
        minRows={12}
        maxRows={40}
        value={value.content}
        onChange={(e) => onChange({ ...value, content: e.target.value })}
        styles={{ input: { fontFamily: 'var(--mono)', lineHeight: 1.6 } }}
      />
    </Stack>
  );
}

export function PromptLibrary({ prompts }: { prompts: SavedPrompt[] }) {
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
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
          <Button component={Link} to={paths.promptNew} variant="primary">
            <Plus size={14} /> New prompt
          </Button>
        }
      />
      <div className={workspacePage.content}>
        {visible.length ? (
          <ListTable {...promptTable} label="Prompts">
            {visible.map((p) => (
              <ListTableRow key={p.id}>
                <span className={styles.identity}>
                  <strong>
                    <Anchor
                      component={Link}
                      to={paths.prompt(p.id)}
                      underline="hover"
                    >
                      {p.name}
                    </Anchor>
                  </strong>
                  {p.description && <small>{p.description}</small>}
                </span>
                <span className={styles.revision}>Revision {p.revision}</span>
                <time className={styles.updated} dateTime={p.updatedAt}>
                  {new Date(p.updatedAt).toLocaleDateString()}
                </time>
              </ListTableRow>
            ))}
          </ListTable>
        ) : (
          <EmptyState title={query ? 'No matching prompts' : 'No prompts yet'}>
            {query ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery('');
                  searchInput.current?.focus();
                }}
              >
                Clear search
              </Button>
            ) : (
              <Button component={Link} to={paths.promptNew} variant="secondary">
                Create a prompt
              </Button>
            )}
          </EmptyState>
        )}
      </div>
    </section>
  );
}

const blankPrompt: PromptContent = { name: '', description: '', content: '' };

export function PromptEditor({
  prompt,
  usage,
  readError,
  retryRead,
  act,
}: {
  prompt?: SavedPrompt;
  usage?: PromptUsage[];
  readError?: boolean;
  retryRead?: () => void;
  act: Action;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const formId = useId();
  const [baseline, setBaseline] = useState(prompt);
  const [draft, setDraft] = useState(() =>
    prompt ? fields(prompt) : blankPrompt,
  );
  const [retryId, setRetryId] = useState<string>();
  const [unconfirmedUpdate, setUnconfirmedUpdate] = useState<PromptContent>();
  const [saveError, setSaveError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [loadError, setLoadError] = useState('');
  const latestRequest = useRef<AbortController>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const dirty = !samePromptContent(draft, baseline ?? blankPrompt);
  const { busy: saving, beginSave, finishSave } = useEditorDraft(dirty);
  const busy = saving || loadingLatest;
  const conflict = Boolean(
    baseline &&
    !unconfirmedUpdate &&
    (saveError === promptRevisionConflict ||
      (dirty && prompt && prompt.revision > baseline.revision)),
  );
  const canSave =
    dirty &&
    !conflict &&
    !unconfirmedUpdate &&
    draft.name.trim() &&
    draft.content.trim();
  const openLibrary = () => void navigate(paths.prompts);

  useEffect(() => () => latestRequest.current?.abort(), []);
  useEffect(() => {
    if (
      !dirty &&
      !busy &&
      !conflict &&
      !unconfirmedUpdate &&
      prompt &&
      baseline &&
      prompt.revision > baseline.revision
    ) {
      setBaseline(prompt);
      setDraft(fields(prompt));
    }
  }, [dirty, busy, conflict, unconfirmedUpdate, prompt, baseline]);

  const cachePrompt = (saved: SavedPrompt) => {
    const list = trpc.prompts.list.queryFilter();
    void client.cancelQueries(list);
    client.setQueryData(trpc.prompts.list.queryKey(), (current) => {
      if (!current) return current;
      return current.some((item) => item.id === saved.id)
        ? current.map((item) =>
            item.id === saved.id && item.revision <= saved.revision
              ? saved
              : item,
          )
        : [...current, saved];
    });

    const input = { id: saved.id };
    const key = trpc.prompts.get.queryKey(input);
    void client.cancelQueries(trpc.prompts.get.queryFilter(input));
    const current = client.getQueryData(key);
    if (current && current.revision > saved.revision) return;
    // A creation receipt can return a prompt already used by a workflow.
    // Keep the read timestamp unset until the usage query has succeeded.
    client.setQueryData(
      key,
      { ...current, ...saved, usage: current?.usage ?? [] },
      { updatedAt: client.getQueryState(key)?.dataUpdatedAt ?? 0 },
    );
  };

  const save = async () => {
    if (!canSave || latestRequest.current || !beginSave()) return;
    setSaveError('');
    setLoadError('');
    const requestId = baseline ? undefined : (retryId ?? crypto.randomUUID());
    let saved: SavedPrompt;
    try {
      saved = baseline
        ? await api.prompts.update.mutate({
            ...draft,
            id: baseline.id,
            revision: baseline.revision,
          })
        : await api.prompts.create.mutate({ ...draft, requestId });
    } catch (error) {
      if (!finishSave(false)) return;
      const rejected = isConfirmedWriteRejection(error);
      const message = errorMessage(error);
      if (baseline && !rejected && message !== promptRevisionConflict) {
        setUnconfirmedUpdate(draft);
        setSaveError(
          'Interlock could not confirm whether your changes were saved. Check the saved prompt before trying again.',
        );
        return;
      }
      if (requestId && (!rejected || retryId)) setRetryId(requestId);
      setSaveError(
        requestId && !rejected
          ? 'Interlock could not confirm whether the prompt was saved. Retry creation to recover it safely. If you leave this page, check Prompts before creating it again.'
          : message,
      );
      return;
    }
    await act(async () => {
      cachePrompt(saved);
      if (!finishSave(true)) return;
      if (!baseline) {
        void navigate(paths.prompt(saved.id), { replace: true });
      } else {
        setBaseline(saved);
        setDraft(fields(saved));
      }
    });
  };

  const loadLatest = async () => {
    if (!baseline || latestRequest.current) return;
    const request = new AbortController();
    latestRequest.current = request;
    setLoadingLatest(true);
    setLoadError('');
    try {
      const input = { id: baseline.id };
      const latest = await api.prompts.get.query(input, {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      const key = trpc.prompts.get.queryKey(input);
      if (
        latest.revision < baseline.revision ||
        (!unconfirmedUpdate && latest.revision === baseline.revision) ||
        latest.revision < (client.getQueryData(key)?.revision ?? 0)
      ) {
        setLoadError('Could not read the latest prompt revision. Try again.');
        return;
      }
      const pending = client.getQueryState(key)?.fetchStatus === 'fetching';
      client.setQueryData(key, latest);
      if (pending) void refreshQueries(client, { queryKey: key, exact: true });
      if (unconfirmedUpdate) {
        const submitted = promptContentSchema.safeParse(unconfirmedUpdate);
        setUnconfirmedUpdate(undefined);
        if (!submitted.success || !samePromptContent(submitted.data, latest)) {
          setSaveError(
            latest.revision > baseline.revision
              ? promptRevisionConflict
              : 'The saved revision is still the same. Your edits are available to save again.',
          );
          return;
        }
      }
      setBaseline(latest);
      if (!unconfirmedUpdate || samePromptContent(draft, unconfirmedUpdate))
        setDraft(fields(latest));
      setSaveError('');
    } catch (error) {
      if (!request.signal.aborted)
        setLoadError(
          `Could not load the latest prompt. ${errorMessage(error)}`,
        );
    } finally {
      if (!request.signal.aborted) {
        latestRequest.current = null;
        setLoadingLatest(false);
      }
    }
  };

  const recovery = useDraftDismissal(dirty, busy, () => void loadLatest());
  const discard = () => {
    if (!baseline) return openLibrary();
    if (conflict) {
      recovery.dismiss();
      return;
    }
    setSaveError('');
    setDraft(fields(baseline));
  };

  const remove = async () => {
    if (!baseline || !beginSave()) return;
    setDeleteError('');
    await act(
      async () => {
        await api.prompts.delete.mutate({ id: baseline.id });
        void client.cancelQueries(trpc.prompts.list.queryFilter());
        client.setQueryData(trpc.prompts.list.queryKey(), (current) =>
          current?.filter((item) => item.id !== baseline.id),
        );
        const detail = trpc.prompts.get.queryFilter({ id: baseline.id });
        void client.cancelQueries(detail);
        client.removeQueries(detail);
        if (finishSave(true)) openLibrary();
      },
      'Prompt deleted.',
      (message) => {
        if (finishSave(false)) setDeleteError(message);
      },
    );
  };

  return (
    <section className={workspacePage.page}>
      <PageHeader
        title={baseline?.name ?? 'New prompt'}
        onBack={openLibrary}
        backLabel="Back to prompts"
        busy={busy}
        status={
          baseline
            ? `${dirty ? 'Unsaved changes' : 'Saved'} · Revision ${baseline.revision}`
            : dirty
              ? 'Unsaved changes'
              : undefined
        }
        actions={
          <>
            <Button
              disabled={
                busy ||
                Boolean(unconfirmedUpdate || (baseline && !dirty && !conflict))
              }
              loading={loadingLatest && !unconfirmedUpdate}
              onClick={discard}
            >
              {conflict
                ? 'Load latest'
                : baseline
                  ? 'Discard changes'
                  : 'Cancel'}
            </Button>
            {baseline && (
              <Button
                variant="secondary"
                ref={deleteTrigger}
                aria-label="Delete prompt"
                leftSection={<Trash2 size={16} aria-hidden="true" />}
                disabled={busy || dirty || Boolean(unconfirmedUpdate)}
                onClick={() => {
                  setDeleteError('');
                  setDeleting(true);
                }}
              >
                Delete
              </Button>
            )}
            {unconfirmedUpdate ? (
              <Button
                variant="primary"
                loading={loadingLatest}
                onClick={() => void loadLatest()}
              >
                Check saved prompt
              </Button>
            ) : (
              <Button
                form={formId}
                type="submit"
                variant="primary"
                disabled={busy || !canSave}
                loading={saving && !deleting}
                leftSection={
                  baseline ? <Save size={16} aria-hidden="true" /> : undefined
                }
              >
                {baseline
                  ? 'Save changes'
                  : retryId
                    ? 'Retry creation'
                    : 'Create prompt'}
              </Button>
            )}
          </>
        }
      />
      <div className={workspacePage.content}>
        <div className={workspacePage.formContent}>
          <form
            id={formId}
            className={workspacePage.card}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <ActionError
              message={
                conflict
                  ? 'This prompt changed elsewhere. Your edits are still here.'
                  : saveError
              }
            />
            <ActionError message={loadError} />
            <fieldset
              disabled={busy || Boolean(retryId)}
              className={styles.fields}
            >
              <PromptFields
                value={draft}
                onChange={setDraft}
                editing={Boolean(baseline)}
              />
            </fieldset>
            {baseline && (
              <section
                className={workspacePage.section}
                aria-labelledby={`${formId}-usage`}
              >
                <h2 id={`${formId}-usage`}>
                  Used by{' '}
                  {usage && (
                    <span className={layout.referenceCount}>
                      {usage.length}
                    </span>
                  )}
                </h2>
                {readError && (
                  <Stack align="flex-start" gap="xs">
                    <Text role="status" size="sm">
                      {usage
                        ? 'Could not refresh the saved prompt. Showing the last loaded data.'
                        : 'Could not load workflow references. The prompt is saved.'}
                    </Text>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={retryRead}
                    >
                      Retry prompt details
                    </Button>
                  </Stack>
                )}
                {usage === undefined ? (
                  !readError && (
                    <Text role="status" size="sm">
                      Loading workflow references…
                    </Text>
                  )
                ) : usage.length ? (
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
                ) : (
                  <Text size="sm" c="dimmed">
                    No workflows use this prompt yet.
                  </Text>
                )}
              </section>
            )}
          </form>
        </div>
      </div>
      {recovery.confirmation}
      {baseline && deleting && (
        <Modal
          busy={saving}
          onClose={() => !saving && setDeleting(false)}
          title={`Delete ${baseline.name}?`}
          returnFocusTo={() => deleteTrigger.current}
        >
          <ModalBody>
            <p>
              Prompts used by draft or published workflows cannot be deleted.
              Past runs keep their captured instructions.
            </p>
            {!!usage?.length && (
              <Text mt="md" size="sm">
                Referenced by {usage.map((w) => w.name).join(', ')}.
              </Text>
            )}
            <ActionError message={deleteError} />
          </ModalBody>
          <ModalFooter>
            <Button disabled={saving} onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={saving}
              onClick={() => void remove()}
            >
              Delete
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}
