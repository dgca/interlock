import {
  Button,
  ActionIcon,
  TextInput,
  NumberInput,
  NativeSelect,
  PageHeader,
  workspacePage,
  LoadingSkeleton,
  ActionError,
} from '../../design-system';

import { useState, useEffect, useId, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';

import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  executorProfileSchema,
  type ExecutorProfile,
  type ExecutorProfileUpdate,
} from '@interlock/core';

import { api, errorMessage } from '../../lib/api';
import { isConfirmedWriteRejection } from '../../lib/isConfirmedWriteRejection';
import { trpc, useQuery, useQueryClient } from '../../lib/query';
import { paths } from '../../routes/paths';
import { useDraftDismissal } from '../../lib/useDraftDismissal';
import { useEditorDraft } from '../../lib/useEditorDraft';
import { KeyValueEditor } from './KeyValueEditor';
import { integrationReturnFocusId } from './harnessProfiles';
import { permissionOptions } from './permissions';
import styles from './IntegrationEditor.module.css';

function profileDraft(profile: ExecutorProfile | null) {
  return {
    name: profile?.name ?? '',
    mode: profile?.mode ?? 'direct',
    transport: profile?.transport ?? 'subprocess',
    concurrency: profile?.concurrency ?? ('' as const),
    timeoutSeconds: profile?.timeoutSeconds ?? ('' as const),
    permissions: profile?.permissions ?? 'standard',
    env: profile?.env ?? {},
    headers: profile?.headers ?? {},
    turnCommand: profile?.turnCommand ?? profile?.command ?? '',
    turnUrl: profile?.turnUrl ?? '',
    launchCommand: profile?.launchCommand ?? '',
    launchUrl: profile?.launchUrl ?? '',
    statusCommand: profile?.statusCommand ?? '',
    statusUrl: profile?.statusUrl ?? '',
    messageCommand: profile?.messageCommand ?? '',
    messageUrl: profile?.messageUrl ?? '',
    stopCommand: profile?.stopCommand ?? '',
    stopUrl: profile?.stopUrl ?? '',
    archiveCommand: profile?.archiveCommand ?? '',
    archiveUrl: profile?.archiveUrl ?? '',
    cwd: profile?.cwd ?? '',
    allowedRoots: profile?.allowedRoots ?? [],
    sessionNameTemplate: profile?.sessionNameTemplate ?? '',
    resumeCommandTemplate: profile?.resumeCommandTemplate ?? '',
    deepLinkTemplate: profile?.deepLinkTemplate ?? '',
  };
}

type ProfileDraft = ReturnType<typeof profileDraft>;

const savedProfileKey = (id: string) => ['savedCustomProfile', id];
const harnessList = `${paths.harnesses}?tab=harnesses`;
const revisionConflict = 'Harness configuration changed. Reload before saving.';

export function IntegrationEditorRoute() {
  const { integrationId } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const profiles = useQuery(
    trpc.executors.profiles.queryOptions(undefined, {
      enabled: integrationId !== undefined,
    }),
  );
  const found = profiles.data?.find((item) => item.id === integrationId);
  const saved = integrationId
    ? client.getQueryData<ExecutorProfile>(savedProfileKey(integrationId))
    : undefined;
  const profile =
    found && (!saved || found.revision >= saved.revision) ? found : saved;
  if (!integrationId || profile?.harness === 'custom')
    return (
      <IntegrationEditor
        key={integrationId ?? 'new'}
        initial={profile}
        readError={profiles.error ? errorMessage(profiles.error) : ''}
        onRetry={() => void profiles.refetch({ cancelRefetch: false })}
      />
    );
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title="Edit integration"
        onBack={() => void navigate(harnessList)}
        backLabel="Back to harnesses"
      />
      <div className={workspacePage.content}>
        {profiles.error ? (
          <>
            <ActionError message={errorMessage(profiles.error)} />
            <Button onClick={() => void profiles.refetch()}>
              Retry loading harnesses
            </Button>
          </>
        ) : profiles.data ? (
          <ActionError message="Integration not found." />
        ) : (
          <LoadingSkeleton label="Loading integration…" />
        )}
      </div>
    </section>
  );
}

function IntegrationEditor({
  initial,
  readError: refreshError,
  onRetry,
}: {
  initial?: ExecutorProfile;
  readError: string;
  onRetry: () => void;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const formId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const [id] = useState(
    () => initial?.id ?? `custom-${crypto.randomUUID().slice(0, 8)}`,
  );
  const [profile, setProfile] = useState(initial);
  const isNew = !profile;
  const baseline = profileDraft(profile ?? null);
  const [draft, setDraft] = useState(baseline);
  const update = <K extends keyof ProfileDraft>(
    key: K,
    value: ProfileDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const {
    name,
    mode,
    transport,
    concurrency,
    timeoutSeconds,
    permissions,
    env,
    headers,
    turnCommand,
    turnUrl,
    launchCommand,
    launchUrl,
    statusCommand,
    statusUrl,
    messageCommand,
    messageUrl,
    stopCommand,
    stopUrl,
    archiveCommand,
    archiveUrl,
    cwd,
    allowedRoots,
    sessionNameTemplate,
    resumeCommandTemplate,
    deepLinkTemplate,
  } = draft;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const { busy: saving, beginSave, finishSave } = useEditorDraft(dirty);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [newerSaved, setNewerSaved] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkRequest = useRef<AbortController>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const conflict =
    newerSaved ||
    error === revisionConflict ||
    (!uncertain &&
      dirty &&
      Boolean(initial && profile && initial.revision > profile.revision));
  const busy = saving || checking;
  const leave = () =>
    void navigate(harnessList, {
      state: { focusHarnessControl: integrationReturnFocusId(profile?.id) },
    });
  useEffect(() => {
    nameInput.current?.focus({ preventScroll: true });
    return () => checkRequest.current?.abort();
  }, []);
  useEffect(() => {
    if (
      !dirty &&
      !busy &&
      !uncertain &&
      initial &&
      profile &&
      initial.revision > profile.revision
    ) {
      setProfile(initial);
      setDraft(profileDraft(initial));
    }
  }, [busy, dirty, initial, profile, uncertain]);
  useEffect(() => {
    if (error || readError)
      errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error, readError]);

  const acknowledge = (saved: ExecutorProfile) => {
    client.setQueryData(savedProfileKey(saved.id), saved);
    const filter = trpc.executors.profiles.queryFilter();
    void client.cancelQueries(filter);
    client.setQueryData(trpc.executors.profiles.queryKey(), (profiles) =>
      profiles?.map((item) =>
        item.id === saved.id &&
        item.revision < saved.revision &&
        item.detection.status === 'detected' &&
        item.command === saved.command
          ? { ...saved, detection: item.detection }
          : item,
      ),
    );
    void client.invalidateQueries(filter, { cancelRefetch: false });
    setProfile(saved);
    setDraft(profileDraft(saved));
    setNewerSaved(false);
    setError('');
  };

  const checkSaved = async () => {
    if (checkRequest.current) return;
    const request = new AbortController();
    checkRequest.current = request;
    setChecking(true);
    setReadError('');
    try {
      const profiles = await api.executors.profiles.query(undefined, {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      const latest = profiles.find(
        (item) => item.id === id && item.harness === 'custom',
      );
      const cachedRevision = Math.max(
        client.getQueryData<ExecutorProfile>(savedProfileKey(id))?.revision ??
          0,
        client
          .getQueryData(trpc.executors.profiles.queryKey())
          ?.find((item) => item.id === id)?.revision ?? 0,
      );
      if (latest && latest.revision < cachedRevision) {
        setReadError('Could not read the latest integration. Try again.');
        return;
      }
      if (
        (!latest && isNew) ||
        (latest && latest.revision === profile?.revision && uncertain)
      ) {
        setUncertain(false);
        setError(
          'The saved configuration is unchanged. Your edits are available to save again.',
        );
      } else if (latest && latest.revision > (profile?.revision ?? 0)) {
        if (uncertain) {
          setUncertain(false);
          setNewerSaved(true);
          setError(
            'A newer integration revision is saved. Load latest to review it.',
          );
          return;
        }
        const { detection: _detection, ...saved } = latest;
        client.setQueryData(savedProfileKey(saved.id), saved);
        setProfile(saved);
        setDraft(profileDraft(saved));
        setNewerSaved(false);
        setError('');
        if (isNew && finishSave(true))
          void navigate(paths.integration(id), { replace: true });
      } else {
        setReadError('Could not read the latest integration. Try again.');
      }
    } catch (error) {
      if (!request.signal.aborted) setReadError(errorMessage(error));
    } finally {
      if (!request.signal.aborted) {
        checkRequest.current = null;
        setChecking(false);
      }
    }
  };
  const reload = useDraftDismissal(dirty, busy, () => void checkSaved());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || conflict || uncertain || !dirty) return;
    setError('');
    setReadError('');

    if (!name.trim()) {
      setError('Enter an integration name.');
      return;
    }

    if (mode === 'direct') {
      if (transport === 'subprocess' && !turnCommand.trim()) {
        setError('Enter a turn command.');
        return;
      }
      if (transport === 'http' && !turnUrl.trim()) {
        setError('Enter a turn URL.');
        return;
      }
    } else {
      if (transport === 'subprocess' && !launchCommand.trim()) {
        setError('Enter a launch command.');
        return;
      }
      if (transport === 'http' && !launchUrl.trim()) {
        setError('Enter a launch URL.');
        return;
      }
    }

    const isAbs = (p: string) => /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(p);

    if (cwd.trim() && !isAbs(cwd.trim())) {
      setError('Enter an absolute path for the working directory.');
      return;
    }

    const cleanedRoots = allowedRoots.map((r) => r.trim()).filter(Boolean);
    for (const root of cleanedRoots) {
      if (!isAbs(root)) {
        setError(`Allowed root "${root}" must be an absolute path.`);
        return;
      }
    }

    if (!beginSave()) return;
    try {
      const payload: ExecutorProfileUpdate = {
        id,
        name: name.trim(),
        harness: 'custom',
        enabled: profile?.enabled ?? false,
        expectedRevision: profile?.revision ?? 0,
        mode,
        transport,
        permissions,
        model: profile?.model,
        effort: profile?.effort,
        ...(concurrency === '' ? {} : { concurrency: Number(concurrency) }),
        ...(timeoutSeconds !== ''
          ? { timeoutSeconds: Number(timeoutSeconds) }
          : {}),
        ...(Object.keys(env).length > 0 ? { env } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
        ...(cleanedRoots.length > 0 ? { allowedRoots: cleanedRoots } : {}),
        ...(sessionNameTemplate.trim()
          ? { sessionNameTemplate: sessionNameTemplate.trim() }
          : {}),
        ...(resumeCommandTemplate.trim()
          ? { resumeCommandTemplate: resumeCommandTemplate.trim() }
          : {}),
        ...(deepLinkTemplate.trim()
          ? { deepLinkTemplate: deepLinkTemplate.trim() }
          : {}),
        ...(turnCommand.trim() ? { turnCommand: turnCommand.trim() } : {}),
        ...(turnUrl.trim() ? { turnUrl: turnUrl.trim() } : {}),
        ...(launchCommand.trim()
          ? { launchCommand: launchCommand.trim() }
          : {}),
        ...(launchUrl.trim() ? { launchUrl: launchUrl.trim() } : {}),
        ...(statusCommand.trim()
          ? { statusCommand: statusCommand.trim() }
          : {}),
        ...(statusUrl.trim() ? { statusUrl: statusUrl.trim() } : {}),
        ...(messageCommand.trim()
          ? { messageCommand: messageCommand.trim() }
          : {}),
        ...(messageUrl.trim() ? { messageUrl: messageUrl.trim() } : {}),
        ...(stopCommand.trim() ? { stopCommand: stopCommand.trim() } : {}),
        ...(stopUrl.trim() ? { stopUrl: stopUrl.trim() } : {}),
        ...(archiveCommand.trim()
          ? { archiveCommand: archiveCommand.trim() }
          : {}),
        ...(archiveUrl.trim() ? { archiveUrl: archiveUrl.trim() } : {}),
      };

      const result = await api.executors.manage.mutate({
        action: 'save',
        profile: payload,
      });
      const saved = executorProfileSchema.parse(result);
      if (!finishSave(true)) return;
      acknowledge(saved);
      if (isNew) void navigate(paths.integration(id), { replace: true });
    } catch (error) {
      if (!finishSave(false)) return;
      if (
        isConfirmedWriteRejection(error) ||
        errorMessage(error) === revisionConflict
      ) {
        setError(errorMessage(error));
      } else {
        setUncertain(true);
        setError(
          'Interlock could not confirm whether the integration was saved. Check the saved configuration before trying again.',
        );
      }
    }
  };

  const direct = mode === 'direct';
  const http = transport === 'http';
  const invocation = direct ? 'Turn' : 'Launch';
  const endpoint = direct
    ? http
      ? 'turnUrl'
      : 'turnCommand'
    : http
      ? 'launchUrl'
      : 'launchCommand';
  const hooks = [
    {
      label: 'Status',
      description:
        'Reports whether the session is working, idle, needs attention, or ended.',
      command: 'statusCommand',
      url: 'statusUrl',
    },
    {
      label: 'Message',
      description:
        'Delivers questions, answers, and nudges to the running session.',
      command: 'messageCommand',
      url: 'messageUrl',
    },
    {
      label: 'Stop',
      description: 'Runs when execution is stopped or cancelled.',
      command: 'stopCommand',
      url: 'stopUrl',
    },
    {
      label: 'Archive',
      description: 'Runs after the session’s final assignment completes.',
      command: 'archiveCommand',
      url: 'archiveUrl',
    },
  ] as const;
  const descriptionOrder = ['label', 'input', 'description', 'error'] as const;
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title={profile?.name ?? 'Add integration'}
        onBack={leave}
        backLabel="Back to harnesses"
        busy={saving}
        status={dirty ? 'Unsaved changes' : profile ? 'Saved' : undefined}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={leave}
              disabled={saving || (!isNew && !dirty)}
            >
              {isNew ? 'Cancel' : 'Discard changes'}
            </Button>
            {uncertain || conflict ? (
              <Button
                variant="primary"
                loading={checking}
                onClick={uncertain ? () => void checkSaved() : reload.dismiss}
              >
                {uncertain ? 'Check saved integration' : 'Load latest'}
              </Button>
            ) : (
              <Button
                variant="primary"
                type="submit"
                form={formId}
                loading={saving}
                disabled={busy || !dirty}
              >
                {isNew ? 'Create integration' : 'Save changes'}
              </Button>
            )}
          </>
        }
      />
      <div className={workspacePage.content}>
        <div className={workspacePage.formContent}>
          {refreshError && (
            <div>
              <ActionError message={refreshError} />
              <Button onClick={onRetry}>Retry loading harnesses</Button>
            </div>
          )}
          <form
            id={formId}
            className={workspacePage.card}
            onSubmit={handleSubmit}
          >
            {(error || readError || conflict) && (
              <div ref={errorRef} className={styles.error}>
                <ActionError
                  message={error || (conflict ? revisionConflict : '')}
                />
                <ActionError message={readError} />
              </div>
            )}
            <fieldset disabled={busy} className={styles.editorFields}>
              <TextInput
                ref={nameInput}
                label="Name"
                required
                maxLength={120}
                value={name}
                onChange={(e) => update('name', e.currentTarget.value)}
                placeholder="e.g. Team review service"
              />
              <div className={styles.gridTwo}>
                <NativeSelect
                  label="Execution mode"
                  description={
                    direct
                      ? 'Interlock waits for the integration’s result.'
                      : 'Starts a worker that claims the assignment.'
                  }
                  inputWrapperOrder={[...descriptionOrder]}
                  value={mode}
                  onChange={(e) =>
                    update('mode', e.currentTarget.value as typeof mode)
                  }
                  data={[
                    { label: 'Direct turn', value: 'direct' },
                    { label: 'Delegated launcher', value: 'launcher' },
                  ]}
                />
                <NativeSelect
                  label="Transport"
                  value={transport}
                  onChange={(e) =>
                    update(
                      'transport',
                      e.currentTarget.value as typeof transport,
                    )
                  }
                  data={[
                    { label: 'Subprocess', value: 'subprocess' },
                    { label: 'HTTP', value: 'http' },
                  ]}
                />
              </div>
              <TextInput
                label={`${invocation} ${http ? 'URL' : 'command'}`}
                required
                className={styles.monoInput}
                value={draft[endpoint]}
                onChange={(e) => update(endpoint, e.currentTarget.value)}
                inputWrapperOrder={[...descriptionOrder]}
                description={
                  direct
                    ? http
                      ? 'Interlock sends and receives JSON over HTTP POST.'
                      : 'Reads assignment JSON from stdin and writes result JSON to stdout.'
                    : http
                      ? 'Interlock sends the claim ticket in an HTTP POST.'
                      : 'Starts a worker with the claim ticket.'
                }
                placeholder={
                  http
                    ? `https://agent.example.com/${direct ? 'turn' : 'launch'}`
                    : direct
                      ? 'python -m my_agent.turn'
                      : 'python -m my_agent.launch'
                }
              />
              {isNew && (
                <NativeSelect
                  label="Default permissions"
                  description="The integration is responsible for enforcing this mode."
                  inputWrapperOrder={[...descriptionOrder]}
                  value={permissions}
                  onChange={(e) =>
                    update(
                      'permissions',
                      e.currentTarget.value as typeof permissions,
                    )
                  }
                  data={permissionOptions}
                />
              )}

              <div className={styles.disclosures}>
                {http && (
                  <details className={styles.disclosure}>
                    <summary>
                      <ChevronRight size={14} /> HTTP headers
                    </summary>
                    <div className={styles.disclosureBody}>
                      <KeyValueEditor
                        label="HTTP headers"
                        addLabel="Add header"
                        hideLabel
                        values={headers}
                        onChange={(value) => update('headers', value)}
                        keyPlaceholder="Authorization"
                        valuePlaceholder="Bearer token"
                      />
                    </div>
                  </details>
                )}
                {!direct && (
                  <details className={styles.disclosure}>
                    <summary>
                      <ChevronRight size={14} /> Lifecycle hooks
                    </summary>
                    <div className={styles.disclosureBody}>
                      {hooks.map((hook) => {
                        const field = http ? hook.url : hook.command;
                        return (
                          <TextInput
                            key={hook.label}
                            label={`${hook.label} ${http ? 'URL' : 'command'}`}
                            className={styles.monoInput}
                            value={draft[field]}
                            onChange={(e) =>
                              update(field, e.currentTarget.value)
                            }
                            inputWrapperOrder={[...descriptionOrder]}
                            description={hook.description}
                          />
                        );
                      })}
                    </div>
                  </details>
                )}
                <details className={styles.disclosure}>
                  <summary>
                    <ChevronRight size={14} /> Advanced settings
                  </summary>
                  <div className={styles.disclosureBody}>
                    <div className={styles.gridTwo}>
                      <NumberInput
                        label="Concurrent assignments"
                        description="Leave blank to use the shared limit."
                        inputWrapperOrder={[...descriptionOrder]}
                        min={1}
                        max={Number.MAX_SAFE_INTEGER}
                        allowDecimal={false}
                        value={concurrency}
                        onChange={(value) =>
                          update(
                            'concurrency',
                            value === '' ? '' : Number(value),
                          )
                        }
                      />
                      <NumberInput
                        label="Execution timeout (seconds)"
                        min={1}
                        value={timeoutSeconds}
                        onChange={(value) =>
                          update(
                            'timeoutSeconds',
                            value === '' ? '' : Number(value),
                          )
                        }
                        placeholder="Optional"
                      />
                    </div>
                    <KeyValueEditor
                      label="Environment variables"
                      addLabel="Add variable"
                      values={env}
                      onChange={(value) => update('env', value)}
                    />
                    <TextInput
                      label="Working directory"
                      className={styles.monoInput}
                      value={cwd}
                      onChange={(e) => update('cwd', e.currentTarget.value)}
                      placeholder="Use Interlock’s working directory"
                      description="Enter an absolute path."
                      inputWrapperOrder={[...descriptionOrder]}
                    />
                    <div>
                      <div className={styles.keyValueHeader}>
                        <span className={styles.fieldLabel}>Allowed roots</span>
                        <Button
                          variant="ghost"
                          leftSection={<Plus size={14} />}
                          onClick={() =>
                            update('allowedRoots', [...allowedRoots, ''])
                          }
                        >
                          Add root
                        </Button>
                      </div>
                      <p className={styles.fieldHelper}>
                        Limits working directories to these paths.
                      </p>
                      <div className={styles.rootsList}>
                        {allowedRoots.map((root, index) => (
                          <div key={index} className={styles.rootRow}>
                            <TextInput
                              aria-label={`Allowed root ${index + 1}`}
                              className={styles.monoInput}
                              placeholder="/path/to/projects"
                              value={root}
                              onChange={(e) =>
                                update(
                                  'allowedRoots',
                                  allowedRoots.map((root, position) =>
                                    position === index
                                      ? e.currentTarget.value
                                      : root,
                                  ),
                                )
                              }
                            />
                            <ActionIcon
                              type="button"
                              onClick={() =>
                                update(
                                  'allowedRoots',
                                  allowedRoots.filter(
                                    (_, position) => position !== index,
                                  ),
                                )
                              }
                              aria-label={`Remove root ${index + 1}`}
                            >
                              <Trash2 size={16} />
                            </ActionIcon>
                          </div>
                        ))}
                      </div>
                    </div>
                    <TextInput
                      label="Session name template"
                      className={styles.monoInput}
                      placeholder="{{node.label}}"
                      value={sessionNameTemplate}
                      onChange={(e) =>
                        update('sessionNameTemplate', e.currentTarget.value)
                      }
                    />
                    <TextInput
                      label="Resume command template"
                      className={styles.monoInput}
                      placeholder="my-tool resume {{sessionId}}"
                      value={resumeCommandTemplate}
                      onChange={(e) =>
                        update('resumeCommandTemplate', e.currentTarget.value)
                      }
                    />
                    <TextInput
                      label="Deep link template"
                      className={styles.monoInput}
                      placeholder="https://app.example.com/sessions/{{sessionId}}"
                      value={deepLinkTemplate}
                      onChange={(e) =>
                        update('deepLinkTemplate', e.currentTarget.value)
                      }
                    />
                    <TextInput
                      label="Integration ID"
                      readOnly
                      value={id}
                      description="Stable reference for workflows and MCP."
                      inputWrapperOrder={[...descriptionOrder]}
                    />
                  </div>
                </details>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
      {reload.confirmation}
    </section>
  );
}
