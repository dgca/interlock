import {
  Badge,
  NativeSelect,
  NumberInput,
  Switch,
  TextInput,
  Button,
  EmptyState,
  ActionError,
  PageHeader,
  workspacePage,
} from '../../design-system';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';

import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Terminal,
  Cpu,
  Plus,
} from 'lucide-react';
import { executorProfileSchema, type ExecutorProfile } from '@interlock/core';

import { useBeforeUnloadWarning } from '../../lib/useBeforeUnloadWarning';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';

import { ListTable, ListTableRow } from '../../components/ListTable/ListTable';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import { HarnessRowsSkeleton, harnessTable } from './HarnessListSkeleton';
import styles from './Harnesses.module.css';
import { permissionOptions, permissionDescriptions } from './permissions';
import { ModelSettings } from './ModelSettings';
import { ExecutionSettings } from './ExecutionSettings';
import { paths } from '../../routes/paths';
import { AgentPresets } from './AgentPresets';
import {
  harnessLabel,
  integrationReturnFocusId,
  isPrimaryHarness,
} from './harnessProfiles';
import { PageTabs } from '../../components/PageLayout/PageLayout';
import { aiSettingsTab, aiSettingsTabs } from './aiSettingsNavigation';

const harnessSetup: Record<string, string> = {
  'claude-code': 'https://code.claude.com/docs/en/setup',
  codex: 'https://developers.openai.com/codex/cli/',
  pi: 'https://pi.dev/',
  custom: 'https://docs.interlock.dev/managed-executors',
};
type Profile = Awaited<ReturnType<typeof api.executors.profiles.query>>[number];

type DirtySetting = (id: string, dirty: boolean) => void;

export function Harnesses({ onDirty }: { onDirty?: (dirty: boolean) => void }) {
  const location = useLocation();
  const restoredFocus = useRef<string>(undefined);
  const activeTab = aiSettingsTab(location);
  const tabItems = aiSettingsTabs.map((tab) => {
    const search = new URLSearchParams(location.search);
    search.set('tab', tab.value);
    return { ...tab, to: `${location.pathname}?${search}` };
  });
  const [dirtySettings, setDirtySettings] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const trackDirty = useCallback<DirtySetting>((id, dirty) => {
    setDirtySettings((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const dirty = dirtySettings.size > 0;
  useBeforeUnloadWarning(dirty);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const limitDirty = useCallback(
    (dirty: boolean) => trackDirty('limit', dirty),
    [trackDirty],
  );
  const request = useRef(0);
  const profilesQuery = useQuery(trpc.executors.profiles.queryOptions());
  const profiles = profilesQuery.data;
  const harnesses = profiles?.filter(isPrimaryHarness).sort(
    (a, b) =>
      Number(b.detection.status === 'detected') -
        Number(a.detection.status === 'detected') ||
      harnessLabel(a).localeCompare(harnessLabel(b), undefined, {
        sensitivity: 'base',
      }) ||
      a.id.localeCompare(b.id),
  );
  const [checkError, setCheckError] = useState('');
  const read = workspaceRead('harnesses', profilesQuery);
  const [checking, setChecking] = useState(false);

  const refresh = async (check = false) => {
    const current = ++request.current;
    setCheckError('');
    setChecking(true);
    try {
      if (check)
        await api.executors.manage.mutate({ action: 'list', refresh: true });
      const result = await profilesQuery.refetch();
      return result.isSuccess ? result.data : undefined;
    } catch (e) {
      if (request.current === current) setCheckError(errorMessage(e));
    } finally {
      if (request.current === current) setChecking(false);
    }
  };
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(location.hash.slice(1));
      target?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [location]);
  useEffect(() => {
    const target = location.state?.focusHarnessControl;
    if (typeof target !== 'string' || restoredFocus.current === location.key)
      return;
    const frame = requestAnimationFrame(() => {
      const control = document.getElementById(target);
      if (control) {
        control.focus();
        restoredFocus.current = location.key;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [location, profiles]);
  return (
    <section className={`${workspacePage.page} ${styles.aiPage}`}>
      <PageHeader title="AI Settings" />
      <PageTabs
        label="AI settings sections"
        items={tabItems}
        value={activeTab}
      />
      <div className={`${workspacePage.content} ${styles.aiContent}`}>
        <WorkspaceReadWarning reads={[read]} inline showDetails />
        {checkError && (
          <ActionError
            message={`Could not check installations. ${checkError}`}
          />
        )}
        {activeTab === 'harnesses' && (
          <section
            id="harnesses"
            className={styles.aiSection}
            aria-labelledby="harnesses-title"
          >
            <div className={styles.sectionHeading}>
              <h2 id="harnesses-title">Harnesses</h2>
              <div className={styles.sectionActions}>
                <>
                  <Button
                    aria-label="Check installations"
                    title="Check installations"
                    disabled={checking}
                    onClick={() => void refresh(true)}
                  >
                    <RefreshCw size={14} />
                    Check installations
                  </Button>
                  <Button
                    id={integrationReturnFocusId()}
                    component={Link}
                    to={paths.integrationNew}
                    variant="primary"
                  >
                    <Plus size={14} />
                    Add integration
                  </Button>
                </>
              </div>
            </div>
            {!profiles ? (
              !read.error && <HarnessRowsSkeleton />
            ) : harnesses?.length ? (
              <ListTable {...harnessTable} label="Harnesses">
                {harnesses.map((p) => (
                  <ProfileRow
                    key={p.id}
                    profile={p}
                    refresh={() => refresh()}
                    onDirty={trackDirty}
                  />
                ))}
              </ListTable>
            ) : (
              <EmptyState title="No harnesses yet">
                <Button
                  component={Link}
                  to={paths.integrationNew}
                  variant="secondary"
                >
                  Add integration
                </Button>
              </EmptyState>
            )}
            <div className={styles.bottom}>
              <p>
                Installation checks make no model calls. Authentication is
                checked when the harness runs.
              </p>
            </div>
          </section>
        )}
        {activeTab === 'model-aliases' && <AgentPresets profiles={profiles} />}
        {activeTab === 'execution' && (
          <section
            id="execution-settings"
            className={styles.aiSection}
            aria-labelledby="execution-settings-title"
          >
            <div className={styles.sectionHeading}>
              <h2 id="execution-settings-title">Execution settings</h2>
            </div>
            <div className={styles.settings}>
              <ExecutionSettings onDirty={limitDirty} />
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
function configuration(profile: Profile): ExecutorProfile {
  const { detection: _detection, ...fields } = profile;
  return fields;
}
function ProfileRow({
  profile,
  refresh,
  onDirty,
}: {
  profile: Profile;
  onDirty: DirtySetting;
  refresh: () => Promise<Profile[] | undefined>;
}) {
  const editorId = useId();
  const headerId = `${editorId}-harness`;
  const defaultsTrigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<ExecutorProfile>(() => configuration(profile)),
    [baseline, setBaseline] = useState<ExecutorProfile>(() =>
      configuration(profile),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (wasOpen.current && !open) defaultsTrigger.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const changed =
    JSON.stringify({ ...draft, revision: 0 }) !==
    JSON.stringify({ ...baseline, revision: 0 });
  useEffect(() => {
    if (open && changed) return;
    const next = configuration(profile);
    setDraft(next);
    setBaseline(next);
  }, [profile, open, changed]);
  const dirty = open && changed;
  const dirtyId = 'profile:' + profile.id;
  useEffect(() => onDirty(dirtyId, dirty), [onDirty, dirtyId, dirty]);
  useEffect(() => () => onDirty(dirtyId, false), [onDirty, dirtyId]);
  const cancel = () => {
    setDraft(configuration(profile));
    setBaseline(configuration(profile));
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
        setBaseline(configuration(current));
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
  const label = harnessLabel(profile);
  const detected = profile.detection.status === 'detected';
  return (
    <>
      <ListTableRow headerId={headerId}>
        <div className={styles.profileIdentity}>
          {profile.harness === 'custom' ? (
            <Cpu size={21} className={styles.customIcon} />
          ) : (
            <Terminal size={21} className={styles.icon} />
          )}
          <div className={styles.identity}>
            <strong>{label}</strong>
            <p>
              {profile.harness === 'custom'
                ? `Custom integration · ${profile.mode === 'launcher' ? 'Delegated launcher' : 'Direct turn'}${profile.transport === 'http' ? ' over HTTP' : ' over subprocess'}`
                : 'Local executable'}
            </p>
          </div>
        </div>
        <span className={styles.installation}>
          <Badge variant="light" color={detected ? 'blue' : 'gray'} tt="none">
            {detected
              ? profile.harness === 'custom'
                ? 'Configured'
                : 'Detected'
              : profile.detection.status === 'missing'
                ? 'Not installed'
                : 'Unavailable'}
          </Badge>
        </span>
        <span>
          {detected ? (
            <Switch
              checked={profile.enabled}
              disabled={busy || open}
              aria-label={`Enable ${label}`}
              label={profile.enabled ? 'Enabled' : 'Disabled'}
              onChange={(e) =>
                void save({
                  ...configuration(profile),
                  enabled: e.currentTarget.checked,
                })
              }
            />
          ) : (
            <span className="hint">
              {profile.enabled ? 'Unavailable' : 'Disabled'}
            </span>
          )}
        </span>
        <span>
          <Button
            variant="ghost"
            id={integrationReturnFocusId(profile.id)}
            ref={defaultsTrigger}
            aria-expanded={open}
            aria-controls={open ? editorId : undefined}
            aria-label={`${open ? 'Close defaults for' : 'Edit defaults for'} ${label}`}
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
            {open ? 'Close defaults' : 'Edit defaults'}
          </Button>
        </span>
      </ListTableRow>
      {(!detected || error || open) && (
        <ListTableRow colSpan={harnessTable.columns.length} headerId={headerId}>
          <div className={styles.detailContent}>
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
              <ActionError message={error} className={styles.error} />
            )}
            {open && (
              <form
                id={editorId}
                aria-label={`${label} defaults`}
                className={styles.configuration}
                onSubmit={(e) => {
                  e.preventDefault();
                  void save(draft);
                }}
              >
                <div className={styles.defaultsFields}>
                  <ModelSettings
                    compact
                    disabled={busy}
                    label="Default model"
                    defaultLabel="Use CLI default"
                    profileId={profile.id}
                    paths={{ command: draft.command, cwd: draft.cwd }}
                    model={draft.model}
                    effort={draft.effort}
                    effortDefaultLabel="Use native default"
                    canResetEffort={false}
                    alwaysShowEffort
                    onModelChange={(model) => setDraft({ ...draft, model })}
                    onEffortChange={(effort) => setDraft({ ...draft, effort })}
                  />
                  <NativeSelect
                    label="Default permissions"
                    disabled={busy}
                    inputWrapperOrder={[
                      'label',
                      'input',
                      'description',
                      'error',
                    ]}
                    description={
                      draft.harness === 'custom'
                        ? 'Interlock sends this mode to the integration. The integration is responsible for enforcing it.'
                        : draft.harness === 'pi' &&
                            draft.permissions === 'standard'
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
                {draft.harness !== 'custom' &&
                  draft.permissions === 'read-only' && (
                    <p className={styles.note}>
                      Read-only restrictions do not sandbox project startup
                      hooks.
                    </p>
                  )}
                {draft.harness === 'custom' ? (
                  busy || changed ? (
                    <Button mt="md" disabled>
                      Edit integration
                    </Button>
                  ) : (
                    <Button
                      mt="md"
                      component={Link}
                      to={paths.integration(profile.id)}
                    >
                      Edit integration
                    </Button>
                  )
                ) : (
                  <details className={styles.advanced}>
                    <summary>Advanced settings</summary>
                    <div className={styles.fields}>
                      <TextInput
                        label="Working directory"
                        description="The folder this agent starts in. Leave blank to use Interlock’s working directory."
                        inputWrapperOrder={[
                          'label',
                          'input',
                          'description',
                          'error',
                        ]}
                        placeholder="Use Interlock’s working directory"
                        disabled={busy}
                        maxLength={4096}
                        value={draft.cwd ?? ''}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            cwd: e.currentTarget.value || undefined,
                          })
                        }
                      />

                      <NumberInput
                        label="Concurrent assignments"
                        description="Leave blank for no profile limit. The shared limit still applies."
                        inputWrapperOrder={[
                          'label',
                          'input',
                          'description',
                          'error',
                        ]}
                        min={1}
                        max={Number.MAX_SAFE_INTEGER}
                        allowDecimal={false}
                        value={draft.concurrency ?? ''}
                        onChange={(value) =>
                          setDraft({
                            ...draft,
                            concurrency:
                              value === '' ? undefined : Number(value),
                          })
                        }
                      />

                      <TextInput
                        label="Executable path"
                        disabled={busy}
                        maxLength={4096}
                        description={
                          profile.detection.version
                            ? `Detected version: ${profile.detection.version}`
                            : 'Leave blank to find the harness on PATH.'
                        }
                        inputWrapperOrder={[
                          'label',
                          'input',
                          'description',
                          'error',
                        ]}
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
                        inputWrapperOrder={[
                          'label',
                          'input',
                          'description',
                          'error',
                        ]}
                        value={profile.id}
                        readOnly
                      />
                    </div>
                  </details>
                )}
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
                      Reload defaults
                    </Button>
                  </div>
                )}
                <div className={styles.formActions}>
                  <Button disabled={busy} onClick={cancel}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy || !changed}
                  >
                    {busy ? 'Saving…' : 'Save defaults'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </ListTableRow>
      )}
    </>
  );
}
