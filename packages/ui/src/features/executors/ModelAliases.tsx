import {
  ActionIcon,
  NativeSelect,
  TextInput,
  Textarea,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ActionError,
  workspacePage,
} from '../../design-system';

import { useEffect, useId, useRef, useState } from 'react';

import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  modelAliasNameSchema,
  type ModelAliasCandidate,
  type SavedModelAlias,
} from '@interlock/core';

import {
  ListTable,
  ListTableRow,
  ListTableSkeleton,
} from '../../components/ListTable/ListTable';
import { api, errorMessage } from '../../lib/api';
import { ModelSettings } from './ModelSettings';
import { readModelAlias, readModelAliases } from './modelAliasApi';

import styles from './ModelAliases.module.css';

type Profile = Awaited<ReturnType<typeof api.executors.profiles.query>>[number];
const columns = [
  { label: 'Alias', width: 'minmax(150px, 1fr)' },
  { label: 'Primary choice', width: 'minmax(180px, 1.5fr)' },
  { label: 'Alternatives', width: '100px' },
  { label: '', width: '80px' },
];

export function ModelAliases({
  profiles,
  onDirty,
}: {
  profiles: Profile[] | undefined;
  onDirty?: (dirty: boolean) => void;
}) {
  const [page, setPage] =
    useState<Awaited<ReturnType<typeof readModelAliases>>>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<SavedModelAlias | null>();
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  useEffect(() => {
    let current = true;
    setPage(undefined);
    setError('');
    void readModelAliases({ offset, limit: 10 }).then(
      (next) => {
        if (!current) return;
        if (offset > 0 && offset >= next.total) {
          setOffset(0);
          return;
        }
        setPage(next);
      },
      (error) => {
        if (current) setError(errorMessage(error));
      },
    );
    return () => {
      current = false;
    };
  }, [offset, reload]);
  useEffect(() => {
    if (editing !== undefined)
      editor.current?.scrollIntoView({ block: 'nearest' });
  }, [editing]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const close = () => {
    request.current++;
    setEditing(undefined);
    setLoadError('');
    requestAnimationFrame(() => addButton.current?.focus());
  };
  const open = async (id: string) => {
    const current = ++request.current;
    setOpening(true);
    setLoadError('');
    setNotice('');
    try {
      const alias = await readModelAlias(id);
      if (request.current === current) setEditing(alias);
    } catch (error) {
      if (request.current === current) setLoadError(errorMessage(error));
    } finally {
      if (request.current === current) setOpening(false);
    }
  };
  const changed = () => {
    setReload((n) => n + 1);
    close();
  };
  return (
    <section
      id="model-aliases"
      className={styles.section}
      aria-labelledby="model-aliases-title"
    >
      <div className={styles.heading}>
        <h2 id="model-aliases-title">Model aliases</h2>
        <div className={styles.headingActions}>
          <ActionIcon
            variant="subtle"
            aria-label="Refresh aliases"
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw size={16} />
          </ActionIcon>
          <Button
            ref={addButton}
            variant="primary"
            disabled={editing !== undefined || opening}
            onClick={() => {
              setNotice('');
              setEditing(null);
            }}
          >
            <Plus size={14} />
            New alias
          </Button>
        </div>
      </div>
      <div className={`${workspacePage.card} ${styles.body}`}>
        <p className={styles.intro}>
          Name a model choice once, then select it across workflows. Each run
          captures the alias configuration it starts with.
        </p>
        {notice && (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        )}
        <ActionError message={loadError} />
        {error ? (
          <div className={styles.error}>
            <ActionError message={error} />
            <Button onClick={() => setReload((n) => n + 1)}>
              Retry loading aliases
            </Button>
          </div>
        ) : !page ? (
          <ListTableSkeleton
            columns={columns}
            className={styles.aliasTable}
            label="Loading model aliases…"
          >
            <span>—</span>
            <span>—</span>
            <span>—</span>
            <span />
          </ListTableSkeleton>
        ) : page.items.length ? (
          <>
            <ListTable columns={columns} className={styles.aliasTable}>
              {page.items.map((alias) => {
                const first = alias.candidates[0];
                const profile = profiles?.find(
                  (profile) => profile.id === first?.profileId,
                );
                return (
                  <ListTableRow key={alias.id} className={styles.aliasRow}>
                    <span className={styles.identity}>
                      <strong>{alias.name}</strong>
                      {alias.description && <span>{alias.description}</span>}
                    </span>
                    <span className={styles.identity}>
                      <span>{first?.model ?? 'No model configured'}</span>
                      <span>
                        {first?.profileId
                          ? (profile?.name ?? 'Missing harness')
                          : 'Workflow harness'}
                        {profile?.enabled === false ? ' · disabled' : ''}
                        {first?.effort ? ` · ${first.effort} effort` : ''}
                      </span>
                    </span>
                    <span>
                      {Math.max(0, alias.candidates.length - 1)}
                      <span className={styles.compactLabel}>
                        {' '}
                        alternative{alias.candidates.length === 2 ? '' : 's'}
                      </span>
                    </span>
                    <span className={styles.rowActions}>
                      <Button
                        variant="ghost"
                        disabled={opening || editing !== undefined}
                        onClick={() => void open(alias.id)}
                        aria-label={`Edit alias ${alias.name}`}
                      >
                        Edit
                      </Button>
                    </span>
                  </ListTableRow>
                );
              })}
            </ListTable>
            <div className={styles.pagination}>
              <span>
                {page.total} alias{page.total === 1 ? '' : 'es'}
              </span>
              <Button
                disabled={offset === 0}
                onClick={() => setOffset((n) => Math.max(0, n - 10))}
              >
                Previous
              </Button>
              <Button
                disabled={!page.truncated}
                onClick={() => setOffset((n) => n + 10)}
              >
                Next
              </Button>
            </div>
          </>
        ) : editing === undefined ? (
          <p className={styles.empty}>
            No model aliases yet. Create one for a role such as builder or
            reviewer.
          </p>
        ) : null}
        {editing !== undefined && (
          <div ref={editor}>
            <AliasEditor
              key={editing?.id ?? 'new'}
              alias={editing}
              profiles={profiles}
              onDirty={onDirty}
              onCancel={close}
              onReload={(alias) => setEditing(alias)}
              onSaved={(name, deleted) => {
                changed();
                setNotice(
                  deleted
                    ? `Alias ${name} deleted. Existing runs keep their captured configuration.`
                    : `Alias ${name} saved.`,
                );
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function AliasEditor({
  alias,
  profiles,
  onDirty,
  onCancel,
  onReload,
  onSaved,
}: {
  alias: SavedModelAlias | null;
  profiles: Profile[] | undefined;
  onDirty?: (dirty: boolean) => void;
  onCancel: () => void;
  onReload: (alias: SavedModelAlias) => void;
  onSaved: (name: string, deleted?: boolean) => void;
}) {
  const [name, setName] = useState(alias?.name ?? '');
  const [description, setDescription] = useState(alias?.description ?? '');
  const [candidates, setCandidates] = useState(() =>
    (alias?.candidates ?? [{ model: '' }]).map((candidate) => ({
      key: crypto.randomUUID(),
      ...candidate,
    })),
  );
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<'delete' | 'reload'>();
  const id = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const current = {
    name,
    description,
    candidates: candidates.map(({ key: _key, ...candidate }) => candidate),
  };
  const initial = {
    name: alias?.name ?? '',
    description: alias?.description ?? '',
    candidates: alias?.candidates ?? [{ model: '' }],
  };
  const dirty = JSON.stringify(current) !== JSON.stringify(initial);
  const baseline = useRef(alias);
  useEffect(() => {
    if (baseline.current !== alias) {
      baseline.current = alias;
      setName(alias?.name ?? '');
      setDescription(alias?.description ?? '');
      setCandidates(
        (alias?.candidates ?? [{ model: '' }]).map((candidate) => ({
          key: crypto.randomUUID(),
          ...candidate,
        })),
      );
      setError('');
    }
  }, [alias]);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  useEffect(() => {
    nameInput.current?.focus();
  }, []);
  const update = (key: string, value: Partial<ModelAliasCandidate>) =>
    setCandidates((list) =>
      list.map((candidate) =>
        candidate.key === key ? { ...candidate, ...value } : candidate,
      ),
    );
  const move = (index: number, offset: number) =>
    setCandidates((list) => {
      const next = [...list];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  const run = async (operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <form
      className={styles.editor}
      aria-label={alias ? `Edit alias ${alias.name}` : 'New model alias'}
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = modelAliasNameSchema.safeParse(name);
        if (!parsed.success) {
          setError(
            'Use a name starting with a letter or number, with letters, numbers, dots, underscores, or hyphens.',
          );
          nameInput.current?.focus();
          return;
        }
        if (candidates.some((candidate) => !candidate.model.trim())) {
          setError('Choose a model for every candidate.');
          return;
        }
        void run(async () => {
          await api.modelAliases.mutate.mutate(
            alias
              ? {
                  action: 'update',
                  id: alias.id,
                  expectedRevision: alias.revision,
                  ...current,
                  name: parsed.data,
                }
              : { action: 'create', ...current, name: parsed.data },
          );
          onSaved(parsed.data);
        });
      }}
    >
      <h3>{alias ? `Edit ${alias.name}` : 'New alias'}</h3>
      <div className={styles.metadata}>
        <TextInput
          ref={nameInput}
          label="Alias name"
          required
          maxLength={120}
          value={name}
          disabled={busy}
          placeholder="reviewer"
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Textarea
          label="Description"
          maxLength={2000}
          value={description}
          disabled={busy}
          rows={2}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </div>
      {alias && name.trim().toLowerCase() !== alias.name.toLowerCase() && (
        <p className={styles.intro}>
          Workflows that reference this alias by name may need updating after a
          rename. Selections made in the model picker use its stable identity.
        </p>
      )}
      <div className={styles.candidateIntro}>
        <h4>Model choices</h4>
        <p>
          Interlock selects the first choice with an available harness
          configuration. This order does not retry failed requests on another
          model.
        </p>
      </div>
      {candidates.map((candidate, index) => {
        const profile = profiles?.find(
          (profile) => profile.id === candidate.profileId,
        );
        return (
          <fieldset
            key={candidate.key}
            className={styles.candidate}
            disabled={busy}
          >
            <legend>
              {index === 0 ? 'Primary choice' : `Alternative ${index}`}
            </legend>
            <div className={styles.candidateActions}>
              <ActionIcon
                variant="subtle"
                aria-label={`Move choice ${index + 1} up`}
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                aria-label={`Move choice ${index + 1} down`}
                disabled={busy || index === candidates.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={16} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Remove choice ${index + 1}`}
                disabled={busy || candidates.length === 1}
                onClick={() =>
                  setCandidates((list) =>
                    list.filter((item) => item.key !== candidate.key),
                  )
                }
              >
                <Trash2 size={16} />
              </ActionIcon>
            </div>
            <div className={styles.fields}>
              <div>
                <NativeSelect
                  label={`Harness for choice ${index + 1}`}
                  value={candidate.profileId ?? ''}
                  disabled={busy || !profiles}
                  onChange={(event) =>
                    update(candidate.key, {
                      profileId: event.currentTarget.value || undefined,
                    })
                  }
                  data={[
                    { value: '', label: 'Use workflow harness' },
                    ...(profiles ?? []).map((profile) => ({
                      value: profile.id,
                      label: `${profile.name}${profile.enabled ? '' : ' · disabled'}`,
                    })),
                    ...(candidate.profileId && !profile
                      ? [
                          {
                            value: candidate.profileId,
                            label: `${candidate.profileId} · missing`,
                          },
                        ]
                      : []),
                  ]}
                />
                {!profiles && (
                  <p className={styles.intro}>
                    Harness choices will appear once configurations load.
                  </p>
                )}
              </div>
              <ModelSettings
                label={`Model for choice ${index + 1}`}
                defaultLabel="Choose a model"
                effortDefaultLabel="Inherit workflow or harness effort"
                profileId={profile?.id}
                model={candidate.model || undefined}
                effort={candidate.effort}
                onModelChange={(model) =>
                  update(candidate.key, { model: model ?? '' })
                }
                onEffortChange={(effort) => update(candidate.key, { effort })}
                disabled={busy}
              />
            </div>
          </fieldset>
        );
      })}
      <Button
        disabled={busy || candidates.length >= 32}
        onClick={() =>
          setCandidates((list) => [
            ...list,
            { key: crypto.randomUUID(), model: '' },
          ])
        }
      >
        <Plus size={14} />
        Add alternative
      </Button>
      <ActionError message={error} />
      {error && alias && (
        <Button disabled={busy} onClick={() => setConfirmation('reload')}>
          Reload saved alias
        </Button>
      )}
      <div className={styles.footer}>
        {alias && (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => setConfirmation('delete')}
          >
            <Trash2 size={14} />
            Delete alias
          </Button>
        )}
        <div />
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save alias'}
        </Button>
      </div>
      {confirmation && alias && (
        <Modal
          title={
            confirmation === 'delete'
              ? `Delete ${alias.name}?`
              : 'Reload saved alias?'
          }
          busy={busy}
          onClose={() => setConfirmation(undefined)}
        >
          <ModalBody>
            <p>
              {confirmation === 'delete'
                ? 'New runs referencing this alias will be blocked until its requirement is configured again. Existing runs keep their captured configuration.'
                : 'Discard these edits and load the current saved configuration.'}
            </p>
            <ActionError message={error} />
          </ModalBody>
          <ModalFooter>
            <Button disabled={busy} onClick={() => setConfirmation(undefined)}>
              Cancel
            </Button>
            <Button
              variant={confirmation === 'delete' ? 'danger' : 'primary'}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (confirmation === 'delete') {
                    await api.modelAliases.mutate.mutate({
                      action: 'delete',
                      id: alias.id,
                      expectedRevision: alias.revision,
                    });
                    onSaved(alias.name, true);
                  } else {
                    onReload(await readModelAlias(alias.id));
                    setConfirmation(undefined);
                  }
                })
              }
            >
              {busy
                ? 'Working…'
                : confirmation === 'delete'
                  ? 'Delete alias'
                  : 'Reload'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </form>
  );
}
