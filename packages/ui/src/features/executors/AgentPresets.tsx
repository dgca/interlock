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
  EmptyState,
} from '../../design-system';

import { useEffect, useRef, useState } from 'react';

import { ArrowDown, ArrowUp, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  modelAliasNameSchema,
  supportsPresetPermissions,
  type ExecutorPermissionMode,
  type ModelAliasCandidate,
  type SavedModelAlias,
} from '@interlock/core';

import {
  ListTable,
  ListTableRow,
  ListTableSkeleton,
} from '../../components/ListTable/ListTable';
import { api, errorMessage } from '../../lib/api';
import { isConfirmedWriteRejection } from '../../lib/isConfirmedWriteRejection';
import { useDraftDismissal } from '../../lib/useDraftDismissal';
import { useEditorDraft } from '../../lib/useEditorDraft';
import { trpc, useQuery, useQueryClient } from '../../lib/query';
import { ModelSettings } from './ModelSettings';
import { readModelAlias } from './modelAliasApi';

import {
  harnessLabel,
  harnessAvailability,
  isPrimaryHarness,
  type HarnessProfile as Profile,
} from './harnessProfiles';
import { permissionLabels, permissionOptions } from './permissions';
import styles from './AgentPresets.module.css';

const columns = [
  { label: 'Preset', width: 'minmax(150px, 1fr)' },
  { label: 'Primary choice', width: 'minmax(180px, 1.5fr)' },
  { label: 'Fallbacks', width: '100px' },
  { label: '', width: '80px' },
];

function presetHarnessLabel(
  profile: Profile,
  permissions?: ExecutorPermissionMode,
) {
  const label = harnessLabel(profile);
  const availability = harnessAvailability(profile);
  if (availability) return `${label} · ${availability}`;
  if (!supportsPresetPermissions(profile, permissions))
    return `${label} · cannot enforce permissions`;
  return label;
}

export function AgentPresets({
  profiles,
}: {
  profiles: Profile[] | undefined;
}) {
  const [offset, setOffset] = useState(0);
  const queryClient = useQueryClient();
  const pageQuery = useQuery({
    ...trpc.modelAliases.read.queryOptions({
      action: 'list',
      offset,
      limit: 10,
    }),
    select: (result) => {
      if (!('items' in result))
        throw new Error('Could not read agent presets.');
      return result;
    },
  });
  const page = pageQuery.data;
  const error = pageQuery.error ? errorMessage(pageQuery.error) : '';
  const [editing, setEditing] = useState<SavedModelAlias | null>();
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (page && offset > 0 && offset >= page.total) setOffset(0);
  }, [page, offset]);
  const close = () => setEditing(undefined);
  const open = async (id?: string) => {
    trigger.current = document.activeElement as HTMLElement | null;
    setNotice('');
    setLoadError('');
    if (!id) {
      setEditing(null);
      return;
    }
    setOpening(true);
    try {
      setEditing(await readModelAlias(id));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setOpening(false);
    }
  };
  const changed = () => {
    void queryClient.invalidateQueries(trpc.modelAliases.pathFilter());
    close();
  };
  return (
    <section
      id="model-aliases"
      className={styles.section}
      aria-labelledby="agent-presets-title"
    >
      <div className={styles.heading}>
        <h2 id="agent-presets-title">Agent presets</h2>
        <div className={styles.headingActions}>
          <ActionIcon
            variant="subtle"
            aria-label="Refresh presets"
            onClick={() => void pageQuery.refetch()}
          >
            <RefreshCw size={16} />
          </ActionIcon>
          <Button
            variant="primary"
            aria-label="New preset"
            disabled={opening || editing !== undefined}
            onClick={() => void open()}
          >
            <Plus size={14} />
            New preset
          </Button>
        </div>
      </div>
      <div>
        {notice && (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        )}
        <ActionError message={loadError} />
        {error && (
          <div className={styles.error}>
            <ActionError message={error} />
            <Button onClick={() => void pageQuery.refetch()}>
              Retry loading presets
            </Button>
          </div>
        )}
        {!page ? (
          !error && (
            <ListTableSkeleton
              columns={columns}

              label="Loading agent presets…"
            >
              <span>—</span>
              <span>—</span>
              <span>—</span>
              <span />
            </ListTableSkeleton>
          )
        ) : page.items.length ? (
          <>
            <ListTable columns={columns}>
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
                          ? profile
                            ? presetHarnessLabel(profile, alias.permissions)
                            : 'Missing harness'
                          : 'Workflow harness'}
                        {first?.effort ? ` · ${first.effort} effort` : ''}
                        {alias.permissions
                          ? ` · ${permissionLabels[alias.permissions]}`
                          : ''}
                      </span>
                    </span>
                    <span>
                      {Math.max(0, alias.candidates.length - 1)}
                      <span className={styles.compactLabel}>
                        {' '}
                        fallback{alias.candidates.length === 2 ? '' : 's'}
                      </span>
                    </span>
                    <span className={styles.rowActions}>
                      <Button
                        variant="ghost"
                        disabled={opening || editing !== undefined}
                        onClick={() => void open(alias.id)}
                        aria-label={`Edit preset ${alias.name}`}
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
                {page.total} preset{page.total === 1 ? '' : 's'}
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
        ) : (
          <EmptyState title="No agent presets yet" />
        )}
      </div>
      {editing !== undefined && (
        <PresetEditor
          key={editing?.id ?? 'new'}
          alias={editing}
          profiles={profiles}
          onClose={close}
          returnFocusTo={() => trigger.current}
          onReload={setEditing}
          onSaved={(name, deleted) => {
            changed();
            setNotice(
              deleted
                ? `Preset ${name} deleted. Existing runs keep their captured settings.`
                : `Preset ${name} saved.`,
            );
          }}
        />
      )}
    </section>
  );
}

function draftChoices(alias: SavedModelAlias | null) {
  return (alias?.candidates ?? [{ model: '' }]).map((candidate) => ({
    key: crypto.randomUUID(),
    legacyUnbound: !!alias && !candidate.profileId,
    ...candidate,
  }));
}

function PresetEditor({
  alias,
  profiles,
  onClose,
  returnFocusTo,
  onReload,
  onSaved,
}: {
  alias: SavedModelAlias | null;
  profiles: Profile[] | undefined;
  onClose: () => void;
  returnFocusTo: () => HTMLElement | null;
  onReload: (alias: SavedModelAlias) => void;
  onSaved: (name: string, deleted?: boolean) => void;
}) {
  const [name, setName] = useState(alias?.name ?? '');
  const [description, setDescription] = useState(alias?.description ?? '');
  const [permissions, setPermissions] = useState(alias?.permissions);
  const [candidates, setCandidates] = useState(() => draftChoices(alias));
  const [checking, setChecking] = useState(false);
  const checkRequest = useRef<AbortController>(null);
  const [unconfirmed, setUnconfirmed] = useState<{
    action: 'create' | 'update' | 'delete';
    name: string;
  }>();
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [newerSaved, setNewerSaved] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const current = {
    name,
    description,
    permissions,
    candidates: candidates.map(
      ({ key: _key, legacyUnbound: _legacyUnbound, ...candidate }) => candidate,
    ),
  };
  const initial = {
    name: alias?.name ?? '',
    description: alias?.description ?? '',
    permissions: alias?.permissions,
    candidates: alias?.candidates ?? [{ model: '' }],
  };
  const dirty = JSON.stringify(current) !== JSON.stringify(initial);
  const { busy: saving, beginSave, finishSave } = useEditorDraft(dirty);
  const busy = saving || checking;
  const dismissal = useDraftDismissal(dirty, busy, onClose);
  const conflict = Boolean(
    alias && (newerSaved || error.startsWith('Model alias changed elsewhere.')),
  );
  const baseline = useRef(alias);
  useEffect(() => {
    if (baseline.current !== alias) {
      baseline.current = alias;
      setName(alias?.name ?? '');
      setDescription(alias?.description ?? '');
      setPermissions(alias?.permissions);
      setCandidates(draftChoices(alias));
      setError('');
      setReadError('');
      setNewerSaved(false);
    }
  }, [alias]);
  useEffect(() => () => checkRequest.current?.abort(), []);
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
  const readSaved = async (checkingWrite: boolean) => {
    if (checkRequest.current) return;
    const target = alias?.id ?? unconfirmed?.name;
    if (!target) return;
    const request = new AbortController();
    checkRequest.current = request;
    setChecking(true);
    setReadError('');
    try {
      const latest = await readModelAlias(target, request.signal);
      if (request.signal.aborted) return;
      if (checkingWrite && unconfirmed?.action === 'create') {
        setUnconfirmed(undefined);
        setError(
          `A preset named “${latest.name}” is saved. Keep these edits under a different name or close this editor to open the saved preset.`,
        );
      } else if (checkingWrite && latest.revision === alias?.revision) {
        setUnconfirmed(undefined);
        setError('The saved preset is unchanged. Try the action again.');
      } else if (checkingWrite) {
        setUnconfirmed(undefined);
        setConfirmation(false);
        setNewerSaved(true);
        setError('A newer preset revision is saved. Load latest to review it.');
      } else if (alias && latest.revision > alias.revision) {
        onReload(latest);
      } else {
        setReadError('Could not read the latest revision. Try again.');
      }
    } catch (reason) {
      if (request.signal.aborted) return;
      const message = errorMessage(reason);
      if (
        checkingWrite &&
        isConfirmedWriteRejection(reason) &&
        message.endsWith('does not exist.')
      ) {
        if (unconfirmed?.action === 'delete') {
          onSaved(unconfirmed.name, true);
        } else if (unconfirmed?.action === 'create') {
          setUnconfirmed(undefined);
          setError(
            'No saved preset was found. Your edits are available to save again.',
          );
        } else {
          setError('The saved preset no longer exists.');
        }
      } else {
        setReadError(message);
      }
    } finally {
      if (!request.signal.aborted) {
        checkRequest.current = null;
        setChecking(false);
      }
    }
  };
  const reload = useDraftDismissal(dirty, busy, () => void readSaved(false));

  const run = async (
    action: 'create' | 'update' | 'delete',
    name: string,
    operation: () => Promise<unknown>,
  ) => {
    if (unconfirmed || !beginSave()) return;
    setError('');
    setReadError('');
    try {
      await operation();
      if (finishSave(true)) onSaved(name, action === 'delete');
    } catch (reason) {
      if (!finishSave(false)) return;
      const message = errorMessage(reason);
      if (
        isConfirmedWriteRejection(reason) ||
        message.startsWith('Model alias changed elsewhere.')
      ) {
        setError(message);
        if (message.startsWith('Model alias changed elsewhere.'))
          setConfirmation(false);
      } else {
        setUnconfirmed({ action, name });
        setConfirmation(false);
        setError(
          'Interlock could not confirm the preset change. Check the saved preset before trying again.',
        );
      }
    }
  };
  const form = (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || conflict || unconfirmed || !dirty) return;
        const parsed = modelAliasNameSchema.safeParse(name);
        if (!parsed.success) {
          setError(
            'Start with a letter or number. Use letters, numbers, spaces, dots, underscores, or hyphens.',
          );
          nameInput.current?.focus();
          return;
        }
        if (candidates.some((candidate) => !candidate.model.trim())) {
          setError('Choose a model for each choice.');
          return;
        }
        if (
          candidates.some(
            (candidate) => !candidate.profileId && !candidate.legacyUnbound,
          )
        ) {
          setError('Choose a harness for each new choice.');
          return;
        }
        void run(alias ? 'update' : 'create', parsed.data, () =>
          api.modelAliases.mutate.mutate(
            alias
              ? {
                  action: 'update',
                  id: alias.id,
                  expectedRevision: alias.revision,
                  ...current,
                  permissions: permissions ?? null,
                  name: parsed.data,
                }
              : { action: 'create', ...current, name: parsed.data },
          ),
        );
      }}
    >
      <ModalBody>
        <div className={styles.metadata}>
          <TextInput
            ref={nameInput}
            data-autofocus
            label="Name"
            required
            maxLength={120}
            value={name}
            disabled={busy}
            placeholder="Deep review"
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Textarea
            label="Description"
            placeholder="Optional"
            rows={2}
            maxLength={2000}
            value={description}
            disabled={busy}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
          <NativeSelect
            label="Permissions"
            description={
              permissions
                ? 'The stricter workflow or preset mode applies.'
                : 'The workflow can override the harness default.'
            }
            inputWrapperOrder={['label', 'input', 'description', 'error']}
            value={permissions ?? ''}
            disabled={busy}
            onChange={(event) =>
              setPermissions(
                (event.currentTarget.value || undefined) as
                  ExecutorPermissionMode | undefined,
              )
            }
            data={[
              { value: '', label: 'Use harness default' },
              ...permissionOptions,
            ]}
          />
        </div>
        {alias && name.trim().toLowerCase() !== alias.name.toLowerCase() && (
          <p className={styles.intro}>
            Workflows that reference this preset by name may need updating after
            a rename. Selections in Executor use its stable ID.
          </p>
        )}
        <div className={styles.candidateIntro}>
          <h3>Primary and fallbacks</h3>
          <p>
            Interlock skips disabled and unavailable harnesses. It uses the
            first available choice that supports the required permissions.
          </p>
        </div>
        {candidates.map((candidate, index) => {
          const profile = profiles?.find(
            (profile) => profile.id === candidate.profileId,
          );
          const title = index === 0 ? 'Primary choice' : `Fallback ${index}`;
          const titleId = `choice-${candidate.key}`;
          return (
            <section
              key={candidate.key}
              className={styles.candidate}
              aria-labelledby={titleId}
            >
              <div className={styles.candidateHeader}>
                <h4 id={titleId}>{title}</h4>
                {candidates.length > 1 && (
                  <div className={styles.candidateActions}>
                    <ActionIcon
                      size={30}
                      variant="subtle"
                      aria-label={`Move choice ${index + 1} up`}
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={16} />
                    </ActionIcon>
                    <ActionIcon
                      size={30}
                      variant="subtle"
                      aria-label={`Move choice ${index + 1} down`}
                      disabled={busy || index === candidates.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={16} />
                    </ActionIcon>
                    <ActionIcon
                      size={30}
                      variant="subtle"
                      aria-label={`Remove choice ${index + 1}`}
                      disabled={busy}
                      onClick={() =>
                        setCandidates((list) =>
                          list.filter((item) => item.key !== candidate.key),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </ActionIcon>
                  </div>
                )}
              </div>
              <div className={styles.fields}>
                <div>
                  <NativeSelect
                    label="Harness"
                    value={candidate.profileId ?? ''}
                    disabled={busy || !profiles}
                    onChange={(event) =>
                      update(candidate.key, {
                        profileId: event.currentTarget.value || undefined,
                      })
                    }
                    data={[
                      {
                        value: '',
                        label: candidate.legacyUnbound
                          ? 'Use workflow harness'
                          : 'Choose a harness',
                        disabled:
                          !candidate.legacyUnbound && !!candidate.profileId,
                      },
                      ...(profiles ?? [])
                        .filter(
                          (profile) =>
                            isPrimaryHarness(profile) ||
                            profile.id === candidate.profileId,
                        )
                        .map((profile) => ({
                          value: profile.id,
                          label: presetHarnessLabel(profile, permissions),
                          disabled:
                            profile.id !== candidate.profileId &&
                            !supportsPresetPermissions(profile, permissions),
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
                    <p className={styles.intro}>Loading harnesses…</p>
                  )}
                </div>
                <ModelSettings
                  label="Model"
                  compact
                  alwaysShowEffort
                  defaultLabel="Choose a model"
                  effortDefaultLabel="Inherit effort"
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
            </section>
          );
        })}
        <Button
          aria-label="Add fallback"
          disabled={busy || candidates.length >= 32}
          onClick={() =>
            setCandidates((list) => [
              ...list,
              { key: crypto.randomUUID(), model: '', legacyUnbound: false },
            ])
          }
        >
          <Plus size={14} />
          Add fallback
        </Button>
        <ActionError message={error} />
        <ActionError message={readError} />
        {unconfirmed && (
          <Button loading={checking} onClick={() => void readSaved(true)}>
            Check saved preset
          </Button>
        )}
        {conflict && !unconfirmed && (
          <Button loading={checking} onClick={reload.dismiss}>
            Load latest
          </Button>
        )}
      </ModalBody>
      <ModalFooter
        aside={
          alias && (
            <Button
              variant="ghost"
              aria-label="Delete preset"
              disabled={busy || Boolean(unconfirmed) || conflict}
              onClick={() => setConfirmation(true)}
            >
              <Trash2 size={14} />
              Delete preset
            </Button>
          )
        }
      >
        <Button disabled={busy} onClick={dismissal.dismiss}>
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={busy || !dirty || conflict || Boolean(unconfirmed)}
        >
          {busy ? 'Saving…' : alias ? 'Save changes' : 'Create preset'}
        </Button>
      </ModalFooter>
    </form>
  );
  return (
    <>
      <Modal
        title={alias ? 'Edit preset' : 'New preset'}
        size={670}
        busy={busy}
        covered={dismissal.covered || reload.covered || confirmation}
        onClose={dismissal.dismiss}
        returnFocusTo={returnFocusTo}
      >
        {form}
      </Modal>
      {dismissal.confirmation}
      {reload.confirmation}
      {confirmation && alias && (
        <Modal
          title={`Delete ${alias.name}?`}
          busy={saving}
          onClose={() => setConfirmation(false)}
        >
          <ModalBody>
            <p>
              New runs referencing this preset will be blocked until its
              requirement is configured again. Existing runs keep their captured
              configuration.
            </p>
            <ActionError message={error} />
          </ModalBody>
          <ModalFooter>
            <Button disabled={saving} onClick={() => setConfirmation(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={saving}
              onClick={() =>
                void run('delete', alias.name, () =>
                  api.modelAliases.mutate.mutate({
                    action: 'delete',
                    id: alias.id,
                    expectedRevision: alias.revision,
                  }),
                )
              }
            >
              Delete preset
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
}
