import {
  Alert,
  Button,
  Checkbox,
  MultiSelect,
  NativeSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  TextInput,
  FormPlaceholder,
  PageHeader,
  workspacePage,
  JsonEditor,
  ActionError,
} from '../../design-system';

import { useEffect, useId, useRef, useState } from 'react';
import { isConfirmedWriteRejection } from '../../lib/isConfirmedWriteRejection';
import { Link, useNavigate, useSearchParams } from 'react-router';

import {
  assertContract,
  eventConfigSchema,
  scheduleConfigSchema,
  scheduleInput,
  triggerConfig,
  triggerRevisionConflict,
  type Json,
  type WorkflowVersion,
  type WorkflowCatalogEntry,
} from '@interlock/core';

import { SchemaInput } from '../../components/SchemaInput/SchemaInput';

import { useDraftDismissal } from '../../lib/useDraftDismissal';
import { useEditorDraft } from '../../lib/useEditorDraft';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery, useQueryClient } from '../../lib/query';
import { paths } from '../../routes/paths';
import {
  eventLabels,
  initialConfig,
  itemHref,
  returnHref,
  timestamp,
  timingLabel,
  type AutomationConfig,
  type Inspection,
} from './model';
import classes from './Automations.module.css';

function literalInputSchema(schema: Record<string, unknown>, paths: string[]) {
  const result = structuredClone(schema);
  for (const path of paths) {
    let current = result;
    const parts = path.split('.');
    for (const [index, key] of parts.entries()) {
      const properties = current.properties as
        Record<string, unknown> | undefined;
      if (!properties || !Object.hasOwn(properties, key)) break;
      if (index === parts.length - 1) {
        properties[key] = {};
        break;
      }
      const child = properties[key];
      if (!child || typeof child !== 'object' || Array.isArray(child)) break;
      current = child as Record<string, unknown>;
    }
  }
  return result;
}

function defaultInput(schema: Record<string, unknown>): Json {
  if (schema.default !== undefined) return schema.default as Json;
  if (schema.type === 'object') {
    const properties = (schema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    return Object.fromEntries(
      Object.entries(properties).flatMap(([key, property]) =>
        property.default !== undefined ||
        (schema.required as string[] | undefined)?.includes(key)
          ? [[key, defaultInput(property)]]
          : [],
      ),
    );
  }
  if (Array.isArray(schema.enum) && schema.enum.length)
    return schema.enum[0] as Json;
  return schema.type === 'string'
    ? ''
    : schema.type === 'number' || schema.type === 'integer'
      ? 0
      : schema.type === 'boolean'
        ? false
        : schema.type === 'array'
          ? []
          : null;
}

function defaultTimingDrafts() {
  return {
    interval: { type: 'interval' as const, intervalMs: 300000 },
    cron: {
      type: 'cron' as const,
      expression: '0 9 * * 1-5',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

type VersionRead = {
  workflowId: string;
  expectedVersion: number;
  attempt: number;
  version?: WorkflowVersion;
  error?: string;
};

export function AutomationEditor({
  id,
  kind = 'schedule',
  workflows,
}: {
  id?: string;
  kind?: 'schedule' | 'event';
  workflows: WorkflowCatalogEntry[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search] = useSearchParams();
  const [config, setConfig] = useState<AutomationConfig>(() =>
    initialConfig(kind),
  );
  const [workflowId, setWorkflowId] = useState(
    id ? '' : (search.get('workflow') ?? ''),
  );
  const [enableOnCreate, setEnableOnCreate] = useState(false);
  const [revision, setRevision] = useState<number>();
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [readAttempt, setReadAttempt] = useState(0);
  const [unconfirmedCreation, setUnconfirmedCreation] = useState(false);
  const [unconfirmedUpdate, setUnconfirmedUpdate] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [inputValid, setInputValid] = useState(true);
  const [versionRead, setVersionRead] = useState<VersionRead>();
  const [reload, setReload] = useState(0);
  const [inputPresentation, setInputPresentation] = useState<{
    key: string;
    schema: Record<string, unknown> | undefined;
  }>();
  const [upcoming, setUpcoming] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState('');
  const previousWorkflow = useRef<{ id: string; version: number } | undefined>(
    undefined,
  );
  const formId = useId();
  const timingDrafts = useRef(defaultTimingDrafts());
  const initialNewState = useRef({
    config: initialConfig(kind),
    workflowId: search.get('workflow') ?? '',
    enableOnCreate: false,
  });
  const workflow = workflows.find((w) => w.id === workflowId);
  const catalogVersion = workflow?.latestVersion ?? 0;
  const observedVersion =
    versionRead?.workflowId === workflowId && versionRead.attempt === reload
      ? versionRead
      : undefined;
  const readDraft =
    config.kind === 'schedule' &&
    catalogVersion === 0 &&
    observedVersion?.expectedVersion === 0 &&
    !observedVersion.error &&
    !observedVersion.version;
  const draftContract = useQuery(
    trpc.workflows.get.queryOptions({ id: workflowId }, { enabled: readDraft }),
  );
  const expectedVersion = Math.max(
    catalogVersion,
    draftContract.data?.latestVersion ?? 0,
  );
  const current = JSON.stringify({ config, workflowId, enableOnCreate });
  const dirty =
    !inputValid ||
    (id
      ? !!baseline && current !== baseline
      : current !== JSON.stringify(initialNewState.current));
  const { busy: saving, beginSave, finishSave } = useEditorDraft(dirty);
  const busy = saving || loading;
  const conflict = Boolean(id && error === triggerRevisionConflict);
  const needsReload = conflict || unconfirmedUpdate;
  const reloadSettings = () => {
    setLoading(true);
    setReadError('');
    setReadAttempt((n) => n + 1);
  };
  const recovery = useDraftDismissal(dirty, busy, reloadSettings);
  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    void api.triggers.inspect
      .query({ id })
      .then(
        (inspection) => {
          if (!active) return;
          const { trigger } = inspection;
          const key = trpc.triggers.inspect.queryKey({
            id,
            offset: 0,
            limit: 20,
          });
          const cached = queryClient.getQueryData(key);
          if (
            (revision !== undefined &&
              (trigger.revision < revision ||
                (!unconfirmedUpdate && trigger.revision === revision))) ||
            trigger.revision < (cached?.trigger.revision ?? 0)
          ) {
            setReadError(
              'Could not read the latest automation settings. Try again.',
            );
            return;
          }
          void queryClient.cancelQueries({ queryKey: key, exact: true });
          queryClient.setQueryData(key, inspection);
          setUnconfirmedUpdate(false);
          if (trigger.revision === revision) {
            setError(
              'The saved automation revision is unchanged. Your draft is ready to save again.',
            );
            return;
          }
          const next = triggerConfig(trigger) as AutomationConfig;
          timingDrafts.current = defaultTimingDrafts();
          setConfig(next);
          setWorkflowId(trigger.workflowId);
          setRevision(trigger.revision);
          setInputValid(true);
          setInputPresentation(undefined);
          setIssues({});
          setBaseline(
            JSON.stringify({
              config: next,
              workflowId: trigger.workflowId,
              enableOnCreate: false,
            }),
          );
          setError('');
        },
        (e) => {
          if (active) setReadError(errorMessage(e));
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, readAttempt]);
  useEffect(() => {
    if (!workflowId) return;
    let active = true;
    const request = { workflowId, expectedVersion, attempt: reload };
    void api.workflows.versions.query({ id: workflowId }).then(
      (versions) => {
        if (!active) return;
        const latest = versions
          .filter((version) => version.workflowId === workflowId)
          .sort((a, b) => b.version - a.version)[0];
        const previous = previousWorkflow.current;
        const minimumVersion = Math.max(
          expectedVersion,
          previous?.id === workflowId ? previous.version : 0,
        );
        if ((latest?.version ?? 0) < minimumVersion) {
          setVersionRead({
            ...request,
            error: 'Could not read the latest workflow contract. Try again.',
          });
          return;
        }
        if (!id && previous?.id !== workflowId && latest) {
          const input = defaultInput(latest.definition.inputSchema);
          const initial = initialNewState.current;
          if (
            initial.workflowId === workflowId &&
            initial.config.kind === 'schedule'
          )
            initialNewState.current = {
              ...initial,
              config: { ...initial.config, input },
            };
          setConfig((c) => (c.kind === 'schedule' ? { ...c, input } : c));
        }
        previousWorkflow.current = {
          id: workflowId,
          version: latest?.version ?? 0,
        };
        setVersionRead({ ...request, version: latest });
      },
      (error) => {
        if (active)
          setVersionRead({
            ...request,
            error:
              errorMessage(error) || 'Could not read the workflow contract.',
          });
      },
    );
    return () => {
      active = false;
    };
  }, [workflowId, expectedVersion, reload]);
  const timingKey =
    config.kind === 'schedule' ? JSON.stringify(config.timing) : '';
  useEffect(() => {
    setUpcoming([]);
    setPreviewError('');
    if (config.kind !== 'schedule') return;
    let active = true;
    const timer = setTimeout(() => {
      void api.triggers.preview.query({ timing: config.timing }).then(
        (result) => {
          if (active) setUpcoming(result.upcoming);
        },
        (e) => {
          if (active) setPreviewError(errorMessage(e));
        },
      );
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [timingKey]);
  const patch = (changes: Partial<AutomationConfig>) => {
    setConfig((current) => ({ ...current, ...changes }) as AutomationConfig);
    setIssues({});
    if (!needsReload && !unconfirmedCreation) setError('');
  };
  const back = id ? itemHref(id, search) : returnHref(search);
  const currentRead =
    observedVersion?.expectedVersion === expectedVersion
      ? observedVersion
      : undefined;
  const published = currentRead?.version;
  const contractError = currentRead?.error;
  const needsDraftContract = readDraft && currentRead !== undefined;
  const loadingContract =
    (Boolean(workflowId) && !currentRead) ||
    (needsDraftContract &&
      (draftContract.isPending || draftContract.isFetching));
  const contractFailure =
    contractError ||
    (needsDraftContract && draftContract.error
      ? errorMessage(draftContract.error) ||
        'Could not read the workflow contract.'
      : '');
  const schema =
    published?.definition.inputSchema ??
    (needsDraftContract ? draftContract.data?.draft.inputSchema : undefined);
  const inputKey = `${workflowId}:${revision ?? 'new'}`;
  const previousInput =
    inputPresentation?.key === inputKey ? inputPresentation : undefined;
  // Retain the current controls through refresh. A contract that changes a
  // control's type can take effect after its local JSON is valid again.
  const useCurrentInput =
    config.kind === 'schedule' &&
    Boolean(workflowId) &&
    !loadingContract &&
    !contractFailure &&
    inputValid;
  const inputSchema = useCurrentInput ? schema : previousInput?.schema;
  useEffect(() => {
    if (useCurrentInput) setInputPresentation({ key: inputKey, schema });
  }, [useCurrentInput, inputKey, schema]);
  const save = async () => {
    if (
      busy ||
      needsReload ||
      unconfirmedCreation ||
      (id && (!baseline || !dirty))
    )
      return;
    setError('');
    setIssues({});
    const parsed =
      config.kind === 'schedule'
        ? scheduleConfigSchema.safeParse(config)
        : eventConfigSchema.safeParse(config);
    if (!parsed.success) {
      setIssues(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join('.'),
            issue.message,
          ]),
        ),
      );
      setError('Check the highlighted fields.');
      return;
    }
    if (!workflowId || !inputValid) {
      setError(
        !workflowId
          ? 'Choose a workflow to start.'
          : 'Enter valid workflow inputs.',
      );
      return;
    }
    if (contractFailure || loadingContract) {
      setError('Wait for the workflow contract to load, or retry loading it.');
      return;
    }
    try {
      if (parsed.data.kind === 'schedule' && schema) {
        // Populate only bound paths, preserving validation of literal siblings.
        const paths = Object.values(parsed.data.bindings).filter(
          (path): path is string => !!path,
        );
        const input = paths.length
          ? scheduleInput(parsed.data, {
              scheduledAt: null,
              firedAt: null,
              triggerId: null,
              previousRunId: null,
            })
          : parsed.data.input;
        assertContract(
          literalInputSchema(schema, paths),
          input,
          'Workflow inputs',
        );
      }
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    if (!beginSave()) return;
    try {
      const result = await api.triggers.manage.mutate(
        id
          ? {
              action: 'update',
              id,
              expectedRevision: revision!,
              config: parsed.data,
            }
          : {
              action: 'create',
              workflowId,
              config: parsed.data,
              enabled: enableOnCreate,
            },
      );
      if (!result.trigger)
        throw new Error('The saved automation was not returned.');
      const saved = result.trigger;
      const filter = trpc.triggers.inspect.queryFilter({ id: saved.id });
      void queryClient.cancelQueries(filter);
      queryClient.setQueriesData<Inspection>(filter, (previous) =>
        previous?.trigger.id === saved.id &&
        previous.trigger.revision <= saved.revision
          ? ({
              ...previous,
              trigger: { ...previous.trigger, ...saved },
            } as Inspection)
          : previous,
      );
      void queryClient.invalidateQueries(trpc.triggers.pathFilter(), {
        cancelRefetch: false,
      });
      if (finishSave(true))
        void navigate(itemHref(saved.id, search), {
          replace: !id,
          state: { savedAutomation: { id: saved.id, name: saved.name } },
        });
    } catch (error) {
      if (!finishSave(false)) return;
      const message = errorMessage(error);
      if (
        message === triggerRevisionConflict ||
        isConfirmedWriteRejection(error)
      ) {
        setError(message);
      } else if (id) {
        setUnconfirmedUpdate(true);
        setError(
          'Interlock could not confirm whether the automation was saved. Load latest to check the saved settings.',
        );
      } else {
        setUnconfirmedCreation(true);
        setError(
          'Interlock could not confirm whether the automation was created. Check Automations before creating it again.',
        );
      }
    }
  };
  const label = id ? 'Save changes' : 'Create';
  const zone =
    config.kind === 'schedule' && config.timing.type === 'cron'
      ? config.timing.timeZone
      : undefined;
  const terminalOnly =
    config.kind === 'event' &&
    config.events.every((e) =>
      ['completed', 'failed', 'cancelled'].includes(e),
    );
  const sourceId =
    config.kind === 'event' && config.scope.type === 'workflow'
      ? config.scope.workflowId
      : undefined;
  const source =
    config.kind === 'event' && config.scope.type === 'workflow'
      ? workflows.find((w) => w.id === sourceId)
      : undefined;
  const workflowOptions = workflows
    .filter((w) => !w.archived || w.id === workflowId)
    .map((w) => ({ value: w.id, label: w.name }));
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title={
          id
            ? config.name || 'Edit automation'
            : config.kind === 'event'
              ? 'New Interlock event'
              : 'New schedule'
        }
        status={dirty ? 'Unsaved changes' : baseline ? 'Saved' : undefined}
        onBack={() => void navigate(back)}
        backLabel={id ? 'Back to automation' : 'Back to automations'}
        busy={busy}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={busy}
              loading={needsReload && loading}
              onClick={
                needsReload ? recovery.dismiss : () => void navigate(back)
              }
            >
              {needsReload
                ? 'Load latest'
                : id && dirty
                  ? 'Discard changes'
                  : 'Cancel'}
            </Button>
            <Button
              variant="primary"
              form={formId}
              type="submit"
              loading={saving}
              disabled={
                busy ||
                needsReload ||
                unconfirmedCreation ||
                loadingContract ||
                Boolean(contractFailure) ||
                (!!id && (!baseline || !dirty))
              }
            >
              {label}
            </Button>
          </>
        }
      />
      <div className={classes.editor}>
        <div className={classes.formWorkspace}>
          {loading && !baseline ? (
            <FormPlaceholder />
          ) : id && !baseline ? (
            <Alert color="red" title="Could not load automation">
              {readError}
              <Button variant="ghost" onClick={reloadSettings}>
                Retry loading
              </Button>
            </Alert>
          ) : (
            <form
              id={formId}
              className={`${workspacePage.card} ${classes.form}`}
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset
                disabled={busy}
                style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
              >
                <TextInput
                  label="Name"
                  required
                  maxLength={120}
                  value={config.name}
                  error={issues.name}
                  onChange={(event) =>
                    patch({ name: event.currentTarget.value })
                  }
                />
                <TextInput
                  mt="md"
                  label="Run title"
                  maxLength={200}
                  value={config.runTitle ?? ''}
                  error={issues.runTitle}
                  onChange={(event) =>
                    patch({ runTitle: event.currentTarget.value || undefined })
                  }
                />
                <section className={workspacePage.section}>
                  <h2>When</h2>
                  <div className={classes.fields}>
                    {config.kind === 'schedule' ? (
                      <>
                        <SegmentedControl
                          aria-label="Timing mode"
                          value={config.timing.type}
                          onChange={(value) => {
                            if (config.timing.type === 'cron')
                              timingDrafts.current.cron = config.timing;
                            else timingDrafts.current.interval = config.timing;
                            patch({
                              timing:
                                value === 'cron'
                                  ? timingDrafts.current.cron
                                  : timingDrafts.current.interval,
                            });
                          }}
                          data={[
                            { value: 'interval', label: 'Interval' },
                            { value: 'cron', label: 'Cron' },
                          ]}
                          style={{ width: 244, maxWidth: '100%' }}
                        />
                        {config.timing.type === 'interval' ? (
                          <IntervalInput
                            key={revision}
                            intervalMs={config.timing.intervalMs}
                            onChange={(intervalMs) =>
                              patch({
                                timing: { type: 'interval', intervalMs },
                              })
                            }
                            error={issues['timing.intervalMs']}
                          />
                        ) : (
                          <div className={classes.fieldRow}>
                            <TextInput
                              label="Cron expression"
                              required
                              value={config.timing.expression}
                              placeholder="0 9 * * 1-5"
                              error={issues['timing.expression']}
                              onChange={(event) =>
                                config.timing.type === 'cron' &&
                                patch({
                                  timing: {
                                    ...config.timing,
                                    expression: event.currentTarget.value,
                                  },
                                })
                              }
                            />
                            <TextInput
                              label="Timezone"
                              required
                              value={config.timing.timeZone}
                              placeholder="America/Denver"
                              error={issues['timing.timeZone']}
                              onChange={(event) =>
                                config.timing.type === 'cron' &&
                                patch({
                                  timing: {
                                    ...config.timing,
                                    timeZone: event.currentTarget.value,
                                  },
                                })
                              }
                            />
                          </div>
                        )}
                        <NativeSelect
                          label="If a previous run is still in progress"
                          value={config.overlapPolicy}
                          onChange={(event) =>
                            patch({
                              overlapPolicy: event.currentTarget.value as
                                'skip' | 'queue' | 'allow',
                            })
                          }
                          data={[
                            { value: 'skip', label: 'Skip this occurrence' },
                            { value: 'queue', label: 'Queue one run' },
                            { value: 'allow', label: 'Allow overlap' },
                          ]}
                        />
                        {config.overlapPolicy === 'queue' && (
                          <p className={classes.hint}>
                            Keep at most one pending run from this automation.
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <Select
                          label="Watch runs from"
                          searchable
                          required
                          value={
                            config.scope.type === 'library'
                              ? '__library__'
                              : config.scope.workflowId || null
                          }
                          data={[
                            { value: '__library__', label: 'Any workflow' },
                            ...workflowOptions,
                          ]}
                          onChange={(value) =>
                            patch({
                              exitNodeId:
                                value === '__library__'
                                  ? undefined
                                  : config.exitNodeId,
                              scope:
                                value === '__library__'
                                  ? { type: 'library' }
                                  : {
                                      type: 'workflow',
                                      workflowId: value ?? '',
                                      includeChildren:
                                        config.scope.type === 'workflow' &&
                                        config.scope.includeChildren,
                                    },
                            })
                          }
                          error={issues['scope.workflowId']}
                        />
                        <MultiSelect
                          label="When a run"
                          required
                          value={config.events}
                          data={Object.entries(eventLabels).map(
                            ([value, label]) => ({ value, label }),
                          )}
                          onChange={(events) =>
                            patch({
                              events: events as typeof config.events,
                              exitNodeId:
                                events.length === 1 && events[0] === 'completed'
                                  ? config.exitNodeId
                                  : undefined,
                              waitForQuiescence:
                                events.every((e) =>
                                  ['completed', 'failed', 'cancelled'].includes(
                                    e,
                                  ),
                                ) && config.waitForQuiescence,
                            })
                          }
                          error={issues.events}
                        />
                        {config.scope.type === 'workflow' && (
                          <Checkbox
                            label="Include owned child workflows"
                            checked={config.scope.includeChildren}
                            onChange={(event) =>
                              config.scope.type === 'workflow' &&
                              patch({
                                scope: {
                                  ...config.scope,
                                  includeChildren: event.currentTarget.checked,
                                },
                              })
                            }
                          />
                        )}
                        {config.exitNodeId !== undefined && (
                          <TextInput
                            label="Completed Exit node ID"
                            value={config.exitNodeId}
                            description="Existing completion filter. Clear to remove it."
                            error={issues.exitNodeId}
                            onChange={(event) =>
                              patch({
                                exitNodeId:
                                  event.currentTarget.value || undefined,
                              })
                            }
                          />
                        )}
                      </>
                    )}
                  </div>
                </section>
                <section className={workspacePage.section}>
                  <h2>Start workflow</h2>
                  <div className={classes.fields}>
                    <Select
                      label="Workflow"
                      searchable
                      required
                      disabled={!!id}
                      value={workflowId || null}
                      data={workflowOptions}
                      onChange={(value) => {
                        const next = value ?? '';
                        if (next === workflowId) return;
                        setWorkflowId(next);
                        setVersionRead(undefined);
                        setInputValid(true);
                        setInputPresentation(undefined);
                      }}
                      error={issues.workflowId}
                    />
                    {contractFailure ? (
                      <Alert color="red">
                        {contractFailure}
                        <Button
                          variant="ghost"
                          disabled={!contractError && draftContract.isFetching}
                          onClick={() => {
                            if (contractError) setReload((n) => n + 1);
                            else
                              void draftContract.refetch({
                                cancelRefetch: false,
                              });
                          }}
                        >
                          Retry contract
                        </Button>
                      </Alert>
                    ) : (
                      workflow && (
                        <p className={classes.hint}>
                          {loadingContract ? (
                            'Loading workflow contract…'
                          ) : published ? (
                            `Starts the latest published version, currently v${published.version}.`
                          ) : (
                            <>
                              Publish this workflow before enabling.{' '}
                              <Link to={paths.workflow(workflow.id)}>
                                Open workflow
                              </Link>
                            </>
                          )}
                        </p>
                      )
                    )}
                    {config.kind === 'event' && (
                      <Checkbox
                        label="Wait until all source work has stopped"
                        checked={config.waitForQuiescence}
                        disabled={!terminalOnly}
                        onChange={(event) =>
                          patch({
                            waitForQuiescence: event.currentTarget.checked,
                          })
                        }
                        description={
                          terminalOnly
                            ? 'Includes detached runs and external work awaiting stop confirmation. Useful before cleanup.'
                            : 'Available for completed, failed, and cancelled events.'
                        }
                      />
                    )}
                  </div>
                </section>
                <section className={workspacePage.section}>
                  <h2>
                    {config.kind === 'event'
                      ? 'Workflow input'
                      : 'Workflow inputs'}
                  </h2>
                  {config.kind === 'event' ? (
                    <>
                      <p className={classes.hint}>
                        The workflow receives the source run identity, event,
                        stage, and error details when available.
                      </p>
                      <details>
                        <summary>Event fields</summary>
                        <p className={classes.hint}>
                          eventId, type, occurredAt, runId, workflowId, version;
                          available tags, externalTask, stage, waiting, failing
                          node, and error. Source inputs and outputs are
                          excluded.
                        </p>
                      </details>
                    </>
                  ) : !useCurrentInput && !previousInput ? (
                    loadingContract ? (
                      <FormPlaceholder />
                    ) : !workflowId ? (
                      <p className={classes.hint}>
                        Choose a workflow to configure its inputs.
                      </p>
                    ) : null
                  ) : inputSchema?.type === 'object' &&
                    inputSchema.properties &&
                    config.input !== null &&
                    typeof config.input === 'object' &&
                    !Array.isArray(config.input) ? (
                    <SchemaInput
                      key={inputKey}
                      schema={inputSchema}
                      value={config.input}
                      onChange={(input) => patch({ input })}
                      onValidityChange={setInputValid}
                      disabledKeys={Object.values(config.bindings).flatMap(
                        (path) => (path && !path.includes('.') ? [path] : []),
                      )}
                    />
                  ) : (
                    <JsonEditor
                      key={inputKey}
                      label="Workflow input"
                      value={config.input}
                      onChange={(input) => patch({ input })}
                      onValidityChange={setInputValid}
                    />
                  )}
                  {config.kind === 'schedule' &&
                    Object.values(config.bindings).some(Boolean) && (
                      <p className={classes.hint}>
                        Schedule metadata replaces only its bound input paths at
                        runtime. Other input fields remain editable. Existing
                        bindings are preserved.
                      </p>
                    )}
                </section>
                {!id && (
                  <div className={classes.activation}>
                    <Checkbox
                      label="Enable when created"
                      checked={enableOnCreate}
                      onChange={(event) =>
                        setEnableOnCreate(event.currentTarget.checked)
                      }
                    />
                  </div>
                )}
                <ActionError
                  message={
                    conflict
                      ? 'This automation changed elsewhere. Your edits are still here.'
                      : error
                  }
                />
                {needsReload && <ActionError message={readError} />}
                {unconfirmedCreation && (
                  <Button
                    component={Link}
                    to={paths.automations}
                    target="_blank"
                    rel="noreferrer"
                    variant="secondary"
                  >
                    Check Automations in a new tab
                  </Button>
                )}
              </fieldset>
            </form>
          )}
        </div>
        <aside className={classes.preview} aria-label="Automation preview">
          <h2>
            {config.kind === 'schedule'
              ? timingLabel(config, false)
              : `When ${config.scope.type === 'library' ? 'any workflow' : (source?.name ?? 'a workflow')} ${config.events.map((event) => eventLabels[event].toLowerCase()).join(' or ')}`}
          </h2>
          {workflow && <p>Start {workflow.name}</p>}
          {config.kind === 'schedule' ? (
            <>
              {zone && <p>{zone}</p>}
              {previewError ? (
                <p role="status">
                  Enter a valid schedule to preview upcoming times.
                </p>
              ) : (
                upcoming.length > 0 && (
                  <>
                    <p>Next scheduled times</p>
                    <ul>
                      {upcoming.map((slot) => (
                        <li key={slot}>{timestamp(slot, zone)}</li>
                      ))}
                    </ul>
                  </>
                )
              )}
              {config.overlapPolicy === 'skip' && (
                <p>
                  Skip an occurrence while a previous run from this automation
                  is still in progress.
                </p>
              )}
            </>
          ) : (
            config.waitForQuiescence && (
              <p>Wait for the source run and its related work to stop first.</p>
            )
          )}
        </aside>
      </div>
      {recovery.confirmation}
    </section>
  );
}

function IntervalInput({
  intervalMs,
  onChange,
  error,
}: {
  intervalMs: number;
  onChange: (value: number) => void;
  error?: string;
}) {
  const units = [
    { value: '1', label: 'Milliseconds' },
    { value: '1000', label: 'Seconds' },
    { value: '60000', label: 'Minutes' },
    { value: '3600000', label: 'Hours' },
    { value: '86400000', label: 'Days' },
  ];
  const [unit, setUnit] = useState(
    () =>
      [86400000, 3600000, 60000, 1000].find(
        (value) => intervalMs % value === 0,
      ) ?? 1,
  );
  return (
    <div className={classes.fieldRow}>
      <NumberInput
        className={classes.intervalAmount}
        label="Run every"
        required
        min={1}
        allowDecimal={false}
        allowNegative={false}
        value={intervalMs / unit || ''}
        onChange={(value) =>
          onChange(typeof value === 'number' ? value * unit : 0)
        }
        error={error}
      />
      <NativeSelect
        className={classes.intervalUnit}
        label="Unit"
        value={String(unit)}
        data={units}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          onChange((intervalMs / unit) * next);
          setUnit(next);
        }}
      />
    </div>
  );
}
