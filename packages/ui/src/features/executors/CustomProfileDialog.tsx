import {
  Button,
  Badge,
  TextInput,
  NumberInput,
  NativeSelect,
  SegmentedControl,
  Modal,
  ModalBody,
  ModalFooter,
  ActionError,
} from '../../design-system';

import { useState, useEffect, useId } from 'react';

import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  Info,
  Terminal,
  Globe,
  Shield,
  Layers,
} from 'lucide-react';
import type { ExecutorProfile, ExecutorProfileUpdate } from '@interlock/core';

import { KeyValueEditor } from './KeyValueEditor';
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

  // UI accordion state for optional hooks
  const [openHooks, setOpenHooks] = useState<Record<string, boolean>>({
    status: false,
    message: false,
    stop: false,
    archive: false,
  });

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
        setPermissions(profile.permissions as any);
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
        setName(initialName || 'My Custom Harness');
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

  const toggleHook = (hookName: string) => {
    setOpenHooks((prev) => ({ ...prev, [hookName]: !prev[hookName] }));
  };

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
      setError('Configuration Name is required');
      return;
    }

    if (mode === 'direct') {
      if (transport === 'subprocess' && !turnCommand.trim()) {
        setError('Turn Command is required for direct subprocess execution');
        return;
      }
      if (transport === 'http' && !turnUrl.trim()) {
        setError('Turn URL is required for direct HTTP execution');
        return;
      }
    } else {
      if (transport === 'subprocess' && !launchCommand.trim()) {
        setError('Launch Command is required for delegated launcher execution');
        return;
      }
      if (transport === 'http' && !launchUrl.trim()) {
        setError('Launch URL is required for delegated launcher execution');
        return;
      }
    }

    const isAbs = (p: string) => /^(?:[a-zA-Z]:[\\/]|[\\/])/.test(p);

    if (cwd.trim() && !isAbs(cwd.trim())) {
      setError('Working Directory (cwd) must be an absolute path');
      return;
    }

    const cleanedRoots = allowedRoots.map((r) => r.trim()).filter(Boolean);
    for (const root of cleanedRoots) {
      if (!isAbs(root)) {
        setError(`Allowed Root "${root}" must be an absolute path`);
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
  return (
    <Modal
      onClose={onClose}
      busy={busy}
      returnFocusTo={returnFocusTo}
      title={isNew ? 'New custom harness' : 'Configure custom harness'}
      size="xl"
      height={760}
    >
      <ModalBody>
        <form id={formId} onSubmit={handleSubmit}>
          <fieldset disabled={busy} className={styles.dialogContent}>
            <section className={styles.sectionCard}>
              <div className={styles.sectionTitle}>
                <Info size={14} />
                <span>General Information</span>
              </div>
              <div className={styles.gridTwo}>
                <TextInput
                  label="Configuration Name"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                  placeholder="e.g. Local Python Agent"
                />
                <TextInput
                  label="Configuration ID"
                  readOnly
                  value={id}
                  description="Stable identifier referenced in workflows and MCP."
                />
              </div>
            </section>
            <section className={styles.sectionCard}>
              <div className={styles.sectionTitle}>
                <Layers size={14} />
                <span>Execution Mode & Transport</span>
              </div>

              <div>
                <label className={styles.fieldLabel}>Execution mode</label>
                <SegmentedControl
                  fullWidth
                  aria-label="Execution mode"
                  value={mode}
                  onChange={(v) => setMode(v as 'direct' | 'launcher')}
                  data={[
                    { label: 'Direct turn', value: 'direct' },
                    {
                      label: 'Delegated launcher',
                      value: 'launcher',
                    },
                  ]}
                />
                <p className={styles.fieldHelper}>
                  {mode === 'direct'
                    ? 'Direct Turn Mode invokes your harness per assignment turn and awaits the result envelope.'
                    : 'Delegated Launcher Mode dispatches an assignment claim ticket to an external agent orchestrator/daemon.'}
                </p>
              </div>

              <div>
                <label className={styles.fieldLabel}>Transport protocol</label>
                <SegmentedControl
                  fullWidth
                  aria-label="Transport protocol"
                  value={transport}
                  onChange={(v) => setTransport(v as 'subprocess' | 'http')}
                  data={[
                    { label: 'Subprocess', value: 'subprocess' },
                    { label: 'HTTP', value: 'http' },
                  ]}
                />
              </div>

              <div className={styles.gridTwo}>
                <NumberInput
                  label="Concurrent assignments"
                  description="Blank means no profile limit. The shared limit still applies."
                  min={1}
                  max={Number.MAX_SAFE_INTEGER}
                  allowDecimal={false}
                  disabled={busy}
                  value={concurrency}
                  onChange={(value) =>
                    setConcurrency(value === '' ? '' : Number(value))
                  }
                />
                <NumberInput
                  label="Execution Timeout (seconds)"
                  min={1}
                  value={timeoutSeconds}
                  onChange={(val) =>
                    setTimeoutSeconds(val === '' ? '' : Number(val))
                  }
                  placeholder="Optional (e.g. 120)"
                />
                {isNew && (
                  <NativeSelect
                    label="Default Permissions"
                    value={permissions}
                    onChange={(e) =>
                      setPermissions(e.currentTarget.value as any)
                    }
                    data={[
                      {
                        label: 'Standard (Interlock tool approval policy)',
                        value: 'standard',
                      },
                      {
                        label: 'Read-only (deny file/env mutations)',
                        value: 'read-only',
                      },
                      {
                        label: 'Full Access (autonomous mode)',
                        value: 'full-access',
                      },
                    ]}
                  />
                )}
              </div>

              <KeyValueEditor
                label="Environment Variables"
                values={env}
                onChange={setEnv}
                tokens={[
                  '$INTERLOCK_WORK_ID',
                  '$INTERLOCK_RUN_ID',
                  '$INTERLOCK_CWD',
                  mode === 'launcher'
                    ? '$INTERLOCK_CLAIM_TICKET'
                    : '$INTERLOCK_CLAIM_TOKEN',
                ]}
              />

              {transport === 'http' && (
                <KeyValueEditor
                  label="HTTP Headers"
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
              )}
            </section>
            <section className={styles.sectionCard}>
              <div className={styles.sectionTitle}>
                {transport === 'http' ? (
                  <Globe size={14} />
                ) : (
                  <Terminal size={14} />
                )}
                <span>
                  {mode === 'direct'
                    ? 'Turn Command & Invocation'
                    : 'Launcher Command & Lifecycle Hooks'}
                </span>
              </div>

              {mode === 'direct' ? (
                transport === 'subprocess' ? (
                  <TextInput
                    label="Turn Command"
                    required
                    className={styles.monoInput}
                    value={turnCommand}
                    onChange={(e) => setTurnCommand(e.currentTarget.value)}
                    placeholder="python -m my_agent.turn --work-id $INTERLOCK_WORK_ID"
                    description="Command line executed per turn. STDIN receives task payload JSON; STDOUT receives result JSON."
                  />
                ) : (
                  <TextInput
                    label="Turn Endpoint URL"
                    required
                    className={styles.monoInput}
                    value={turnUrl}
                    onChange={(e) => setTurnUrl(e.currentTarget.value)}
                    placeholder="https://agent-service.internal/api/turn"
                    description="HTTP POST endpoint called per turn. Request and response bodies are JSON."
                  />
                )
              ) : (
                <div>
                  {transport === 'subprocess' ? (
                    <TextInput
                      label="Launch Command"
                      required
                      className={styles.monoInput}
                      value={launchCommand}
                      onChange={(e) => setLaunchCommand(e.currentTarget.value)}
                      placeholder="docker run -d --name agent-$INTERLOCK_WORK_ID my-agent:latest --claim $INTERLOCK_CLAIM_TICKET"
                      description="Command executed to launch external agent container or daemon."
                    />
                  ) : (
                    <TextInput
                      label="Launch Endpoint URL"
                      required
                      className={styles.monoInput}
                      value={launchUrl}
                      onChange={(e) => setLaunchUrl(e.currentTarget.value)}
                      placeholder="https://agent-gateway.internal/launch"
                      description="HTTP POST endpoint called to dispatch launch ticket."
                    />
                  )}

                  <div className={styles.hooksContainer}>
                    <span className={styles.fieldLabel}>
                      Optional Lifecycle Hooks:
                    </span>

                    {/* Status Hook */}
                    <div className={styles.hookCard}>
                      <Button
                        variant="ghost"
                        className={styles.hookHeader}
                        aria-expanded={openHooks.status}
                        aria-controls={`${formId}-status`}
                        onClick={() => toggleHook('status')}
                      >
                        <div className={styles.hookTitleGroup}>
                          <span>Status Polling Hook</span>
                          <Badge color="gray">
                            {statusCommand || statusUrl
                              ? 'Configured'
                              : 'Optional'}
                          </Badge>
                        </div>
                        {openHooks.status ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </Button>
                      {openHooks.status && (
                        <div
                          id={`${formId}-status`}
                          className={styles.hookBody}
                        >
                          <TextInput
                            label={
                              transport === 'http'
                                ? 'Status Polling URL'
                                : 'Status Command'
                            }
                            className={styles.monoInput}
                            value={
                              transport === 'http' ? statusUrl : statusCommand
                            }
                            onChange={(e) =>
                              transport === 'http'
                                ? setStatusUrl(e.currentTarget.value)
                                : setStatusCommand(e.currentTarget.value)
                            }
                            placeholder={
                              transport === 'http'
                                ? 'https://agent-gateway.internal/status?workId=$INTERLOCK_WORK_ID'
                                : 'docker inspect --format="{{.State.Status}}" agent-$INTERLOCK_WORK_ID'
                            }
                            description="Returns status: working | idle | needs_attention | ended."
                          />
                        </div>
                      )}
                    </div>

                    {/* Message Hook */}
                    <div className={styles.hookCard}>
                      <Button
                        variant="ghost"
                        className={styles.hookHeader}
                        aria-expanded={openHooks.message}
                        aria-controls={`${formId}-message`}
                        onClick={() => toggleHook('message')}
                      >
                        <div className={styles.hookTitleGroup}>
                          <span>Message & Human Input Hook</span>
                          <Badge color="gray">
                            {messageCommand || messageUrl
                              ? 'Configured'
                              : 'Optional'}
                          </Badge>
                        </div>
                        {openHooks.message ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </Button>
                      {openHooks.message && (
                        <div
                          id={`${formId}-message`}
                          className={styles.hookBody}
                        >
                          <TextInput
                            label={
                              transport === 'http'
                                ? 'Message Endpoint URL'
                                : 'Message Command'
                            }
                            className={styles.monoInput}
                            value={
                              transport === 'http' ? messageUrl : messageCommand
                            }
                            onChange={(e) =>
                              transport === 'http'
                                ? setMessageUrl(e.currentTarget.value)
                                : setMessageCommand(e.currentTarget.value)
                            }
                            placeholder={
                              transport === 'http'
                                ? 'https://agent-gateway.internal/message'
                                : 'curl -X POST https://agent-gateway/message -d "$INTERLOCK_INPUT"'
                            }
                            description="Delivers questions, answers, and nudges to the running session."
                          />
                        </div>
                      )}
                    </div>

                    {/* Stop Hook */}
                    <div className={styles.hookCard}>
                      <Button
                        variant="ghost"
                        className={styles.hookHeader}
                        aria-expanded={openHooks.stop}
                        aria-controls={`${formId}-stop`}
                        onClick={() => toggleHook('stop')}
                      >
                        <div className={styles.hookTitleGroup}>
                          <span>Stop & Cancellation Hook</span>
                          <Badge color="gray">
                            {stopCommand || stopUrl ? 'Configured' : 'Optional'}
                          </Badge>
                        </div>
                        {openHooks.stop ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </Button>
                      {openHooks.stop && (
                        <div id={`${formId}-stop`} className={styles.hookBody}>
                          <TextInput
                            label={
                              transport === 'http'
                                ? 'Stop Endpoint URL'
                                : 'Stop Command'
                            }
                            className={styles.monoInput}
                            value={transport === 'http' ? stopUrl : stopCommand}
                            onChange={(e) =>
                              transport === 'http'
                                ? setStopUrl(e.currentTarget.value)
                                : setStopCommand(e.currentTarget.value)
                            }
                            placeholder={
                              transport === 'http'
                                ? 'https://agent-gateway.internal/stop'
                                : 'docker stop -t 10 agent-$INTERLOCK_WORK_ID'
                            }
                            description="Called when execution is cancelled or stopped by the user."
                          />
                        </div>
                      )}
                    </div>

                    {/* Archive Hook */}
                    <div className={styles.hookCard}>
                      <Button
                        variant="ghost"
                        className={styles.hookHeader}
                        aria-expanded={openHooks.archive}
                        aria-controls={`${formId}-archive`}
                        onClick={() => toggleHook('archive')}
                      >
                        <div className={styles.hookTitleGroup}>
                          <span>Archive & Cleanup Hook</span>
                          <Badge color="gray">
                            {archiveCommand || archiveUrl
                              ? 'Configured'
                              : 'Optional'}
                          </Badge>
                        </div>
                        {openHooks.archive ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )}
                      </Button>
                      {openHooks.archive && (
                        <div
                          id={`${formId}-archive`}
                          className={styles.hookBody}
                        >
                          <TextInput
                            label={
                              transport === 'http'
                                ? 'Archive Endpoint URL'
                                : 'Archive Command'
                            }
                            className={styles.monoInput}
                            value={
                              transport === 'http' ? archiveUrl : archiveCommand
                            }
                            onChange={(e) =>
                              transport === 'http'
                                ? setArchiveUrl(e.currentTarget.value)
                                : setArchiveCommand(e.currentTarget.value)
                            }
                            placeholder={
                              transport === 'http'
                                ? 'https://agent-gateway.internal/archive'
                                : 'docker rm -f agent-$INTERLOCK_WORK_ID'
                            }
                            description="Called when the session's final assignment in the run completes."
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>
            <section className={styles.sectionCard}>
              <div className={styles.sectionTitle}>
                <Shield size={14} />
                <span>Directory Containment & Security</span>
              </div>

              <TextInput
                label="Default working directory"
                className={styles.monoInput}
                value={cwd}
                onChange={(e) => setCwd(e.currentTarget.value)}
                placeholder="/Users/dan/dev/interlock"
                description="Default starting folder for subprocesses. Must be an absolute path if provided."
              />

              <div>
                <div className={styles.keyValueHeader}>
                  <span className={styles.fieldLabel}>Allowed roots</span>
                  <Button
                    variant="ghost"
                    leftSection={<Plus size={12} />}
                    onClick={handleAddRoot}
                  >
                    Add allowed root
                  </Button>
                </div>
                <p className={styles.fieldHelper}>
                  When allowed roots are set, working directories outside them
                  are blocked.
                </p>

                {allowedRoots.length > 0 && (
                  <div className={styles.rootsList}>
                    {allowedRoots.map((root, idx) => (
                      <div key={idx} className={styles.rootRow}>
                        <TextInput
                          className={styles.monoInput}
                          placeholder="/Users/dan/dev"
                          value={root}
                          onChange={(e) =>
                            handleRootChange(idx, e.currentTarget.value)
                          }
                        />
                        <Button
                          variant="ghost"
                          color="red"
                          onClick={() => handleRemoveRoot(idx)}
                          aria-label="Remove root"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <span className={styles.fieldLabel}>Session name template</span>
                <TextInput
                  className={styles.monoInput}
                  placeholder="e.g. {{externalTask.id}} {{node.label}}: {{externalTask.title}}"
                  value={sessionNameTemplate}
                  onChange={(e) =>
                    setSessionNameTemplate(e.currentTarget.value)
                  }
                />
                <p className={styles.fieldHelper}>
                  Evaluated from run context. Passed to custom launchers, direct
                  turns, and Pi.
                </p>
              </div>

              <div>
                <span className={styles.fieldLabel}>
                  Resume Command Template (resumeCommandTemplate)
                </span>
                <TextInput
                  className={styles.monoInput}
                  placeholder="e.g. my-tool resume {{sessionId}}"
                  value={resumeCommandTemplate}
                  onChange={(e) =>
                    setResumeCommandTemplate(e.currentTarget.value)
                  }
                />
                <p className={styles.fieldHelper}>
                  CLI command to resume or inspect an external session.
                </p>
              </div>

              <div>
                <span className={styles.fieldLabel}>
                  Deep Link URL Template (deepLinkTemplate)
                </span>
                <TextInput
                  className={styles.monoInput}
                  placeholder="e.g. https://app.example.com/sessions/{{sessionId}}"
                  value={deepLinkTemplate}
                  onChange={(e) => setDeepLinkTemplate(e.currentTarget.value)}
                />
                <p className={styles.fieldHelper}>
                  HTTP(S) deep link opened directly in the browser from Run
                  Inspector.
                </p>
              </div>
            </section>
          </fieldset>
          <ActionError message={error} />
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form={formId} disabled={busy}>
          Save configuration
        </Button>
      </ModalFooter>
    </Modal>
  );
}
