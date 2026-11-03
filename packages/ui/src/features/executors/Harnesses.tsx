import { useEffect, useId, useRef, useState } from 'react';
import {
  Badge,
  NativeSelect,
  Skeleton,
  Switch,
  TextInput,
} from '@mantine/core';
import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Terminal,
  Plus,
} from 'lucide-react';
import { executorProfileSchema, type ExecutorProfile } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { api, errorMessage } from '../../lib/api';
import layout from '../../components/PageLayout/PageLayout.module.css';
import styles from './Harnesses.module.css';
import {
  permissionOptions,
  permissionDescriptions,
  permissionLabels,
} from './permissions';
import { ModelSettings } from './ModelSettings';
import { ExecutionSettings } from './ExecutionSettings';
const harnessNames = { 'claude-code': 'Claude Code', codex: 'Codex', pi: 'Pi' };
const harnessSetup = {
  'claude-code': 'https://code.claude.com/docs/en/setup',
  codex: 'https://developers.openai.com/codex/cli/',
  pi: 'https://pi.dev/',
};
type Profile = Awaited<ReturnType<typeof api.executors.profiles.query>>[number];

export function Harnesses() {
  const request = useRef(0);
  const [profiles, setProfiles] = useState<Profile[]>(),
    [error, setError] = useState(''),
    [checking, setChecking] = useState(false),
    [adding, setAdding] = useState(false);
  const refresh = async (check = false) => {
    const current = ++request.current;
    setError('');
    setChecking(true);
    try {
      if (check)
        await api.executors.manage.mutate({ action: 'list', refresh: true });
      const next = await api.executors.profiles.query();
      if (request.current === current) setProfiles(next);
      return next;
    } catch (e) {
      if (request.current === current) setError(errorMessage(e));
    } finally {
      if (request.current === current) setChecking(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <div className={`${layout.page} ${styles.page}`}>
      <header className={layout.header}>
        <div>
          <h1>Harnesses</h1>
          <p>Choose which local agents Interlock can launch.</p>
        </div>
        <Button
          aria-label="Check installations"
          title="Check installations"
          disabled={checking}
          onClick={() => void refresh(true)}
        >
          <RefreshCw size={14} />
          {checking ? 'Checking…' : 'Check installations'}
        </Button>
      </header>
      <ExecutionSettings />
      {error && (
        <div className={styles.errorRow}>
          <p role="alert" className={styles.error}>
            {error}
          </p>
          <Button variant="ghost" onClick={() => void refresh()}>
            Retry loading harnesses
          </Button>
        </div>
      )}
      {!profiles ? (
        !error && (
          <div aria-label="Loading harnesses">
            <Skeleton height={105} mb="md" />
            <Skeleton height={105} />
          </div>
        )
      ) : (
        <div className={styles.list}>
          {profiles.map((p) => (
            <ProfileRow key={p.id} profile={p} refresh={() => refresh()} />
          ))}
        </div>
      )}
      <div className={styles.bottom}>
        <p>
          Installation checks make no model calls. Authentication is checked
          when the harness runs.
        </p>
        <Button
          variant="ghost"
          disabled={adding}
          onClick={() => setAdding(true)}
        >
          <Plus size={14} />
          Add configuration
        </Button>
      </div>
      {adding && (
        <NewProfile
          onCancel={() => setAdding(false)}
          onSave={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
function configuration(profile: Profile): ExecutorProfile {
  const { detection: _detection, ...fields } = profile;
  return fields;
}
function ProfileRow({
  profile,
  refresh,
}: {
  profile: Profile;
  refresh: () => Promise<Profile[] | undefined>;
}) {
  const editorId = useId();
  const row = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<ExecutorProfile>(() => configuration(profile)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!open) setDraft(configuration(profile));
  }, [profile.revision, open]);
  useEffect(() => {
    if (wasOpen.current && !open)
      row.current
        ?.querySelector<HTMLButtonElement>('button[aria-controls]')
        ?.focus();
    wasOpen.current = open;
  }, [open]);
  const changed =
    JSON.stringify({ ...draft, revision: 0 }) !==
    JSON.stringify({ ...configuration(profile), revision: 0 });
  const cancel = () => {
    setDraft(configuration(profile));
    setOpen(false);
    setError('');
  };
  const reload = async () => {
    setBusy(true);
    try {
      const latest = await refresh();
      const current = latest?.find((p) => p.id === profile.id);
      if (current) {
        setDraft(configuration(current));
        setError('');
      }
    } finally {
      setBusy(false);
    }
  };
  const save = async (value: ExecutorProfile) => {
    setBusy(true);
    setError('');
    try {
      const parsed = executorProfileSchema.parse(value),
        { revision, ...fields } = parsed;
      await api.executors.manage.mutate({
        action: 'save',
        profile: { ...fields, expectedRevision: revision },
      });
      await refresh();
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const detected = profile.detection.status === 'detected';
  return (
    <section ref={row} className={styles.row} aria-label={profile.name}>
      <div className={styles.rowHeading}>
        <Terminal size={21} className={styles.icon} />
        <div className={styles.identity}>
          <h2>{profile.name}</h2>
          {!open ? (
            <p
              title={`${profile.model ?? 'CLI default'}${profile.effort ? ` · ${profile.effort} effort` : ''} · ${permissionLabels[profile.permissions]} permissions`}
            >
              {profile.name !== harnessNames[profile.harness] &&
                `${harnessNames[profile.harness]} · `}
              {profile.model ?? 'CLI default'}
              {profile.effort ? ` · ${profile.effort} effort` : ''} ·{' '}
              {permissionLabels[profile.permissions]} permissions
            </p>
          ) : profile.name !== harnessNames[profile.harness] ? (
            <p>{harnessNames[profile.harness]}</p>
          ) : null}
        </div>
        <Badge variant="light" color={detected ? 'blue' : 'gray'} tt="none">
          {detected
            ? 'Detected'
            : profile.detection.status === 'missing'
              ? 'Not installed'
              : 'Unavailable'}
        </Badge>
        <Switch
          checked={profile.enabled}
          disabled={busy || open || (!profile.enabled && !detected)}
          aria-label={`Enable ${profile.name}`}
          label={profile.enabled ? 'Enabled' : 'Disabled'}
          onChange={(e) =>
            void save({
              ...configuration(profile),
              enabled: e.currentTarget.checked,
            })
          }
        />
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-controls={editorId}
          disabled={busy}
          onClick={() => {
            if (open) cancel();
            else {
              setDraft(configuration(profile));
              setError('');
              setOpen(true);
            }
          }}
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {open ? 'Cancel editing' : 'Configure'}
        </Button>
      </div>
      {!detected && (
        <p className={styles.guidance}>
          {profile.detection.message}{' '}
          <a
            href={harnessSetup[profile.harness]}
            target="_blank"
            rel="noreferrer"
          >
            Setup instructions
          </a>
        </p>
      )}
      {error && !open && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {open && (
        <form
          id={editorId}
          className={styles.configuration}
          onSubmit={(e) => {
            e.preventDefault();
            void save(draft);
          }}
        >
          <div className={styles.fields}>
            <TextInput
              label="Configuration name"
              required
              disabled={busy}
              maxLength={120}
              value={draft.name}
              onChange={(e) =>
                setDraft({ ...draft, name: e.currentTarget.value })
              }
            />
            <TextInput
              label="Working directory"
              description="The folder this agent starts in. Leave blank to use Interlock’s working directory."
              inputWrapperOrder={['label', 'input', 'description', 'error']}
              placeholder="Use Interlock’s working directory"
              disabled={busy}
              maxLength={4096}
              value={draft.cwd ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, cwd: e.currentTarget.value || undefined })
              }
            />
          </div>
          <fieldset className={styles.fieldGroup} disabled={busy}>
            <legend>Execution defaults</legend>
            <div className={styles.fields}>
              <ModelSettings
                disabled={busy}
                label="Default model"
                defaultLabel="Use CLI default"
                profileId={profile.id}
                paths={{ command: draft.command, cwd: draft.cwd }}
                model={draft.model}
                effort={draft.effort}
                effortDefaultLabel="Use native default"
                canResetEffort={false}
                onModelChange={(model) => setDraft({ ...draft, model })}
                onEffortChange={(effort) => setDraft({ ...draft, effort })}
              />
              <NativeSelect
                label="Default permissions"
                disabled={busy}
                inputWrapperOrder={['label', 'input', 'description', 'error']}
                description={
                  draft.harness === 'pi' && draft.permissions === 'standard'
                    ? 'Allow read tools; ask before commands, file changes, and other tools.'
                    : permissionDescriptions[draft.permissions]
                }
                value={draft.permissions}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    permissions: e.currentTarget
                      .value as ExecutorProfile['permissions'],
                  })
                }
                data={permissionOptions}
              />
            </div>
            <p className={styles.note}>
              Sign-in and project settings come from the harness. Approvals
              apply to one request; manage permanent rules in the harness.
              {draft.permissions === 'read-only' &&
                ' Read-only restrictions do not sandbox project startup hooks.'}
            </p>
          </fieldset>
          <details className={styles.advanced}>
            <summary>Advanced settings</summary>
            <div className={styles.fields}>
              <TextInput
                label="Executable path"
                disabled={busy}
                maxLength={4096}
                description={
                  profile.detection.version
                    ? `Detected version: ${profile.detection.version}`
                    : 'Leave blank to find the harness on PATH.'
                }
                inputWrapperOrder={['label', 'input', 'description', 'error']}
                placeholder={
                  profile.detection.command ?? 'Auto-detect from PATH'
                }
                value={draft.command ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    command: e.currentTarget.value || undefined,
                  })
                }
              />
              <TextInput
                label="Configuration ID"
                description="Stable reference used by workflows and MCP."
                inputWrapperOrder={['label', 'input', 'description', 'error']}
                value={profile.id}
                readOnly
              />
            </div>
          </details>
          {error && (
            <div className={styles.errorRow}>
              <p role="alert" className={styles.error}>
                {error}
              </p>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void reload()}
              >
                Reload configuration
              </Button>
            </div>
          )}
          <div className={styles.formActions}>
            <Button disabled={busy} onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !changed}>
              {busy ? 'Saving…' : 'Save configuration'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
function NewProfile({
  onSave,
  onCancel,
}: {
  onSave: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(''),
    [harness, setHarness] = useState<ExecutorProfile['harness']>('codex'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      aria-label="Add harness configuration"
      className={styles.newProfile}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          const id = `${harness}-${crypto.randomUUID().slice(0, 8)}`;
          await api.executors.manage.mutate({
            action: 'save',
            profile: { id, harness, name, enabled: false, expectedRevision: 0 },
          });
          await onSave();
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Add configuration</h2>
      <div className={styles.fields}>
        <TextInput
          label="Name"
          autoFocus
          disabled={busy}
          value={name}
          required
          maxLength={120}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <NativeSelect
          label="Harness"
          disabled={busy}
          value={harness}
          onChange={(e) => setHarness(e.currentTarget.value as typeof harness)}
          data={[
            { value: 'claude-code', label: 'Claude Code' },
            { value: 'codex', label: 'Codex' },
            { value: 'pi', label: 'Pi' },
          ]}
        />
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.formActions}>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add configuration'}
        </Button>
      </div>
    </form>
  );
}
