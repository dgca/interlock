import { useEffect, useState } from 'react';
import {
  Badge,
  NativeSelect,
  NumberInput,
  Skeleton,
  Switch,
  TagsInput,
  TextInput,
} from '@mantine/core';
import { ChevronDown, RefreshCw, Terminal, Plus } from 'lucide-react';
import { executorProfileSchema, type ExecutorProfile } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { api, errorMessage } from '../../lib/api';
import layout from '../../components/PageLayout/PageLayout.module.css';
import styles from './Harnesses.module.css';
import { permissionOptions, permissionDescriptions } from './permissions';
type Profile = Awaited<ReturnType<typeof api.executors.profiles.query>>[number];

export function Harnesses() {
  const [profiles, setProfiles] = useState<Profile[]>(),
    [error, setError] = useState(''),
    [checking, setChecking] = useState(false),
    [adding, setAdding] = useState(false);
  const refresh = async (check = false) => {
    setError('');
    setChecking(check);
    try {
      if (check)
        await api.executors.manage.mutate({ action: 'list', refresh: true });
      setProfiles(await api.executors.profiles.query());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
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
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {!profiles ? (
        <div aria-label="Loading harnesses">
          <Skeleton height={105} mb="md" />
          <Skeleton height={105} />
        </div>
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
          when the harness runs. Up to four assignments run at once across all
          profiles.
        </p>
        <Button variant="ghost" onClick={() => setAdding(!adding)}>
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
  refresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<ExecutorProfile>(() => configuration(profile)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => setDraft(configuration(profile)), [profile.revision]);
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
    <section className={styles.row} aria-label={profile.name}>
      <div className={styles.rowHeading}>
        <Terminal size={21} className={styles.icon} />
        <div className={styles.identity}>
          <h2>{profile.name}</h2>
          <p>
            {profile.harness === 'claude-code' ? 'Claude Code' : 'Codex'}
            {profile.detection.version ? ` · ${profile.detection.version}` : ''}
          </p>
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
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={14} />
          {open ? 'Close settings' : 'Configure'}
        </Button>
      </div>
      {!detected && (
        <p className={styles.guidance}>
          {profile.detection.message}{' '}
          <a
            href={
              profile.harness === 'claude-code'
                ? 'https://code.claude.com/docs/en/setup'
                : 'https://developers.openai.com/codex/cli/'
            }
            target="_blank"
            rel="noreferrer"
          >
            Setup instructions
          </a>
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {open && (
        <form
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
              maxLength={120}
              value={draft.name}
              onChange={(e) =>
                setDraft({ ...draft, name: e.currentTarget.value })
              }
            />
            <TextInput
              label="Working directory"
              placeholder="Use the server’s working directory"
              value={draft.cwd ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, cwd: e.currentTarget.value || undefined })
              }
            />
            <TextInput
              label="Model"
              placeholder="Harness default"
              value={draft.model ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  model: e.currentTarget.value || undefined,
                })
              }
            />
            <NativeSelect
              label="Default permissions"
              inputWrapperOrder={['label', 'input', 'description', 'error']}
              description={permissionDescriptions[draft.permissions]}
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
          <details className={styles.advanced}>
            <summary>Advanced settings</summary>
            <div className={styles.fields}>
              <TextInput
                label="Executable path"
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
              <NumberInput
                label="Concurrent assignment limit"
                description="Shared across all workflows using this configuration. Additional assignments wait for a slot."
                min={1}
                max={8}
                value={draft.concurrency}
                onChange={(v) => setDraft({ ...draft, concurrency: Number(v) })}
              />
              <TextInput
                label="Profile reference"
                value={profile.id}
                readOnly
              />
              <TagsInput
                label="Configured tools"
                description="Capability names already available in this harness."
                value={draft.tools}
                onChange={(tools) => setDraft({ ...draft, tools })}
              />
              <TagsInput
                label="Configured skills"
                description="Declares availability; Interlock does not install skills."
                value={draft.skills}
                onChange={(skills) => setDraft({ ...draft, skills })}
              />
            </div>
          </details>
          <p className={styles.note}>
            Uses the harness’s supported authentication and project
            configuration. Permission decisions apply to the current request;
            Interlock does not save broader approval rules. Read-only
            restrictions do not sandbox project startup hooks.
          </p>
          <div className={styles.formActions}>
            <Button
              disabled={busy}
              onClick={() => {
                setDraft(configuration(profile));
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
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
    [harness, setHarness] = useState<'claude-code' | 'codex'>('codex'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
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
          value={name}
          required
          maxLength={120}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <NativeSelect
          label="Harness"
          value={harness}
          onChange={(e) => setHarness(e.currentTarget.value as typeof harness)}
          data={[
            { value: 'claude-code', label: 'Claude Code' },
            { value: 'codex', label: 'Codex' },
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
