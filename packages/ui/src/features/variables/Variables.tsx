import {
  LoadingSkeleton,
  FormPlaceholder,
} from '../../components/LoadingSkeleton/LoadingSkeleton';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';
import { flushSync } from 'react-dom';
import {
  Badge,
  Button as MantineButton,
  Group,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
  TextInput,
  Textarea,
  VisuallyHidden,
} from '@mantine/core';
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  KeyRound,
  Plus,
  Save,
  Search,
} from 'lucide-react';
import type { AppContext } from '../../App';
import {
  variableRequirementSchema,
  type VariableBinding,
} from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import { useBeforeUnloadWarning } from '../../lib/useBeforeUnloadWarning';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import { ModalBody, ModalFooter } from '../../components/Modal/ModalLayout';
import { ActionError } from '../../components/ActionError/ActionError';
import { paths } from '../../routes/paths';
import layout from '../../components/PageLayout/PageLayout.module.css';
import library from '../../components/PageLayout/LibraryList.module.css';
import editorLayout from '../workflows/WorkflowEditor.module.css';
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

function VariableListSkeleton() {
  return (
    <>
      <VisuallyHidden role="status">Loading variables…</VisuallyHidden>
      <ul className={library.list} aria-hidden="true">
        {[1, 2, 3].map((row) => (
          <li key={row} className={`${library.row} ${styles.row}`}>
            <div className={library.rowIdentity}>
              <Skeleton
                className={styles.skeletonIcon}
                width={35}
                height={35}
                radius={8}
                animate={false}
              />
              <Stack gap={5} w="100%" maw={row === 2 ? 150 : 190}>
                <Skeleton width="65%" height={12} animate={false} />
                <Skeleton height={8} animate={false} />
              </Stack>
            </div>
            <Skeleton
              className={styles.rowKind}
              width={44}
              height={12}
              animate={false}
            />
            <Skeleton
              className={styles.status}
              width={52}
              height={10}
              animate={false}
            />
            <Skeleton
              className={library.updated}
              width={60}
              height={10}
              animate={false}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

export function VariableLibrary() {
  const { tick } = useOutletContext<AppContext>();
  const [data, setData] = useState<Listing & { search: string }>();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const loading =
    !error && (!data || (!data.items.length && data.search !== search));
  const updateSearch = (value: string) => {
    setSearch(value);
    setOffset(0);
  };
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void api.variables.read
        .query({ action: 'list', search, offset })
        .then((r) => {
          if (active && 'items' in r) {
            setData({ ...r, search });
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
      <header className={`${layout.header} ${layout.libraryHeader}`}>
        <h1>Variables</h1>
        <MantineButton
          component={Link}
          variant="filled"
          to={paths.variable('new')}
        >
          <Plus />
          New variable
        </MantineButton>
      </header>
      <div className={layout.libraryToolbar}>
        {loading ? (
          <Skeleton width={65} height={10} animate={false} aria-hidden="true" />
        ) : (
          data && (
            <Text size="xs" c="dimmed">
              {data.total} {data.total === 1 ? 'variable' : 'variables'}
            </Text>
          )
        )}
        <TextInput
          ref={searchInput}
          className={layout.librarySearch}
          size="xs"
          aria-label="Search variables"
          placeholder="Search variables"
          leftSection={<Search size={15} />}
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!loading && data?.search === search && !data.items.length && (
        <div className={`${library.empty} ${styles.empty}`}>
          <span className={library.icon} aria-hidden="true">
            {search ? <Search size={17} /> : <KeyRound size={17} />}
          </span>
          <h2>{search ? 'No matching variables' : 'No variables yet'}</h2>
          {search ? (
            <MantineButton
              variant="default"
              onClick={() => {
                updateSearch('');
                searchInput.current?.focus();
              }}
            >
              Clear search
            </MantineButton>
          ) : (
            <>
              <Text size="sm" c="dimmed">
                Reuse settings and credentials across workflows.
              </Text>
              <MantineButton
                component={Link}
                variant="default"
                to={paths.variable('new')}
              >
                Create a variable
              </MantineButton>
            </>
          )}
        </div>
      )}
      {(loading || !!data?.items.length) && (
        <>
          <div className={library.listPanel}>
            <div
              className={`${library.columnHead} ${styles.columnHead}`}
              aria-hidden="true"
            >
              <span>Name</span>
              <span>Kind</span>
              <span>Status</span>
              <span className={library.updated}>Updated</span>
            </div>
            {loading ? (
              <VariableListSkeleton />
            ) : (
              <ul className={library.list}>
                {data?.items.map((v) => (
                  <li key={v.id}>
                    <Link
                      to={paths.variable(v.id)}
                      className={`${library.row} ${styles.row}`}
                    >
                      <div className={library.rowIdentity}>
                        <span className={library.icon} aria-hidden="true">
                          {v.kind === 'secret' ? (
                            <KeyRound size={17} />
                          ) : (
                            <Braces size={17} />
                          )}
                        </span>
                        <div className={library.identity}>
                          <strong>{v.name}</strong>
                          {v.description && <span>{v.description}</span>}
                        </div>
                      </div>
                      <Badge
                        className={styles.rowKind}
                        variant="light"
                        color="gray"
                        size="sm"
                        tt="none"
                        fw={500}
                      >
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
                      <time className={library.updated} dateTime={v.updatedAt}>
                        {new Date(v.updatedAt).toLocaleDateString()}
                      </time>
                      <ArrowRight
                        className={library.rowArrow}
                        size={16}
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {data && !loading && (offset > 0 || data.truncated) && (
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
          )}
        </>
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
  const formId = useId();
  const { act, onDirty, tick } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const [saved, setSaved] = useState<Inspection>();
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'secret' | 'config'>('secret');
  const [value, setValue] = useState('');
  const [replacingSecret, setReplacingSecret] = useState(false);
  const [config, setConfig] = useState<{
    revision: number | null;
    value: string;
  }>();
  const [configDraft, setConfigDraft] = useState<string>();
  const [configError, setConfigError] = useState('');
  const [valueRequired, setValueRequired] = useState(false);
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
  const valueInput = useRef<HTMLTextAreaElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  const returnToValue = useRef(false);
  const nameValidation = variableRequirementSchema.shape.name.safeParse(name);
  const nameError = nameValidation.success
    ? ''
    : nameValidation.error.issues[0].message;
  useEffect(() => {
    nameInput.current?.setCustomValidity(nameError);
  }, [nameError, creating, saved]);
  const configChanged =
    configDraft !== undefined &&
    config !== undefined &&
    (configDraft !== config.value || config.revision === null);
  const dirty = creating
    ? !!(name || description || value)
    : !!saved &&
      (name !== saved.name ||
        description !== saved.description ||
        replacingSecret ||
        configChanged);
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
      .then(async (r) => {
        if (!active || !('dependencies' in r)) return;
        let nextConfig: typeof config;
        let readError = '';
        if (r.kind === 'config' && r.availability !== 'locked') {
          if (config?.revision === r.valueRevision) {
            nextConfig = config;
          } else if (r.valueRevision === null) {
            nextConfig = { revision: null, value: '' };
          } else {
            try {
              const result = await api.variables.read.query({
                action: 'config_value',
                id,
              });
              if ('value' in result)
                nextConfig = { revision: r.valueRevision, value: result.value };
            } catch (e) {
              readError = errorMessage(e);
            }
          }
        }
        if (!active) return;
        setSaved(r);
        setConfig(nextConfig);
        setConfigDraft(undefined);
        setConfigError(readError);
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
  }, [id, creating, dirty, busy, tick, refresh, offset, config]);
  useEffect(() => {
    if (replacingSecret) valueInput.current?.focus();
    else if (!busy && returnToValue.current) {
      returnToValue.current = false;
      replaceButton.current?.focus();
    }
  }, [replacingSecret, busy]);
  const clear = () => {
    setValue('');
    setValueRequired(false);
    setReplacingSecret(false);
    setConfigDraft(undefined);
    if (saved) {
      setName(saved.name);
      setDescription(saved.description);
    }
    setError('');
  };
  const save = async () => {
    if (pending.current) return;
    if (replacingSecret && !value) {
      setValueRequired(true);
      valueInput.current?.focus();
      return;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await act(
        async () => {
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
                  ...(configChanged
                    ? { value: configDraft }
                    : replacingSecret
                      ? { value }
                      : {}),
                },
          );
          // Clear the entered Secret replacement before refreshing the view.
          returnToValue.current = replacingSecret;
          setValue('');
          setReplacingSecret(false);
          setConfigDraft(undefined);
          if ('name' in result) {
            setName(result.name);
            setDescription(result.description);
          }
          if (creating && 'name' in result) {
            flushSync(() => onDirty(false));
            void navigate(paths.variable(result.id));
          } else {
            if (saved && 'availability' in result) {
              setSaved({ ...saved, ...result });
              if (configChanged)
                setConfig({
                  revision: result.valueRevision,
                  value: configDraft!,
                });
            }
            setRefresh((n) => n + 1);
          }
        },
        creating ? 'Variable created.' : 'Variable saved.',
        setError,
      );
    } finally {
      pending.current = false;
      setBusy(false);
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
        },
        rebind ? 'Binding updated.' : 'Variable updated.',
        setError,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const discard = () => {
    clear();
    if (creating) {
      flushSync(() => onDirty(false));
      void navigate(paths.variables);
    }
  };
  const header = (
    <header className={`${editorLayout.header} ${styles.editorHeader}`}>
      <Button
        variant="ghost"
        className={styles.backButton}
        aria-label="Back to variables"
        disabled={busy}
        onClick={() => void navigate(paths.variables)}
      >
        <ArrowLeft />
      </Button>
      <div className={styles.editorTitle}>
        <h1 title={saved?.name}>
          {creating ? 'New variable' : (saved?.name ?? 'Variable')}
        </h1>
      </div>
      {saved && (
        <span className={styles.editorStatus} role="status">
          {dirty ? 'Unsaved changes' : 'Saved'}
        </span>
      )}
      {(creating || saved) && (
        <div className={styles.editorActions}>
          <Button disabled={busy || (!creating && !dirty)} onClick={discard}>
            {creating ? 'Cancel' : 'Discard changes'}
          </Button>
          <Button
            variant="primary"
            disabled={busy || !dirty || !name.trim()}
            type="submit"
            form={formId}
          >
            <Save size={14} />
            {busy ? 'Saving…' : creating ? 'Create variable' : 'Save changes'}
          </Button>
        </div>
      )}
    </header>
  );
  if (!creating && !saved)
    return (
      <section className={styles.editor}>
        {header}
        <div className={styles.editorBody}>
          <div className={styles.editorContent}>
            {error ? (
              <p role="alert">{error}</p>
            ) : (
              <div className={layout.formPage}>
                <LoadingSkeleton
                  label="Loading variable…"
                  className={layout.formCard}
                >
                  <FormPlaceholder />
                </LoadingSkeleton>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  const blocked =
    !!saved &&
    !!(
      saved.dependencies.total ||
      saved.dependencies.activeRunCount ||
      saved.dependencies.runningComparisonCount
    );

  const metadataFields = (
    <Stack gap={12}>
      <TextInput
        ref={nameInput}
        label="Name"
        required
        autoFocus={creating}
        maxLength={120}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onInvalid={() => setNameTouched(true)}
        error={nameTouched && nameError ? nameError : undefined}
        description="Use letters, digits, underscores, dots, or hyphens. Names are unique in this instance."
      />
      <Textarea
        label="Description"
        maxLength={2000}
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </Stack>
  );
  const valueFields = (
    <Stack gap="sm" className={styles.valueFields}>
      <Textarea
        ref={valueInput}
        label={
          creating
            ? kind === 'secret'
              ? 'Secret value'
              : 'Config value'
            : 'New secret value'
        }
        autoComplete="off"
        spellCheck={false}
        rows={creating ? 4 : 3}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setValueRequired(false);
        }}
        error={valueRequired ? 'Enter a replacement value.' : undefined}
        description={
          !creating
            ? 'New runs use the replacement. Existing runs retain their captured revision.'
            : kind === 'secret'
              ? 'You can set this later. Saved secrets cannot be read back.'
              : undefined
        }
      />
      {!creating && (
        <Button
          variant="ghost"
          onClick={() => {
            setValue('');
            setValueRequired(false);
            setError('');
            setReplacingSecret(false);
            requestAnimationFrame(() => replaceButton.current?.focus());
          }}
        >
          Cancel value change
        </Button>
      )}
    </Stack>
  );

  return (
    <section className={styles.editor}>
      {header}
      <div className={styles.editorBody}>
        <div className={layout.formPage}>
          {!confirmation && !rebind && (
            <ActionError message={error} className={styles.error} />
          )}
          <form
            id={formId}
            aria-label="Variable settings"
            className={layout.formCard}
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <fieldset className={styles.fields} disabled={busy}>
              {creating && (
                <Stack gap="md">
                  {metadataFields}
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
                      credentials. Changing kind clears the entered value. Kind
                      is fixed after creation.
                    </Text>
                  </Stack>
                  {valueFields}
                </Stack>
              )}
              {saved && (
                <>
                  <Stack gap="md">
                    {metadataFields}
                    <Stack gap={5}>
                      <Text size="sm" fw={500}>
                        Kind
                      </Text>
                      <Badge
                        variant="light"
                        color="gray"
                        size="sm"
                        tt="none"
                        fw={500}
                        w="fit-content"
                      >
                        {kind === 'secret' ? 'Secret' : 'Config'}
                      </Badge>
                    </Stack>
                    {kind === 'config' ? (
                      <Stack gap="xs">
                        <Textarea
                          label="Config value"
                          autoComplete="off"
                          spellCheck={false}
                          rows={3}
                          disabled={!config}
                          value={configDraft ?? config?.value ?? ''}
                          error={configError || undefined}
                          description={
                            saved.valueRevision === null
                              ? 'Value not set'
                              : undefined
                          }
                          onChange={(e) => setConfigDraft(e.target.value)}
                        />
                        {config?.revision === null &&
                          configDraft === undefined && (
                            <Button
                              className={styles.valueAction}
                              onClick={() => setConfigDraft('')}
                            >
                              Set empty value
                            </Button>
                          )}
                      </Stack>
                    ) : replacingSecret ? (
                      valueFields
                    ) : (
                      <Group justify="space-between" align="end" gap="sm">
                        <Stack gap={5}>
                          <Text size="sm" fw={500}>
                            Secret value
                          </Text>
                          <Text size="xs" c="dimmed">
                            {saved.valueRevision === null
                              ? 'Value not set.'
                              : 'Saved secrets cannot be read back.'}
                          </Text>
                        </Stack>
                        <Button
                          ref={replaceButton}
                          disabled={saved.availability === 'locked'}
                          onClick={() => setReplacingSecret(true)}
                        >
                          {saved.valueRevision === null
                            ? 'Set value'
                            : 'Replace value'}
                        </Button>
                      </Group>
                    )}
                    {saved.availability === 'locked' && (
                      <Text size="xs" c="yellow">
                        Protected store unavailable. Restore the original key
                        file or check INTERLOCK_SECRET_KEY_FILE.
                      </Text>
                    )}
                    {saved.availability === 'disabled' && (
                      <Text size="xs" c="yellow">
                        Disabled. Enable use under Danger zone.
                      </Text>
                    )}
                  </Stack>
                  <section
                    className={layout.formSection}
                    aria-labelledby={`${formId}-usage`}
                  >
                    <h2 id={`${formId}-usage`}>
                      Used by{' '}
                      <span className={layout.referenceCount}>
                        {saved.dependencies.total}
                      </span>
                    </h2>
                    <div className={styles.dependencies}>
                      {!saved.dependencies.total ? (
                        <Text size="sm" c="dimmed">
                          No draft or retained published references.
                        </Text>
                      ) : (
                        <ul className={layout.referenceList}>
                          {saved.dependencies.items.map((w) => (
                            <li key={w.workflowId}>
                              <Link
                                className={layout.workflowReference}
                                to={paths.workflow(w.workflowId)}
                              >
                                <span className={layout.referenceName}>
                                  <strong>{w.name}</strong>
                                  <Text component="span" size="xs" c="dimmed">
                                    {[
                                      w.draft ? 'Draft' : '',
                                      w.versionCount
                                        ? `Published ${w.versions.map((v) => `v${v}`).join(', ')}${w.versionsTruncated ? ` and ${w.versionCount - w.versions.length} more` : ''}`
                                        : '',
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
                      {(offset > 0 || saved.dependencies.truncated) && (
                        <Group>
                          <Button
                            disabled={!offset || busy || dirty}
                            onClick={() => setOffset(Math.max(0, offset - 20))}
                          >
                            Previous
                          </Button>
                          <Button
                            disabled={
                              !saved.dependencies.truncated || busy || dirty
                            }
                            onClick={() => setOffset(offset + 20)}
                          >
                            More workflows
                          </Button>
                        </Group>
                      )}
                      {!!saved.dependencies.activeRunCount && (
                        <Text size="xs" c="dimmed">
                          {saved.dependencies.activeRunCount} active runs retain
                          a value revision.
                        </Text>
                      )}
                      {!!saved.dependencies.runningComparisonCount && (
                        <Text size="xs" c="dimmed">
                          {saved.dependencies.runningComparisonCount} running
                          comparisons retain a value revision.
                        </Text>
                      )}
                      {!!saved.bindings.total && (
                        <section>
                          <h3>
                            Portable bindings{' '}
                            <span>{saved.bindings.total}</span>
                          </h3>
                          <ul>
                            {saved.bindings.items.map((binding) => (
                              <li key={binding.id}>
                                <code className={styles.portableId}>
                                  {binding.id}
                                </code>
                                <Button
                                  variant="ghost"
                                  disabled={dirty || busy}
                                  onClick={() =>
                                    setRebind({
                                      binding,
                                      target: binding.variableId,
                                    })
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
                    </div>
                  </section>

                  <div className={styles.editorDisclosures}>
                    <details className={styles.dangerZone}>
                      <summary>Danger zone</summary>
                      <Group gap={8} className={styles.dangerActions}>
                        <Button
                          disabled={dirty || busy}
                          onClick={() =>
                            setConfirmation(
                              saved.enabled ? 'disable' : 'enable',
                            )
                          }
                        >
                          {saved.enabled ? 'Disable use' : 'Enable use'}
                        </Button>
                        <Button
                          className={styles.deleteAction}
                          disabled={dirty || busy}
                          onClick={() => setConfirmation('delete')}
                        >
                          Delete variable
                        </Button>
                      </Group>
                    </details>
                    <details>
                      <summary>Storage and recovery</summary>
                      <Text size="xs" c="dimmed">
                        Back up the database and its key separately. The key
                        unlocks values automatically. Losing it makes stored
                        values unrecoverable.
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
                  </div>
                </>
              )}
            </fieldset>
          </form>
        </div>
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
          busy={busy}
          onClose={() => {
            if (!busy) {
              setConfirmation(undefined);
              setRebind(undefined);
            }
          }}
        >
          <ModalBody>
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
              <ActionError message={error} className={styles.error} />
            </Stack>
          </ModalBody>
          <ModalFooter>
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
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}
