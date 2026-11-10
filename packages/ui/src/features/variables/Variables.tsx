import {
  LoadingSkeleton,
  FormPlaceholder,
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Textarea,
  EmptyState,
  Modal,
  ModalBody,
  ModalFooter,
  Placeholder,
  ActionError,
  PageHeader,
  workspacePage,
} from '../../design-system';

import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';
import { flushSync } from 'react-dom';

import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { AppContext } from '../../App';
import {
  variableRequirementSchema,
  type VariableBinding,
} from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import {
  trpc,
  useQuery,
  useQueryClient,
  useRefreshOnTick,
} from '../../lib/query';
import { useBeforeUnloadWarning } from '../../lib/useBeforeUnloadWarning';

import { paths } from '../../routes/paths';
import layout from '../../components/PageLayout/PageLayout.module.css';

import { ListTable, ListTableRow } from '../../components/ListTable/ListTable';

import { VariableRowsSkeleton, variableColumns } from './VariableListSkeleton';
import styles from './Variables.module.css';
import { VariablePicker } from './VariablePicker';

type Read = Awaited<ReturnType<typeof api.variables.read.query>>;
type Inspection = Extract<Read, { dependencies: unknown }>;
type ConfigValue = { id: string; value: string };
// The value revision belongs to cache identity, not the server input. Secret
// values never use this read path or enter the query cache.
function configReadOptions(id: string, revision: number) {
  const options = trpc.variables.read.queryOptions({
    action: 'config_value',
    id,
  });
  const queryKey: readonly unknown[] = [
    options.queryKey[0],
    { ...options.queryKey[1], revision },
  ];
  return {
    queryKey,
    queryFn: async (): Promise<ConfigValue> => {
      const result = await api.variables.read.query({
        action: 'config_value',
        id,
      });
      if (
        !('value' in result) ||
        typeof result.id !== 'string' ||
        typeof result.value !== 'string'
      )
        throw new Error('Could not read the config value.');
      return { id: result.id, value: result.value };
    },
  };
}

const statusName = {
  ready: 'Ready',
  unset: 'Value not set',
  disabled: 'Disabled',
  locked: 'Store locked',
} as const;

export function VariableLibrary() {
  const { tick } = useOutletContext<AppContext>();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const result = useQuery({
    ...trpc.variables.read.queryOptions({ action: 'list', search, offset }),
    enabled: search === debouncedSearch,
  });
  useRefreshOnTick(
    tick,
    result.refetch,
    search === debouncedSearch,
    result.isFetching,
  );
  const data = result.data && 'items' in result.data ? result.data : undefined;
  const error = result.error ? errorMessage(result.error) : '';
  const loading = !data && !error;
  const updateSearch = (value: string) => {
    setSearch(value);
    setOffset(0);
  };
  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);
  useEffect(() => {
    if (data && offset > 0 && offset >= data.total)
      setOffset(Math.max(0, Math.floor((data.total - 1) / 25) * 25));
  }, [data, offset]);
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title="Variables"
        subtitle={
          data ? (
            `${data.total} ${data.total === 1 ? 'variable' : 'variables'}`
          ) : loading ? (
            <Placeholder w={65} h={10} />
          ) : undefined
        }
        controls={
          <TextInput
            ref={searchInput}
            className={workspacePage.search}
            aria-label="Search variables"
            placeholder="Search variables"
            leftSection={<Search size={14} />}
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
          />
        }
        actions={
          <Button component={Link} variant="primary" to={paths.variable('new')}>
            <Plus size={14} /> New variable
          </Button>
        }
      />
      <div className={workspacePage.content}>
        {error && (
          <Alert
            color="red"
            mb="md"
            title={
              data ? 'Variables may be out of date' : 'Could not load variables'
            }
          >
            {error}
            <Button variant="ghost" onClick={() => void result.refetch()}>
              Retry loading
            </Button>
          </Alert>
        )}
        {loading ? (
          <VariableRowsSkeleton />
        ) : data?.items.length ? (
          <ListTable columns={variableColumns}>
            {data.items.map((v) => (
              <ListTableRow
                key={v.id}
                to={paths.variable(v.id)}
                className={styles.listRow}
              >
                <span className={styles.identity}>
                  <strong>{v.name}</strong>
                  {v.description && <small>{v.description}</small>}
                </span>
                <Badge
                  className={styles.rowKind}
                  variant="light"
                  color="gray"
                  size="sm"
                >
                  {v.kind === 'secret' ? 'Secret' : 'Config'}
                </Badge>
                <span
                  className={
                    v.availability === 'ready' ? styles.ready : styles.status
                  }
                >
                  {statusName[v.availability]}
                </span>
                <time className={styles.updated} dateTime={v.updatedAt}>
                  {new Date(v.updatedAt).toLocaleDateString()}
                </time>
                <ChevronRight size={16} aria-hidden="true" />
              </ListTableRow>
            ))}
          </ListTable>
        ) : (
          data && (
            <EmptyState
              title={search ? 'No matching variables' : 'No variables yet'}
              description={
                search
                  ? undefined
                  : 'Reuse settings and credentials across workflows.'
              }
            >
              {search ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    updateSearch('');
                    searchInput.current?.focus();
                  }}
                >
                  Clear search
                </Button>
              ) : (
                <Button
                  component={Link}
                  variant="secondary"
                  to={paths.variable('new')}
                >
                  Create a variable
                </Button>
              )}
            </EmptyState>
          )
        )}
        {data && (offset > 0 || data.truncated) && (
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
      </div>
    </section>
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
  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData(
    trpc.variables.read.queryKey({ action: 'inspect', id, offset: 0 }),
  );
  const initial = cached && 'dependencies' in cached ? cached : undefined;
  const [saved, setSaved] = useState<Inspection | undefined>(initial);
  const [name, setName] = useState(initial?.name ?? '');
  const [nameTouched, setNameTouched] = useState(false);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [kind, setKind] = useState<'secret' | 'config'>(
    initial?.kind ?? 'secret',
  );
  const [value, setValue] = useState('');
  const [replacingSecret, setReplacingSecret] = useState(false);
  const [config, setConfig] = useState<
    | {
        revision: number | null;
        value: string;
      }
    | undefined
  >(() => {
    if (
      !initial ||
      initial.kind !== 'config' ||
      initial.availability === 'locked'
    )
      return undefined;
    if (initial.valueRevision === null) return { revision: null, value: '' };
    const cachedValue = queryClient.getQueryData<ConfigValue>(
      configReadOptions(id, initial.valueRevision).queryKey,
    );
    return cachedValue && 'value' in cachedValue
      ? { revision: initial.valueRevision, value: cachedValue.value }
      : undefined;
  });
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
  const actionsTrigger = useRef<HTMLButtonElement>(null);
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
    void queryClient
      .fetchQuery(
        trpc.variables.read.queryOptions({ action: 'inspect', id, offset }),
      )
      .then(async (r) => {
        if (!active || !('dependencies' in r)) return;
        let nextConfig: typeof config = undefined;
        let readError = '';
        if (r.kind === 'config' && r.availability !== 'locked') {
          if (config?.revision === r.valueRevision) {
            nextConfig = config;
          } else if (r.valueRevision === null) {
            nextConfig = { revision: null, value: '' };
          } else {
            try {
              const result = await queryClient.fetchQuery(
                configReadOptions(id, r.valueRevision),
              );
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
          await queryClient.cancelQueries(trpc.variables.read.pathFilter());
          queryClient.setQueriesData<Read>(
            trpc.variables.read.pathFilter(),
            (current) =>
              current &&
              'dependencies' in current &&
              'name' in result &&
              current.id === result.id &&
              current.revision <= result.revision
                ? { ...current, ...result }
                : current,
          );
          if (
            'name' in result &&
            result.kind === 'config' &&
            result.valueRevision !== null
          ) {
            const savedValue = creating
              ? value
              : configChanged
                ? configDraft
                : undefined;
            if (savedValue !== undefined)
              queryClient.setQueryData<ConfigValue>(
                configReadOptions(result.id, result.valueRevision).queryKey,
                { id: result.id, value: savedValue },
              );
          }
          void queryClient.invalidateQueries(trpc.variables.read.pathFilter());
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
          else if (confirmation === 'delete') {
            await api.variables.manage.mutate({
              action: 'delete',
              id,
              expectedRevision: saved.revision,
            });
            for (const filter of [
              trpc.variables.read.queryFilter({ action: 'inspect', id }),
              trpc.variables.read.queryFilter({ action: 'config_value', id }),
            ]) {
              await queryClient.cancelQueries(filter);
              queryClient.removeQueries(filter);
            }
          } else {
            const result = await api.variables.manage.mutate({
              action: 'update',
              id,
              expectedRevision: saved.revision,
              enabled: confirmation === 'enable',
            });
            await queryClient.cancelQueries(trpc.variables.read.pathFilter());
            queryClient.setQueriesData<Read>(
              trpc.variables.read.pathFilter(),
              (current) =>
                current &&
                'dependencies' in current &&
                'name' in result &&
                current.id === result.id &&
                current.revision <= result.revision
                  ? { ...current, ...result }
                  : current,
            );
          }
          void queryClient.invalidateQueries(trpc.variables.read.pathFilter());
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
    <PageHeader
      title={creating ? 'New variable' : (saved?.name ?? 'Variable')}
      status={saved ? (dirty ? 'Unsaved changes' : 'Saved') : undefined}
      onBack={() => void navigate(paths.variables)}
      backLabel="Back to variables"
      busy={busy}
      actions={
        (creating || saved) && (
          <>
            <Button disabled={busy || (!creating && !dirty)} onClick={discard}>
              {creating ? 'Cancel' : 'Discard changes'}
            </Button>
            {!creating && saved && (
              <Menu
                position="bottom-end"
                width={180}
                withinPortal
                returnFocus={confirmation !== 'delete'}
              >
                <Menu.Target>
                  <Button
                    variant="secondary"
                    ref={actionsTrigger}
                    rightSection={<ChevronDown size={16} aria-hidden="true" />}
                    disabled={busy}
                  >
                    Actions
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    color="red"
                    leftSection={<Trash2 size={14} />}
                    disabled={dirty || busy}
                    onClick={() => setConfirmation('delete')}
                  >
                    Delete variable
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
            <Button
              variant="primary"
              disabled={busy || !dirty || !name.trim()}
              type="submit"
              form={formId}
            >
              {creating ? 'Create' : 'Save changes'}
            </Button>
          </>
        )
      }
    />
  );
  if (!creating && !saved)
    return (
      <section className={workspacePage.page}>
        {header}
        <div className={workspacePage.content}>
          <div className={workspacePage.formContent}>
            {error ? (
              <Alert color="red" title="Could not load variable">
                {error}
                <Button
                  variant="ghost"
                  onClick={() => setRefresh((n) => n + 1)}
                >
                  Retry loading
                </Button>
              </Alert>
            ) : (
              <div>
                <LoadingSkeleton
                  label="Loading variable…"
                  className={workspacePage.card}
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
    <section className={workspacePage.page}>
      {header}
      <div className={workspacePage.content}>
        <div className={workspacePage.formContent}>
          {!confirmation && !rebind && (
            <ActionError message={error} className={styles.error} />
          )}
          <form
            id={formId}
            aria-label="Variable settings"
            className={workspacePage.card}
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
                    className={styles.usage}
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
          returnFocusTo={
            confirmation === 'delete' ? () => actionsTrigger.current : undefined
          }
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
