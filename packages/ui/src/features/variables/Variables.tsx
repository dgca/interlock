import {
  LoadingSkeleton,
  FormPlaceholder,
  Alert,
  Badge,
  Anchor,
  Button,
  Group,
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
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';

import { ArrowRight, Plus, Search, Trash2 } from 'lucide-react';
import { isConfirmedWriteRejection } from '../../lib/isConfirmedWriteRejection';
import type { AppContext } from '../../App';
import {
  variableRequirementSchema,
  variableRevisionConflict,
  type VariableBinding,
} from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery, useQueryClient } from '../../lib/query';
import { useDraftDismissal } from '../../lib/useDraftDismissal';
import { useEditorDraft } from '../../lib/useEditorDraft';

import { paths } from '../../routes/paths';
import layout from '../../components/PageLayout/PageLayout.module.css';

import { ListTable, ListTableRow } from '../../components/ListTable/ListTable';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';

import { VariableRowsSkeleton, variableTable } from './VariableListSkeleton';
import styles from './Variables.module.css';
import { VariablePicker } from './VariablePicker';

type Read = Awaited<ReturnType<typeof api.variables.read.query>>;
type Inspection = Extract<Read, { dependencies: unknown }>;
type ConfigValue = Extract<Read, { value: string }>;
class ConfigValueChangedError extends Error {
  constructor() {
    super(
      'The Config value changed while loading. Retry to load its current revision.',
    );
  }
}

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
    staleTime: Infinity,
    meta: { engineRefresh: false },
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<ConfigValue> => {
      const result = await api.variables.read.query(
        { action: 'config_value', id },
        { signal },
      );
      if (
        !('value' in result) ||
        result.id !== id ||
        typeof result.value !== 'string'
      )
        throw new Error('Could not read the config value.');
      if (result.valueRevision !== revision)
        throw new ConfigValueChangedError();
      return result;
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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const result = useQuery({
    ...trpc.variables.read.queryOptions({ action: 'list', search, offset }),
    enabled: search === debouncedSearch,
    select: (page) => {
      if (!('items' in page)) throw new Error('Could not read variables.');
      return page;
    },
  });
  const data = result.data;
  const read = workspaceRead('variables', result, searchInput);
  const loading = !read.ready && !read.error;
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
        <WorkspaceReadWarning reads={[read]} inline showDetails />
        {loading ? (
          <VariableRowsSkeleton />
        ) : data?.items.length ? (
          <ListTable {...variableTable} label="Variables">
            {data.items.map((v) => (
              <ListTableRow key={v.id}>
                <span className={styles.identity}>
                  <strong>
                    <Anchor
                      component={Link}
                      to={paths.variable(v.id)}
                      underline="hover"
                    >
                      {v.name}
                    </Anchor>
                  </strong>
                  {v.description && <small>{v.description}</small>}
                </span>
                <Badge variant="light" color="gray" size="sm">
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
  const { act } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const location = useLocation();
  const acknowledged = location.state?.savedVariable;
  const acknowledgedName: string | undefined =
    acknowledged?.id === id ? acknowledged.name : undefined;
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
      configReadOptions(initial.id, initial.valueRevision).queryKey,
    );
    return cachedValue && 'value' in cachedValue
      ? { revision: initial.valueRevision, value: cachedValue.value }
      : undefined;
  });
  const [configDraft, setConfigDraft] = useState<string>();
  const [valueRequired, setValueRequired] = useState(false);
  const [error, setError] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [unconfirmedWrite, setUnconfirmedWrite] = useState(false);
  const latestRequest = useRef<AbortController>(null);
  const [offset, setOffset] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [rebind, setRebind] = useState<{
    binding: VariableBinding;
    target: string;
  }>();
  const valueInput = useRef<HTMLTextAreaElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
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
    ? Boolean(name || description || value || kind !== 'secret')
    : !!saved &&
      (name !== saved.name ||
        description !== saved.description ||
        replacingSecret ||
        configChanged);
  const { busy: saving, beginSave, finishSave } = useEditorDraft(dirty);
  const busy = saving || loadingLatest;
  const conflict = error === variableRevisionConflict;
  const needsReload = conflict || (!creating && unconfirmedWrite);
  const readConfig = async (inspection: Inspection) => {
    if (inspection.kind !== 'config' || inspection.availability === 'locked')
      return undefined;
    if (
      saved?.id === inspection.id &&
      config?.revision === inspection.valueRevision
    )
      return config;
    if (inspection.valueRevision === null) return { revision: null, value: '' };
    const result = await queryClient.fetchQuery(
      configReadOptions(inspection.id, inspection.valueRevision),
    );
    return { revision: inspection.valueRevision, value: result.value };
  };
  const applyInspection = (
    inspection: Inspection,
    nextConfig: typeof config,
  ) => {
    setSaved(inspection);
    setConfig(nextConfig);
    setConfigDraft(undefined);
    setName(inspection.name);
    setDescription(inspection.description);
    setKind(inspection.kind);
  };
  const readEnabled = !creating && !dirty && !busy && !needsReload;
  const inspection = useQuery({
    ...trpc.variables.read.queryOptions({ action: 'inspect', id, offset }),
    enabled: readEnabled,
    select: (data) => {
      if (!('dependencies' in data) || (data.referenceId ?? data.id) !== id)
        throw new Error('Could not read variable details.');
      return data;
    },
  });
  const observed = inspection.data;
  const configRevision =
    observed?.kind === 'config' && observed.availability !== 'locked'
      ? observed.valueRevision
      : undefined;
  const configRead = useQuery({
    ...configReadOptions(observed?.id ?? id, configRevision ?? 0),
    enabled: readEnabled && typeof configRevision === 'number',
  });
  const readError =
    recoveryError || (inspection.error ? errorMessage(inspection.error) : '');
  const configError = configRead.error ? errorMessage(configRead.error) : '';
  const retryDetails = () => void inspection.refetch({ cancelRefetch: false });
  const retryConfig = () => {
    if (configRead.error instanceof ConfigValueChangedError) retryDetails();
    else void configRead.refetch({ cancelRefetch: false });
  };
  useEffect(() => () => latestRequest.current?.abort(), []);
  useEffect(() => {
    if (
      !readEnabled ||
      !observed ||
      (saved?.id === observed.id && observed.revision < saved.revision)
    )
      return;
    const currentConfig = saved?.id === observed.id ? config : undefined;
    let nextConfig: typeof config;
    if (configRevision === null) {
      nextConfig =
        currentConfig?.revision === null
          ? currentConfig
          : { revision: null, value: '' };
    } else if (configRevision !== undefined) {
      if (currentConfig?.revision === configRevision)
        nextConfig = currentConfig;
      else if (configRead.data)
        nextConfig = { revision: configRevision, value: configRead.data.value };
      else if (configRead.error) nextConfig = currentConfig;
      else if (!saved || saved.id === observed.id) return;
    }
    applyInspection(observed, nextConfig);
  }, [
    readEnabled,
    observed,
    configRevision,
    configRead.data,
    configRead.error,
    config,
    saved,
  ]);
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
  const loadLatest = async () => {
    if (!saved || latestRequest.current) return;
    const request = new AbortController();
    latestRequest.current = request;
    setLoadingLatest(true);
    setRecoveryError('');
    try {
      const input = { action: 'inspect' as const, id: saved.id, offset };
      const latest = await api.variables.read.query(input, {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      if (
        !('dependencies' in latest) ||
        latest.id !== saved.id ||
        latest.revision < saved.revision ||
        (!unconfirmedWrite && latest.revision === saved.revision)
      )
        throw new Error('Could not read the latest revision. Try again.');
      const nextConfig = await readConfig(latest);
      if (request.signal.aborted) return;
      const key = trpc.variables.read.queryKey(input);
      const cached = queryClient.getQueryData(key);
      if (
        cached &&
        'dependencies' in cached &&
        latest.revision < cached.revision
      )
        throw new Error('Could not read the latest revision. Try again.');
      void queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, latest);
      setUnconfirmedWrite(false);
      if (latest.revision === saved.revision) {
        setError(
          'The saved variable revision is unchanged. Your draft is ready to save again.',
        );
        return;
      }
      clear();
      applyInspection(latest, nextConfig);
    } catch (error) {
      if (!request.signal.aborted) setRecoveryError(errorMessage(error));
    } finally {
      if (!request.signal.aborted) {
        latestRequest.current = null;
        setLoadingLatest(false);
      }
    }
  };
  const recovery = useDraftDismissal(dirty, busy, () => void loadLatest());
  const save = async () => {
    if (busy || needsReload || unconfirmedWrite || !dirty || !name.trim())
      return;
    if (replacingSecret && !value) {
      setValueRequired(true);
      valueInput.current?.focus();
      return;
    }
    if (!beginSave()) return;
    setError('');
    let result: Extract<
      Awaited<ReturnType<typeof api.variables.manage.mutate>>,
      { name: string }
    >;
    try {
      const receipt = await api.variables.manage.mutate(
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
              id: saved!.id,
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
      if (!('name' in receipt))
        throw new Error('The saved variable was not returned.');
      result = receipt;
    } catch (error) {
      if (!finishSave(false)) return;
      const message = errorMessage(error);
      if (
        message === variableRevisionConflict ||
        isConfirmedWriteRejection(error)
      ) {
        setError(message);
      } else {
        setUnconfirmedWrite(true);
        setError(
          creating
            ? 'Interlock could not confirm whether the variable was created. Check Variables before creating it again.'
            : 'Interlock could not confirm whether the variable was saved. Load latest to check the saved revision.',
        );
      }
      return;
    }
    await act(async () => {
      const active = finishSave(true);
      if (active) {
        // Clear write-only input before any related read is refreshed.
        returnToValue.current = replacingSecret;
        setValue('');
        setReplacingSecret(false);
        setValueRequired(false);
        setConfigDraft(undefined);
        setName(result.name);
        setDescription(result.description);
        if (saved) {
          setSaved({ ...saved, ...result });
          if (configChanged)
            setConfig({
              revision: result.valueRevision,
              value: configDraft!,
            });
        }
      }
      const matchesSaved = (current: Read | undefined): current is Inspection =>
        Boolean(
          current &&
          'dependencies' in current &&
          current.id === result.id &&
          current.revision <= result.revision,
        );
      const inspectionIds =
        !creating && id !== result.id ? [result.id, id] : [result.id];
      for (const inspectionId of inspectionIds) {
        const filter = trpc.variables.read.queryFilter({
          action: 'inspect',
          id: inspectionId,
        });
        // A portable reference can change targets while the write is pending.
        void queryClient.cancelQueries({
          ...filter,
          predicate: ({ queryKey }) =>
            inspectionId === result.id ||
            matchesSaved(queryClient.getQueryData(queryKey)),
        });
        queryClient.setQueriesData<Read>(filter, (current) =>
          matchesSaved(current)
            ? { ...current, ...result, referenceId: current.referenceId }
            : undefined,
        );
      }
      if (result.kind === 'config' && result.valueRevision !== null) {
        const savedValue = creating
          ? value
          : configChanged
            ? configDraft
            : undefined;
        if (savedValue !== undefined)
          queryClient.setQueryData<ConfigValue>(
            configReadOptions(result.id, result.valueRevision).queryKey,
            {
              id: result.id,
              valueRevision: result.valueRevision,
              value: savedValue,
            },
          );
      }
      if (active && creating)
        void navigate(paths.variable(result.id), {
          replace: true,
          state: { savedVariable: { id: result.id, name: result.name } },
        });
    });
  };
  const change = async () => {
    if (!saved || busy || (!rebind && !deleting) || !beginSave()) return;
    setError('');
    await act(
      async () => {
        if (rebind) {
          await api.variables.manage.mutate({
            action: 'bind',
            id: rebind.binding.id,
            variableId: rebind.target,
            kind: rebind.binding.kind,
            expectedRevision: rebind.binding.revision,
          });
        } else {
          await api.variables.manage.mutate({
            action: 'delete',
            id: saved.id,
            expectedRevision: saved.revision,
          });
          for (const filter of [
            trpc.variables.read.queryFilter({
              action: 'inspect',
              id: saved.id,
            }),
            trpc.variables.read.queryFilter({
              action: 'config_value',
              id: saved.id,
            }),
            ...(id === saved.id
              ? []
              : [trpc.variables.read.queryFilter({ action: 'inspect', id })]),
          ]) {
            void queryClient.cancelQueries(filter);
            queryClient.removeQueries(filter);
          }
        }
        if (!finishSave(true)) return;
        setDeleting(false);
        setRebind(undefined);
        if (deleting) void navigate(paths.variables);
      },
      rebind ? 'Binding updated.' : 'Variable updated.',
      (message) => {
        if (finishSave(false)) setError(message);
      },
    );
  };
  const discard = () => {
    if (creating) void navigate(paths.variables);
    else if (needsReload) recovery.dismiss();
    else clear();
  };
  const header = (
    <PageHeader
      title={
        creating
          ? 'New variable'
          : (saved?.name ?? acknowledgedName ?? 'Variable')
      }
      status={
        dirty
          ? 'Unsaved changes'
          : saved || acknowledgedName
            ? 'Saved'
            : undefined
      }
      onBack={() => void navigate(paths.variables)}
      backLabel="Back to variables"
      busy={busy}
      actions={
        (creating || saved) && (
          <>
            <Button
              disabled={busy || (!creating && !dirty && !needsReload)}
              loading={loadingLatest}
              onClick={discard}
            >
              {needsReload
                ? 'Load latest'
                : creating
                  ? 'Cancel'
                  : 'Discard changes'}
            </Button>
            {!creating && saved && (
              <Button
                variant="secondary"
                ref={deleteTrigger}
                aria-label="Delete variable"
                leftSection={<Trash2 size={16} aria-hidden="true" />}
                disabled={dirty || busy || needsReload}
                onClick={() => setDeleting(true)}
              >
                Delete
              </Button>
            )}
            <Button
              variant="primary"
              disabled={
                busy ||
                !dirty ||
                needsReload ||
                unconfirmedWrite ||
                !name.trim()
              }
              loading={saving && !deleting && !rebind}
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
            {readError ? (
              <Alert
                color="red"
                title={
                  acknowledgedName
                    ? 'Could not refresh variable'
                    : 'Could not load variable'
                }
              >
                {readError}
                <Button variant="ghost" onClick={retryDetails}>
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
            if (!needsReload) setError('');
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
          {!deleting && !rebind && (
            <ActionError
              message={
                conflict
                  ? 'This variable changed elsewhere. Your edits are still here.'
                  : error
              }
              className={styles.error}
            />
          )}
          {creating && unconfirmedWrite && (
            <Button
              component={Link}
              to={paths.variables}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              mb="md"
            >
              Check Variables in a new tab
            </Button>
          )}
          {readError && (
            <Alert
              color="red"
              mb="md"
              title={
                needsReload
                  ? 'Could not load the latest variable'
                  : 'Could not refresh variable'
              }
            >
              {readError}
              {!needsReload && (
                <Button
                  variant="ghost"
                  disabled={dirty || busy}
                  onClick={retryDetails}
                >
                  Retry variable details
                </Button>
              )}
            </Alert>
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
                          disabled={
                            !config || config.revision !== saved.valueRevision
                          }
                          value={configDraft ?? config?.value ?? ''}
                          error={configError || undefined}
                          description={
                            saved.valueRevision === null
                              ? 'Value not set'
                              : undefined
                          }
                          onChange={(e) => setConfigDraft(e.target.value)}
                        />
                        {configError && (
                          <Button
                            variant="ghost"
                            disabled={dirty || busy}
                            onClick={retryConfig}
                          >
                            Retry Config value
                          </Button>
                        )}
                        {saved.valueRevision === null &&
                          config?.revision === null &&
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
                        This variable is disabled. Restore access with the CLI.
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
      {recovery.confirmation}
      {(deleting || rebind) && saved && (
        <Modal
          title={rebind ? 'Change portable binding' : 'Delete variable'}
          busy={busy}
          returnFocusTo={deleting ? () => deleteTrigger.current : undefined}
          onClose={() => {
            if (!busy) {
              setDeleting(false);
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
              ) : (
                <Text size="sm">
                  {blocked
                    ? 'This variable is still referenced. Remove draft and retained published references and finish active runs or comparisons before deletion.'
                    : 'Delete this variable and its protected value revisions? Historical metadata remains. Backups may retain encrypted values.'}
                </Text>
              )}
              <ActionError message={error} className={styles.error} />
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button
              disabled={busy}
              onClick={() => {
                setDeleting(false);
                setRebind(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              variant={deleting ? 'danger' : 'primary'}
              disabled={
                busy ||
                (deleting && blocked) ||
                (!!rebind &&
                  (!rebind.target ||
                    rebind.target === rebind.binding.variableId))
              }
              onClick={() => void change()}
            >
              {busy ? 'Saving…' : rebind ? 'Change binding' : 'Delete variable'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}
