import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';
import { flushSync } from 'react-dom';
import {
  Badge,
  Group,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { ArrowLeft, ArrowRight, KeyRound, Plus, Search } from 'lucide-react';
import type { AppContext } from '../../App';
import type { VariableBinding } from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import { useBeforeUnloadWarning } from '../../lib/useBeforeUnloadWarning';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import { paths } from '../../routes/paths';
import layout from '../../components/PageLayout/PageLayout.module.css';
import styles from './Variables.module.css';
import { VariablePicker } from './VariablePicker';

type Read = Awaited<ReturnType<typeof api.variables.read.query>>;
type Listing = Extract<Read, { items: unknown }>;
type Inspection = Extract<Read, { dependencies: unknown }>;
const statusName = {
  ready: 'Ready',
  unset: 'Value not set',
  disabled: 'Disabled',
  locked: 'Store locked',
} as const;

export function VariableLibrary() {
  const { tick } = useOutletContext<AppContext>();
  const [data, setData] = useState<Listing>();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void api.variables.read
        .query({ action: 'list', search, offset })
        .then((r) => {
          if (active && 'items' in r) {
            setData(r);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [tick, search, offset]);
  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <h1>Variables</h1>
        <Link className={styles.primaryLink} to={paths.variable('new')}>
          <Plus size={15} />
          New variable
        </Link>
      </header>
      <div className={styles.toolbar}>
        <TextInput
          aria-label="Search variables"
          placeholder="Search variables"
          leftSection={<Search size={15} />}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <Text size="xs" c="dimmed">
          {data
            ? `${data.total} ${data.total === 1 ? 'variable' : 'variables'}`
            : 'Loading…'}
        </Text>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Loading variables…</p>}
      {data && !data.items.length ? (
        <div className={styles.empty}>
          <KeyRound size={24} />
          <h2>{search ? 'No matching variables' : 'No variables yet'}</h2>
          {!search && <Link to={paths.variable('new')}>Create a variable</Link>}
        </div>
      ) : (
        data && (
          <>
            <div className={styles.columnHead}>
              <span>Name</span>
              <span>Kind</span>
              <span>Status</span>
              <span>Updated</span>
            </div>
            <ul className={styles.list}>
              {data.items.map((v) => (
                <li key={v.id}>
                  <Link to={paths.variable(v.id)} className={styles.row}>
                    <div className={styles.identity}>
                      <strong>{v.name}</strong>
                      {v.description && <span>{v.description}</span>}
                    </div>
                    <Badge variant="light" color="gray">
                      {v.kind === 'secret' ? 'Secret' : 'Config'}
                    </Badge>
                    <span
                      className={
                        v.availability === 'ready'
                          ? styles.ready
                          : styles.status
                      }
                    >
                      {statusName[v.availability]}
                    </span>
                    <time className={styles.updated} dateTime={v.updatedAt}>
                      {new Date(v.updatedAt).toLocaleDateString()}
                    </time>
                    <ArrowRight size={15} />
                  </Link>
                </li>
              ))}
            </ul>
            <Group justify="space-between" mt="lg">
              <Button
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 25))}
              >
                Previous
              </Button>
              <Text size="xs" c="dimmed">
                {data.total
                  ? `${offset + 1}–${Math.min(offset + data.items.length, data.total)} of ${data.total}`
                  : '0 variables'}
              </Text>
              <Button
                disabled={!data.truncated}
                onClick={() => setOffset(offset + 25)}
              >
                Next
              </Button>
            </Group>
          </>
        )
      )}
    </div>
  );
}

export function VariableRoute() {
  const { variableId = 'new' } = useParams();
  return <VariableEditor key={variableId} id={variableId} />;
}
function VariableEditor({ id }: { id: string }) {
  const creating = id === 'new';
  const { act, onDirty, tick } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Inspection>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'secret' | 'config'>('secret');
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(creating);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const [offset, setOffset] = useState(0);
  const [confirmation, setConfirmation] = useState<
    'disable' | 'enable' | 'delete'
  >();
  const [rebind, setRebind] = useState<{
    binding: VariableBinding;
    target: string;
  }>();
  const valueInput = useRef<HTMLInputElement>(null);
  const configInput = useRef<HTMLTextAreaElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  const dirty = creating
    ? !!(name || description || value)
    : !!saved &&
      (name !== saved.name || description !== saved.description || editing);
  useBeforeUnloadWarning(dirty);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (creating || dirty || busy) return;
    let active = true;
    void api.variables.read
      .query({ action: 'inspect', id, offset })
      .then((r) => {
        if (!active || !('dependencies' in r)) return;
        setSaved(r);
        setName(r.name);
        setDescription(r.description);
        setKind(r.kind);
        setError('');
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [id, creating, dirty, busy, tick, refresh, offset]);
  useEffect(() => {
    if (editing && !creating)
      (kind === 'secret' ? valueInput.current : configInput.current)?.focus();
  }, [editing, creating, kind]);
  const clear = () => {
    setValue('');
    setEditing(creating);
    if (saved) {
      setName(saved.name);
      setDescription(saved.description);
    }
    setError('');
  };
  const save = async () => {
    if (pending.current) return;
    if (editing && kind === 'secret' && !value && !creating) {
      setError('Enter a replacement value or cancel the replacement.');
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await act(
        async () => {
          try {
            const result = await api.variables.manage.mutate(
              creating
                ? {
                    action: 'create',
                    name,
                    description,
                    kind,
                    ...(kind === 'config' || value ? { value } : {}),
                  }
                : {
                    action: 'update',
                    id,
                    expectedRevision: saved!.revision,
                    name,
                    description,
                    ...(editing ? { value } : {}),
                  },
            );
            // Acknowledgment clears plaintext before any refresh can fail.
            setValue('');
            setEditing(false);
            if ('name' in result) {
              setName(result.name);
              setDescription(result.description);
            }
            if (creating && 'name' in result) {
              flushSync(() => onDirty(false));
              void navigate(paths.variable(result.id));
            } else {
              if (saved && 'availability' in result)
                setSaved({ ...saved, ...result });
              setRefresh((n) => n + 1);
            }
          } catch (e) {
            setError(errorMessage(e));
            throw e;
          }
        },
        creating ? 'Variable created.' : 'Variable saved.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const startValue = async () => {
    if (!saved || pending.current) return;
    if (saved.kind === 'config' && saved.valueRevision !== null) {
      pending.current = true;
      setBusy(true);
      try {
        const r = await api.variables.read.query({
          action: 'config_value',
          id,
        });
        if ('value' in r) {
          setValue(r.value);
          setEditing(true);
          setError('');
        }
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        pending.current = false;
        setBusy(false);
      }
    } else {
      setValue('');
      setEditing(true);
    }
  };
  const change = async () => {
    if (!saved || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await act(
        async () => {
          try {
            if (rebind)
              await api.variables.manage.mutate({
                action: 'bind',
                id: rebind.binding.id,
                variableId: rebind.target,
                kind: rebind.binding.kind,
                expectedRevision: rebind.binding.revision,
              });
            else if (confirmation === 'delete')
              await api.variables.manage.mutate({
                action: 'delete',
                id,
                expectedRevision: saved.revision,
              });
            else
              await api.variables.manage.mutate({
                action: 'update',
                id,
                expectedRevision: saved.revision,
                enabled: confirmation === 'enable',
              });
            setConfirmation(undefined);
            setRebind(undefined);
            if (confirmation === 'delete') void navigate(paths.variables);
            else setRefresh((n) => n + 1);
          } catch (e) {
            setError(errorMessage(e));
            throw e;
          }
        },
        rebind ? 'Binding updated.' : 'Variable updated.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  if (!creating && !saved)
    return (
      <div className={layout.page}>
        <header className={layout.header}>
          <h1>Variable</h1>
          <Link to={paths.variables}>Back to variables</Link>
        </header>
        <p role={error ? 'alert' : 'status'}>{error || 'Loading variable…'}</p>
      </div>
    );
  const blocked =
    !!saved &&
    !!(
      saved.dependencies.total ||
      saved.dependencies.activeRunCount ||
      saved.dependencies.runningComparisonCount
    );
  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <div className={styles.editorHeading}>
          <Link to={paths.variables} aria-label="Back to variables">
            <ArrowLeft size={18} />
          </Link>
          <h1>{creating ? 'New variable' : saved?.name}</h1>
        </div>
        {!creating && (
          <Badge variant="light" color="gray">
            {kind === 'secret' ? 'Secret' : 'Config'}
          </Badge>
        )}
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.editorGrid}>
        <form
          aria-label="Variable settings"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset className={styles.fields} disabled={busy}>
            <Stack gap="lg">
              <TextInput
                label="Name"
                required
                autoFocus={creating}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                description="Use letters, digits, underscores, dots, or hyphens. Names are unique in this instance."
              />
              <Textarea
                label="Description"
                maxLength={2000}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              {creating && (
                <Stack gap={5}>
                  <Text size="sm" fw={500}>
                    Kind
                  </Text>
                  <SegmentedControl
                    aria-label="Variable kind"
                    value={kind}
                    onChange={(v) => {
                      setValue('');
                      setKind(v as 'config' | 'secret');
                    }}
                    data={[
                      { value: 'secret', label: 'Secret' },
                      { value: 'config', label: 'Config' },
                    ]}
                  />
                  <Text size="xs" c="dimmed">
                    Config values can appear in run data. Use Secret for
                    credentials. Changing kind clears the entered value. Kind is
                    fixed after creation.
                  </Text>
                </Stack>
              )}
              <section
                className={styles.valueSection}
                aria-label="Value management"
              >
                {!creating && (
                  <Group justify="space-between" mb="md">
                    <Text size="sm" fw={550}>
                      {saved?.valueRevision === null
                        ? 'Value not set'
                        : kind === 'secret'
                          ? 'Value set'
                          : 'Config value set'}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {saved?.valueRevision !== null
                        ? `Value revision ${saved?.valueRevision}`
                        : ''}
                    </Text>
                  </Group>
                )}
                {saved?.availability === 'locked' && (
                  <Text size="sm" c="yellow" mb="sm">
                    Protected store unavailable. Restore the original key file
                    or check INTERLOCK_SECRET_KEY_FILE.
                  </Text>
                )}
                {editing ? (
                  <Stack gap="sm">
                    {kind === 'secret' ? (
                      <TextInput
                        ref={valueInput}
                        type="password"
                        autoComplete="new-password"
                        spellCheck={false}
                        label={creating ? 'Secret value' : 'New secret value'}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        description={
                          creating
                            ? 'You can set this later. Saved secrets cannot be read back.'
                            : 'New runs use the replacement. Existing runs retain their captured revision.'
                        }
                      />
                    ) : (
                      <Textarea
                        ref={configInput}
                        label="Config value"
                        autoComplete="off"
                        spellCheck={false}
                        rows={4}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    )}
                    {!creating && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setValue('');
                          setEditing(false);
                          requestAnimationFrame(() =>
                            replaceButton.current?.focus(),
                          );
                        }}
                      >
                        Cancel value change
                      </Button>
                    )}
                  </Stack>
                ) : (
                  <Button ref={replaceButton} onClick={() => void startValue()}>
                    {saved?.valueRevision === null
                      ? 'Set value'
                      : kind === 'secret'
                        ? 'Replace value'
                        : 'Edit value'}
                  </Button>
                )}
              </section>
              <Group>
                <Button
                  variant="primary"
                  disabled={busy || !dirty || !name.trim()}
                  type="submit"
                >
                  {busy
                    ? 'Saving…'
                    : creating
                      ? 'Create variable'
                      : 'Save changes'}
                </Button>
                <Button
                  disabled={busy || !dirty}
                  onClick={() => {
                    clear();
                    if (creating) {
                      flushSync(() => onDirty(false));
                      void navigate(paths.variables);
                    }
                  }}
                >
                  Cancel
                </Button>
              </Group>
            </Stack>
          </fieldset>
        </form>
        {!creating && saved && (
          <aside className={styles.dependencies}>
            <h2>
              Used by workflows <span>{saved.dependencies.total}</span>
            </h2>
            {!saved.dependencies.total ? (
              <Text size="sm" c="dimmed">
                No draft or retained published references.
              </Text>
            ) : (
              <ul>
                {saved.dependencies.items.map((w) => (
                  <li key={w.workflowId}>
                    <Link to={paths.workflow(w.workflowId)}>{w.name}</Link>
                    <Text size="xs" c="dimmed">
                      {[
                        w.draft ? 'Draft' : '',
                        w.versionCount
                          ? `Published ${w.versions.map((v) => `v${v}`).join(', ')}${w.versionsTruncated ? ` and ${w.versionCount - w.versions.length} more` : ''}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
            {(offset > 0 || saved.dependencies.truncated) && (
              <Group>
                <Button
                  disabled={!offset || busy || dirty}
                  onClick={() => setOffset(Math.max(0, offset - 20))}
                >
                  Previous
                </Button>
                <Button
                  disabled={!saved.dependencies.truncated || busy || dirty}
                  onClick={() => setOffset(offset + 20)}
                >
                  More workflows
                </Button>
              </Group>
            )}
            {!!saved.dependencies.activeRunCount && (
              <Text size="xs" c="dimmed">
                {saved.dependencies.activeRunCount} active runs retain a value
                revision.
              </Text>
            )}
            {!!saved.dependencies.runningComparisonCount && (
              <Text size="xs" c="dimmed">
                {saved.dependencies.runningComparisonCount} running comparisons
                retain a value revision.
              </Text>
            )}
            {!!saved.bindings.total && (
              <section>
                <h2>
                  Portable bindings <span>{saved.bindings.total}</span>
                </h2>
                <ul>
                  {saved.bindings.items.map((binding) => (
                    <li key={binding.id}>
                      <code className={styles.portableId}>{binding.id}</code>
                      <Button
                        variant="ghost"
                        disabled={dirty || busy}
                        onClick={() =>
                          setRebind({ binding, target: binding.variableId })
                        }
                      >
                        Change binding
                      </Button>
                    </li>
                  ))}
                </ul>
                {saved.bindings.truncated && (
                  <Button
                    disabled={dirty || busy}
                    onClick={() => setOffset(offset + 20)}
                  >
                    More bindings
                  </Button>
                )}
              </section>
            )}
            <details>
              <summary>Storage and recovery</summary>
              <Text size="xs" c="dimmed" mt="sm">
                Back up the database and its key separately. The key unlocks
                values automatically. Losing it makes stored values
                unrecoverable.
              </Text>
              {saved.storage.keyFile ? (
                <code className={styles.portableId}>
                  {saved.storage.keyFile}
                </code>
              ) : (
                <Text size="xs" c="dimmed">
                  {saved.storage.vaultId
                    ? 'Temporary in-memory key.'
                    : 'A key is created when the first value is set.'}
                </Text>
              )}
            </details>
            <section className={styles.dangerActions}>
              <h2>Availability</h2>
              <Text size="sm">{statusName[saved.availability]}</Text>
              <Button
                disabled={dirty || busy}
                onClick={() =>
                  setConfirmation(saved.enabled ? 'disable' : 'enable')
                }
              >
                {saved.enabled ? 'Disable use' : 'Enable use'}
              </Button>
              <Button
                variant="danger"
                disabled={dirty || busy}
                onClick={() => setConfirmation('delete')}
              >
                Delete variable
              </Button>
            </section>
          </aside>
        )}
      </div>
      {(confirmation || rebind) && saved && (
        <Modal
          title={
            rebind
              ? 'Change portable binding'
              : confirmation === 'delete'
                ? 'Delete variable'
                : confirmation === 'disable'
                  ? 'Disable use'
                  : 'Enable use'
          }
          onClose={() => {
            if (!busy) {
              setConfirmation(undefined);
              setRebind(undefined);
            }
          }}
        >
          <Stack>
            {rebind ? (
              <>
                <Text size="sm">
                  New runs using this portable identity will use the selected
                  local variable. Existing runs retain their original capture.
                  Review the workflow dependencies before changing it.
                </Text>
                <code className={styles.portableId}>{rebind.binding.id}</code>
                <VariablePicker
                  label="Local variable"
                  kind={rebind.binding.kind}
                  value={rebind.target}
                  onChange={(target) => setRebind({ ...rebind, target })}
                />
              </>
            ) : confirmation === 'delete' ? (
              <Text size="sm">
                {blocked
                  ? 'This variable is still referenced. Remove draft and retained published references and finish active runs or comparisons before deletion.'
                  : 'Delete this variable and its protected value revisions? Historical metadata remains. Backups may retain encrypted values.'}
              </Text>
            ) : (
              <Text size="sm">
                {confirmation === 'disable'
                  ? 'New runs and later steps in existing runs cannot use this variable. Values already delivered to an operation cannot be recalled. Cancel active work or revoke the credential at its provider when needed.'
                  : 'Existing captures can use their original retained revision again. New runs capture the current value.'}
              </Text>
            )}
            {error && (
              <Text role="alert" c="red" size="sm">
                {error}
              </Text>
            )}
            <Group justify="flex-end">
              <Button
                disabled={busy}
                onClick={() => {
                  setConfirmation(undefined);
                  setRebind(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                variant={confirmation === 'delete' ? 'danger' : 'primary'}
                disabled={
                  busy ||
                  (confirmation === 'delete' && blocked) ||
                  (!!rebind &&
                    (!rebind.target ||
                      rebind.target === rebind.binding.variableId))
                }
                onClick={() => void change()}
              >
                {busy
                  ? 'Saving…'
                  : rebind
                    ? 'Change binding'
                    : confirmation === 'delete'
                      ? 'Delete variable'
                      : confirmation === 'disable'
                        ? 'Disable use'
                        : 'Enable use'}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </div>
  );
}
