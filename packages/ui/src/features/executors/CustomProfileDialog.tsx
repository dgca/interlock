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

import { KeyValueEditor } from './KeyValueEditor';
import { permissionOptions } from './permissions';
import styles from './CustomProfileDialog.module.css';

export interface CustomProfileDialogProps {
  opened: boolean;
  onClose: () => void;
  profile: ExecutorProfile | null;
  initialName?: string;
  onSave: (data: ExecutorProfileUpdate) => Promise<void>;
  isNew?: boolean;
  returnFocusTo?: () => HTMLElement | null;
}

export function CustomProfileDialog({
  opened,
  onClose,
  profile,
  initialName = '',
  onSave,
  isNew = false,
  returnFocusTo,
}: CustomProfileDialogProps) {
  const formId = useId();
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [mode, setMode] = useState<'direct' | 'launcher'>('direct');
  const [transport, setTransport] = useState<'subprocess' | 'http'>(
    'subprocess',
  );
  const [concurrency, setConcurrency] = useState<number | ''>('');
  const [timeoutSeconds, setTimeoutSeconds] = useState<number | ''>('');
  const [permissions, setPermissions] = useState<
    'standard' | 'read-only' | 'full-access'
  >('standard');
  const [env, setEnv] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<Record<string, string>>({});

  // Direct turn fields
  const [turnCommand, setTurnCommand] = useState('');
  const [turnUrl, setTurnUrl] = useState('');

  // Launcher fields
  const [launchCommand, setLaunchCommand] = useState('');
  const [launchUrl, setLaunchUrl] = useState('');
  const [statusCommand, setStatusCommand] = useState('');
  const [statusUrl, setStatusUrl] = useState('');
  const [messageCommand, setMessageCommand] = useState('');
  const [messageUrl, setMessageUrl] = useState('');
  const [stopCommand, setStopCommand] = useState('');
  const [stopUrl, setStopUrl] = useState('');
  const [archiveCommand, setArchiveCommand] = useState('');
  const [archiveUrl, setArchiveUrl] = useState('');

  // Containment & CWD
  const [cwd, setCwd] = useState('');
  const [allowedRoots, setAllowedRoots] = useState<string[]>([]);

  // Session visibility templates
  const [sessionNameTemplate, setSessionNameTemplate] = useState('');
  const [resumeCommandTemplate, setResumeCommandTemplate] = useState('');
  const [deepLinkTemplate, setDeepLinkTemplate] = useState('');

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  useEffect(() => {
    if (opened) {
      setError('');
      if (profile) {
        setName(profile.name);
        setId(profile.id);
        setMode(profile.mode ?? 'direct');
        setTransport(profile.transport ?? 'subprocess');
        setConcurrency(profile.concurrency ?? '');
        setTimeoutSeconds(profile.timeoutSeconds ?? '');
        setPermissions(profile.permissions);
        setEnv(profile.env ?? {});
        setHeaders(profile.headers ?? {});
        setTurnCommand(profile.turnCommand ?? profile.command ?? '');
        setTurnUrl(profile.turnUrl ?? '');
        setLaunchCommand(profile.launchCommand ?? '');
        setLaunchUrl(profile.launchUrl ?? '');
        setStatusCommand(profile.statusCommand ?? '');
        setStatusUrl(profile.statusUrl ?? '');
        setMessageCommand(profile.messageCommand ?? '');
        setMessageUrl(profile.messageUrl ?? '');
        setStopCommand(profile.stopCommand ?? '');
        setStopUrl(profile.stopUrl ?? '');
        setArchiveCommand(profile.archiveCommand ?? '');
        setArchiveUrl(profile.archiveUrl ?? '');
        setCwd(profile.cwd ?? '');
        setAllowedRoots(profile.allowedRoots ?? []);
        setSessionNameTemplate(profile.sessionNameTemplate ?? '');
        setResumeCommandTemplate(profile.resumeCommandTemplate ?? '');
        setDeepLinkTemplate(profile.deepLinkTemplate ?? '');
      } else {
        const generatedId = `custom-${crypto.randomUUID().slice(0, 8)}`;
        setName(initialName);
        setId(generatedId);
        setMode('direct');
        setTransport('subprocess');
        setConcurrency('');
        setTimeoutSeconds('');
        setPermissions('standard');
        setEnv({});
        setHeaders({});
        setTurnCommand('');
        setTurnUrl('');
        setLaunchCommand('');
        setLaunchUrl('');
        setStatusCommand('');
        setStatusUrl('');
        setMessageCommand('');
        setMessageUrl('');
        setStopCommand('');
        setStopUrl('');
        setArchiveCommand('');
        setArchiveUrl('');
        setCwd('');
        setAllowedRoots([]);
        setSessionNameTemplate('');
        setResumeCommandTemplate('');
        setDeepLinkTemplate('');
      }
    }
  }, [opened, profile, initialName]);

  const handleAddRoot = () => {
    setAllowedRoots((prev) => [...prev, '']);
  };

  const handleRootChange = (index: number, val: string) => {
    setAllowedRoots((prev) => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  };

  const handleRemoveRoot = (index: number) => {
    setAllowedRoots((prev) => prev.filter((_, i) => i !== index));
  };

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

    setBusy(true);
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
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!opened) return null;
  const direct = mode === 'direct';
  const http = transport === 'http';
  const invocation = direct ? 'Turn' : 'Launch';
  const [endpoint, setEndpoint] = direct
    ? http
      ? [turnUrl, setTurnUrl]
      : [turnCommand, setTurnCommand]
    : http
      ? [launchUrl, setLaunchUrl]
      : [launchCommand, setLaunchCommand];
  const hooks = [
    {
      label: 'Status',
      description:
        'Reports whether the session is working, idle, needs attention, or ended.',
      command: [statusCommand, setStatusCommand],
      url: [statusUrl, setStatusUrl],
    },
    {
      label: 'Message',
      description:
        'Delivers questions, answers, and nudges to the running session.',
      command: [messageCommand, setMessageCommand],
      url: [messageUrl, setMessageUrl],
    },
    {
      label: 'Stop',
      description: 'Runs when execution is stopped or cancelled.',
      command: [stopCommand, setStopCommand],
      url: [stopUrl, setStopUrl],
    },
    {
      label: 'Archive',
      description: 'Runs after the session’s final assignment completes.',
      command: [archiveCommand, setArchiveCommand],
      url: [archiveUrl, setArchiveUrl],
    },
  ] as const;
  const tokens = ['$INTERLOCK_WORK_ID', '$INTERLOCK_RUN_ID', '$INTERLOCK_CWD'];
  const descriptionOrder = ['label', 'input', 'description', 'error'] as const;
  return (
    <Modal
      onClose={onClose}
      busy={busy}
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
              onChange={(e) => setName(e.currentTarget.value)}
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
                onChange={(e) => setMode(e.currentTarget.value as typeof mode)}
                data={[
                  { label: 'Direct turn', value: 'direct' },
                  { label: 'Delegated launcher', value: 'launcher' },
                ]}
              />
              <NativeSelect
                label="Transport"
                value={transport}
                onChange={(e) =>
                  setTransport(e.currentTarget.value as typeof transport)
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
              value={endpoint}
              onChange={(e) => setEndpoint(e.currentTarget.value)}
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
                  setPermissions(e.currentTarget.value as typeof permissions)
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
                      onChange={setHeaders}
                      keyPlaceholder="Authorization"
                      valuePlaceholder="Bearer token"
                      tokens={[
                        '$INTERLOCK_WORK_ID',
                        '$INTERLOCK_RUN_ID',
                        '$INTERLOCK_CLAIM_TOKEN',
                      ]}
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
                      const [value, setValue] = http ? hook.url : hook.command;
                      return (
                        <TextInput
                          key={hook.label}
                          label={`${hook.label} ${http ? 'URL' : 'command'}`}
                          className={styles.monoInput}
                          value={value}
                          onChange={(e) => setValue(e.currentTarget.value)}
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
                        setConcurrency(value === '' ? '' : Number(value))
                      }
                    />
                    <NumberInput
                      label="Execution timeout (seconds)"
                      min={1}
                      value={timeoutSeconds}
                      onChange={(value) =>
                        setTimeoutSeconds(value === '' ? '' : Number(value))
                      }
                      placeholder="Optional"
                    />
                  </div>
                  <KeyValueEditor
                    label="Environment variables"
                    addLabel="Add variable"
                    values={env}
                    onChange={setEnv}
                    tokens={[
                      ...tokens,
                      direct
                        ? '$INTERLOCK_CLAIM_TOKEN'
                        : '$INTERLOCK_CLAIM_TICKET',
                    ]}
                  />
                  <TextInput
                    label="Working directory"
                    className={styles.monoInput}
                    value={cwd}
                    onChange={(e) => setCwd(e.currentTarget.value)}
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
                        onClick={handleAddRoot}
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
                              handleRootChange(index, e.currentTarget.value)
                            }
                          />
                          <ActionIcon
                            type="button"
                            onClick={() => handleRemoveRoot(index)}
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
                      setSessionNameTemplate(e.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Resume command template"
                    className={styles.monoInput}
                    placeholder="my-tool resume {{sessionId}}"
                    value={resumeCommandTemplate}
                    onChange={(e) =>
                      setResumeCommandTemplate(e.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Deep link template"
                    className={styles.monoInput}
                    placeholder="https://app.example.com/sessions/{{sessionId}}"
                    value={deepLinkTemplate}
                    onChange={(e) => setDeepLinkTemplate(e.currentTarget.value)}
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
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form={formId} disabled={busy}>
          {isNew ? 'Add integration' : 'Save changes'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
