import {
  Button,
  ActionIcon,
  TextInput,
  NumberInput,
  NativeSelect,
  Modal,
  ModalBody,
  ModalFooter,
  ActionError,
} from '../../design-system';

import { useState, useEffect, useId, useRef } from 'react';

import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { ExecutorProfile, ExecutorProfileUpdate } from '@interlock/core';

import { useDraftDismissal } from '../../lib/useDraftDismissal';
import { useEditorDraft } from '../../lib/useEditorDraft';
import { KeyValueEditor } from './KeyValueEditor';
import { permissionOptions } from './permissions';
import styles from './CustomProfileDialog.module.css';

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

export function CustomProfileDialog({
  onClose,
  profile,
  onSave,
  returnFocusTo,
}: {
  onClose: () => void;
  profile: ExecutorProfile | null;
  onSave: (data: ExecutorProfileUpdate) => Promise<void>;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const formId = useId();
  const [id] = useState(
    () => profile?.id ?? `custom-${crypto.randomUUID().slice(0, 8)}`,
  );
  const isNew = !profile;
  const [baseline] = useState(() => profileDraft(profile));
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
  const { busy, beginSave, finishSave } = useEditorDraft(dirty);
  const { dismiss, covered, confirmation } = useDraftDismissal(
    dirty,
    busy,
    onClose,
  );

  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');

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

      await onSave(payload);
      if (finishSave(true)) onClose();
    } catch (err) {
      if (finishSave(false))
        setError(err instanceof Error ? err.message : String(err));
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
  const dialog = (
    <Modal
      onClose={dismiss}
      busy={busy}
      covered={covered}
      returnFocusTo={returnFocusTo}
      title={isNew ? 'Add integration' : 'Edit integration'}
      size={670}
    >
      <ModalBody>
        <form id={formId} onSubmit={handleSubmit}>
          {error && (
            <div ref={errorRef} className={styles.error}>
              <ActionError message={error} />
            </div>
          )}
          <fieldset disabled={busy} className={styles.dialogContent}>
            <TextInput
              label="Name"
              data-autofocus
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
                  update('transport', e.currentTarget.value as typeof transport)
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
                          onChange={(e) => update(field, e.currentTarget.value)}
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
                        update('concurrency', value === '' ? '' : Number(value))
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
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={dismiss} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form={formId} loading={busy}>
          {isNew ? 'Add integration' : 'Save changes'}
        </Button>
      </ModalFooter>
    </Modal>
  );
  return (
    <>
      {dialog}
      {confirmation}
    </>
  );
}
