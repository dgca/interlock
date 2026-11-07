import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import {
  MantineProvider,
  Button,
  ActionIcon,
  Badge,
  Tabs,
  TextInput,
  NumberInput,
  Select,
  Switch,
  Radio,
  Checkbox,
  Alert,
  Skeleton,
} from '@mantine/core';
import {
  ArrowLeft,
  Play,
  Pause,
  Plus,
  Pencil,
  Trash2,
  MoreHorizontal,
  Clock3,
  AlertCircle,
} from 'lucide-react';
import { theme } from '../../../../packages/ui/src/theme/theme';
import { Sidebar } from '../../../../packages/ui/src/components/Sidebar/Sidebar';
import { Modal } from '../../../../packages/ui/src/components/Modal/Modal';
import {
  ModalBody,
  ModalFooter,
} from '../../../../packages/ui/src/components/Modal/ModalLayout';
import { JsonEditor } from '../../../../packages/ui/src/components/JsonEditor/JsonEditor';
import '@mantine/core/styles.css';
import '../../../../packages/ui/src/styles.css';
import './prototype.css';

type Schedule = {
  id: string;
  name: string;
  kind: 'interval' | 'cron';
  every: number;
  unit: string;
  cron: string;
  zone: string;
  overlap: string;
  missed: string;
  limit: number;
  enabled: boolean;
  autoPaused?: boolean;
  imported?: boolean;
  lag?: boolean;
  input: unknown;
  bindings: Record<string, string>;
};
const initial: Schedule[] = [
  {
    id: 'sch_heartbeat',
    name: 'Intake heartbeat',
    kind: 'interval',
    every: 2,
    unit: 'minutes',
    cron: '*/2 * * * *',
    zone: 'America/Denver',
    overlap: 'skip',
    missed: 'run_once',
    limit: 3,
    enabled: true,
    input: { repository: 'dgca/interlock', mode: 'triage' },
    bindings: {
      scheduledAt: 'schedule.scheduledAt',
      previousRunId: 'schedule.previousRunId',
    },
  },
  {
    id: 'sch_morning',
    name: 'Weekday triage',
    kind: 'cron',
    every: 30,
    unit: 'seconds',
    cron: '0 9 * * 1-5',
    zone: 'America/Denver',
    overlap: 'queue',
    missed: 'skip',
    limit: 0,
    enabled: false,
    input: { mode: 'daily' },
    bindings: {},
  },
];
const emptySchedule: Schedule = {
  id: '',
  name: '',
  kind: 'interval',
  every: 2,
  unit: 'minutes',
  cron: '0 9 * * 1-5',
  zone: 'America/Denver',
  overlap: 'skip',
  missed: 'skip',
  limit: 0,
  enabled: false,
  input: {},
  bindings: {},
};
const param = new URLSearchParams(location.search);
const initialState = param.get('state') || 'normal';
const names = ['scheduledAt', 'firedAt', 'triggerId', 'previousRunId'];
const cadence = (s: Schedule) =>
  s.kind === 'interval'
    ? `Every ${s.every} ${s.unit}`
    : `${s.cron} · ${s.zone}`;
function App() {
  const [fixture, setFixture] = useState(initialState),
    [items, setItems] = useState<Schedule[]>(
      (initialState === 'draft' || initialState === 'empty' ? [] : initial).map(
        (s, i) => ({
          ...s,
          autoPaused: initialState === 'attention' && i === 0,
          enabled: initialState === 'imported' ? false : s.enabled,
          imported: initialState === 'imported',
          lag: initialState === 'lag' && i === 0,
        }),
      ),
    ),
    [selected, setSelected] = useState('sch_heartbeat'),
    [section, setSection] = useState(param.get('section') || 'timing'),
    [edit, setEdit] = useState<Schedule | null>(
      param.get('modal') === 'edit' ? structuredClone(initial[0]) : null,
    ),
    [intent, setIntent] = useState<'delete' | 'disable' | 'enable' | null>(
      null,
    ),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [rejected, setRejected] = useState(false),
    [stale, setStale] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [jsonValid, setJsonValid] = useState(true),
    [globalTab, setGlobalTab] = useState('workflows');
  const shown = fixture === 'empty' ? [] : items;
  const current = shown.find((s) => s.id === selected) || shown[0];
  const attention = items.filter((s) => s.autoPaused || s.lag);
  const paused = fixture === 'paused';
  const draft = fixture === 'draft';
  const chooseFixture = (v: string | null) => {
    const value = v || 'normal';
    setFixture(value);
    setItems(
      (value === 'draft' || value === 'empty' ? [] : initial).map((s, i) => ({
        ...s,
        autoPaused: value === 'attention' && i === 0,
        enabled: value === 'imported' ? false : s.enabled,
        imported: value === 'imported',
        lag: value === 'lag' && i === 0,
      })),
    );
    setSelected('sch_heartbeat');
    setNotice('');
    setError('');
    setStale(false);
  };
  function openEditor(s?: Schedule) {
    setEdit(structuredClone(s || emptySchedule));
    setSection('timing');
    setErrors({});
    setError('');
    setJsonValid(true);
  }
  function update(key: string, value: unknown) {
    setEdit((s) => (s ? { ...s, [key]: value } : null));
    setErrors((e) => ({ ...e, [key]: '' }));
  }
  function validate() {
    if (!edit) return false;
    const out: Record<string, string> = {};
    if (!edit.name.trim()) out.name = 'Enter a schedule name.';
    if (
      edit.kind === 'interval' &&
      edit.every *
        (edit.unit === 'minutes' ? 60 : edit.unit === 'hours' ? 3600 : 1) <
        30
    )
      out.every = 'Use an interval of at least 30 seconds.';
    if (edit.kind === 'cron' && edit.cron.trim().split(/\s+/).length !== 5)
      out.cron = 'Use five fields: minute, hour, day, month, weekday.';
    try {
      new Intl.DateTimeFormat('en', { timeZone: edit.zone });
    } catch {
      out.zone = 'Enter a valid IANA time zone, such as America/Denver.';
    }
    if (edit.limit < 0 || !Number.isInteger(edit.limit))
      out.limit = 'Enter a positive whole number or turn off automatic pause.';
    const vals = Object.values(edit.bindings);
    if (vals.some((v) => !v.trim()) || new Set(vals).size !== vals.length)
      out.bindings = 'Give each binding a unique destination path.';
    if (!jsonValid) out.input = 'Enter valid JSON before saving.';
    setErrors(out);
    if (Object.keys(out).length) {
      setSection(
        out.name || out.every || out.cron || out.zone
          ? 'timing'
          : out.input || out.bindings
            ? 'input'
            : 'policies',
      );
      return false;
    }
    return true;
  }
  async function save() {
    if (!validate() || !edit) return;
    setBusy(true);
    setError('');
    await new Promise((r) => setTimeout(r, 450));
    setBusy(false);
    if (rejected) {
      setError(
        'Schedule was not saved. Your edits are still here. Retry when the engine is available.',
      );
      return;
    }
    const value = { ...edit, id: edit.id || 'sch_new' };
    setItems((old) =>
      edit.id
        ? old.map((s) => (s.id === edit.id ? value : s))
        : [...old, value],
    );
    setSelected(value.id);
    if (fixture !== 'draft') setFixture('normal');
    setEdit(null);
    setNotice(
      value.enabled
        ? 'Schedule saved. Changes apply to future fires.'
        : 'Schedule saved disabled. Enable it when you are ready.',
    );
    if (stale)
      setError(
        'Schedule saved, but inspection could not refresh. Retry refresh to see current fire status.',
      );
  }
  async function confirm() {
    if (!current) return;
    setBusy(true);
    setError('');
    await new Promise((r) => setTimeout(r, 450));
    setBusy(false);
    if (rejected) {
      setError('Change was not recorded. Retry when the engine is available.');
      return;
    }
    const action = intent;
    setItems((old) =>
      action === 'delete'
        ? old.filter((s) => s.id !== current.id)
        : old.map((s) =>
            s.id === current.id
              ? {
                  ...s,
                  enabled: action === 'enable',
                  autoPaused: action === 'enable' ? false : s.autoPaused,
                }
              : s,
          ),
    );
    setIntent(null);
    setNotice(
      action === 'delete'
        ? `Deleted ${current.name}. Existing runs were kept.`
        : action === 'enable'
          ? `${current.name} enabled.${paused ? ' Workflow pauses still block fires.' : ''}`
          : `${current.name} disabled. Existing runs continue.`,
    );
    if (stale)
      setError(
        'Change recorded, but inspection could not refresh. Retry refresh to see current fire status.',
      );
  }
  return (
    <div
      className="app fixture-app"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a) {
          e.preventDefault();
          if (a.getAttribute('href')?.startsWith('/runs')) setGlobalTab('runs');
          else setGlobalTab('workflows');
        }
      }}
    >
      <Sidebar
        page={globalTab === 'runs' ? 'runs' : 'workflows'}
        attentionCount={attention.length}
        connected={false}
        connectionError={false}
        engineHost="Design fixture"
      />
      <main
        className="main"
        data-page={globalTab}
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest('a');
          if (a?.getAttribute('href')?.startsWith('/runs')) {
            e.preventDefault();
            setGlobalTab('runs');
          }
        }}
      >
        <header className="workflow-header">
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Back to workflows"
            onClick={() =>
              setNotice('Fixture navigation stays on the selected workflow.')
            }
          >
            <ArrowLeft size={18} />
          </ActionIcon>
          <div className="workflow-title">
            <strong>Repository intake</strong>
            <small>
              Draft saved · {draft ? 'Unpublished' : 'v7 published'}
            </small>
          </div>
          <div className="header-actions">
            <Button
              variant="default"
              leftSection={<Pause size={14} />}
              onClick={() => chooseFixture(paused ? 'normal' : 'paused')}
            >
              {paused ? 'Pauses · 2' : 'Pause workflow'}
            </Button>
            <Button
              disabled={draft}
              leftSection={<Play size={14} />}
              onClick={() =>
                setNotice('Run action is outside this schedule prototype.')
              }
            >
              Run v{draft ? '—' : '7'}
            </Button>
            <ActionIcon
              aria-label="Workflow actions"
              color="gray"
              variant="subtle"
              onClick={() =>
                setNotice('Workflow settings remain separate from schedules.')
              }
            >
              <MoreHorizontal size={18} />
            </ActionIcon>
          </div>
        </header>
        {paused && (
          <div className="pause-banner">
            <div>
              <strong>Workflow paused · 2 holds</strong>
              <p>
                Scheduled starts wait until all library and workflow pauses are
                released. Missed-fire policy applies.
              </p>
            </div>
            <Button
              variant="default"
              onClick={() =>
                setNotice(
                  'Use the existing Pause holds dialog to release one exact hold. Other holds remain active.',
                )
              }
            >
              View pauses
            </Button>
          </div>
        )}
        <Tabs
          value={globalTab === 'runs' ? 'attention' : 'schedules'}
          onChange={(v) => {
            if (v === 'attention') setGlobalTab('runs');
            else setGlobalTab('workflows');
          }}
        >
          <Tabs.List className="workflow-tabs" aria-label="Workflow sections">
            <Tabs.Tab
              value="editor"
              onClick={() =>
                setNotice('The workflow editor is unchanged by this design.')
              }
            >
              Editor
            </Tabs.Tab>
            <Tabs.Tab value="runs" onClick={() => setGlobalTab('runs')}>
              Runs
            </Tabs.Tab>
            <Tabs.Tab value="schedules">Schedules</Tabs.Tab>
            <Tabs.Tab value="children">Child workflows</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <div className="schedule-page">
          {notice && (
            <Alert
              color="blue"
              onClose={() => setNotice('')}
              withCloseButton
              role="status"
            >
              {notice}
            </Alert>
          )}
          {error && !edit && !intent && (
            <Alert color="yellow" title="Inspection may be out of date">
              {error}
              <div>
                <Button
                  variant="subtle"
                  onClick={() => {
                    setError('');
                    setStale(false);
                    setNotice('Inspection refreshed.');
                  }}
                >
                  Retry refresh
                </Button>
              </div>
            </Alert>
          )}
          {globalTab === 'runs' ? (
            <>
              <div className="section-heading">
                <h1>Runs</h1>
                <Button
                  variant="default"
                  onClick={() => setGlobalTab('workflows')}
                >
                  Back to schedules
                </Button>
              </div>
              <Tabs value="attention">
                <Tabs.List className="attention-tabs">
                  <Tabs.Tab value="active">Active</Tabs.Tab>
                  <Tabs.Tab value="attention">
                    Needs attention {attention.length}
                  </Tabs.Tab>
                  <Tabs.Tab value="history">History</Tabs.Tab>
                </Tabs.List>
              </Tabs>
              <h2 className="attention-heading">Schedule alerts</h2>
              {attention.length ? (
                attention.map((s) => (
                  <div className="attention-row" key={s.id}>
                    <AlertCircle size={20} />
                    <div>
                      <strong>{s.name} · Repository intake</strong>
                      <p>
                        {s.autoPaused
                          ? 'Automatically paused after 3 consecutive failures.'
                          : 'Schedule is 4m 12s behind its expected fire.'}
                      </p>
                      <small>Schedule · {s.id}</small>
                    </div>
                    <Button
                      variant="default"
                      onClick={() => {
                        setGlobalTab('workflows');
                        setSelected(s.id);
                      }}
                    >
                      Inspect schedule
                    </Button>
                  </div>
                ))
              ) : (
                <p>No schedules need your attention.</p>
              )}
            </>
          ) : (
            <>
              <div className="section-heading">
                <h1>
                  Schedules <span>{shown.length}</span>
                </h1>
                <Button
                  leftSection={<Plus size={15} />}
                  onClick={() => openEditor()}
                >
                  Add schedule
                </Button>
              </div>
              <p className="scope-note">
                {draft ? (
                  'Publish a workflow version before enabling a schedule.'
                ) : (
                  <>
                    Scheduled runs use the latest published version, currently{' '}
                    <strong>v7</strong>. Draft edits do not change scheduled
                    runs.
                  </>
                )}
              </p>
              {fixture === 'loading' ? (
                <div
                  className="loading"
                  role="status"
                  aria-label="Loading schedules"
                >
                  <Skeleton height={70} />
                  <Skeleton height={70} />
                  <Skeleton height={220} />
                </div>
              ) : fixture === 'error' ? (
                <Alert color="yellow" title="Schedules could not be loaded">
                  Check the engine connection and retry.
                  <div>
                    <Button
                      variant="default"
                      onClick={() => chooseFixture('normal')}
                    >
                      Retry loading
                    </Button>
                  </div>
                </Alert>
              ) : shown.length === 0 ? (
                <div className="empty">
                  <Clock3 size={28} />
                  <h2>No schedules yet</h2>
                  <p>
                    {draft
                      ? 'You can save a disabled schedule while you finish the workflow.'
                      : 'Add a schedule to start this workflow at a fixed interval or on a cron timetable.'}
                  </p>
                  <Button onClick={() => openEditor()}>Add schedule</Button>
                </div>
              ) : (
                <div className="schedule-grid">
                  <section
                    className="schedule-list"
                    aria-label="Workflow schedules"
                  >
                    {shown.map((s) => (
                      <button
                        className={`schedule-item ${s.id === current?.id ? 'selected' : ''}`}
                        key={s.id}
                        aria-pressed={s.id === current?.id}
                        onClick={() => {
                          setSelected(s.id);
                          setError('');
                          if (innerWidth <= 1050)
                            requestAnimationFrame(() => {
                              const h =
                                document.querySelector<HTMLElement>(
                                  '.detail-heading h2',
                                );
                              h?.focus();
                              h?.scrollIntoView({
                                block: 'start',
                                behavior: 'instant',
                              });
                            });
                        }}
                      >
                        <div className="item-title">
                          <strong>{s.name}</strong>
                          <Badge
                            color={
                              s.autoPaused
                                ? 'yellow'
                                : s.enabled
                                  ? 'blue'
                                  : 'gray'
                            }
                            variant="light"
                          >
                            {s.autoPaused
                              ? 'Auto-paused'
                              : s.enabled
                                ? 'Enabled'
                                : 'Disabled'}
                          </Badge>
                        </div>
                        <span className="cadence">{cadence(s)}</span>
                        <small>
                          {s.autoPaused
                            ? '3 consecutive failures'
                            : s.imported
                              ? 'Imported disabled'
                              : s.lag
                                ? 'Fire lag · 4m 12s'
                                : s.enabled
                                  ? 'Next · Nov 7, 3:24 AM MST'
                                  : 'No next fire while disabled'}
                        </small>
                      </button>
                    ))}
                  </section>
                  {current && (
                    <section
                      className="schedule-detail"
                      aria-label={`${current.name} inspection`}
                    >
                      <div className="detail-heading">
                        <div>
                          <h2 tabIndex={-1}>{current.name}</h2>
                          <code>{current.id}</code>
                        </div>
                        <Button
                          variant="default"
                          leftSection={<Pencil size={13} />}
                          onClick={() => openEditor(current)}
                        >
                          Edit schedule
                        </Button>
                      </div>
                      {current.autoPaused && (
                        <Alert
                          color="yellow"
                          title="Automatically paused after 3 consecutive failures"
                        >
                          Review recent outcomes, correct the cause, then
                          re-enable this schedule.
                          <div>
                            <Button
                              variant="subtle"
                              onClick={() => setIntent('enable')}
                            >
                              Re-enable schedule
                            </Button>
                          </div>
                        </Alert>
                      )}
                      {current.lag && (
                        <Alert
                          color="yellow"
                          title="Schedule is behind by 4m 12s"
                        >
                          The next expected fire is overdue. Review the engine
                          connection and recent outcomes. This schedule remains
                          enabled.
                        </Alert>
                      )}
                      {current.imported && (
                        <Alert color="blue" title="Imported disabled">
                          Review the timing and input for this machine, then
                          enable the schedule.
                        </Alert>
                      )}
                      <dl className="fire-summary">
                        <div>
                          <dt>Last fire</dt>
                          <dd>
                            {fixture === 'missing'
                              ? 'Never fired'
                              : current.id === 'sch_heartbeat'
                                ? 'Nov 7, 3:22:00 AM MST'
                                : 'Nov 6, 9:00:00 AM MST'}
                          </dd>
                        </div>
                        <div>
                          <dt>Next fire</dt>
                          <dd>
                            {current.autoPaused
                              ? 'Paused automatically'
                              : !current.enabled
                                ? 'Disabled'
                                : paused
                                  ? 'Blocked by 2 pause holds'
                                  : 'Nov 7, 3:24:00 AM MST'}
                          </dd>
                        </div>
                        <div>
                          <dt>Fire lag</dt>
                          <dd>
                            {fixture === 'missing'
                              ? 'Not available'
                              : current.lag
                                ? '4m 12s'
                                : '0.8s'}
                            {fixture !== 'missing' && (
                              <small>Scheduled time to actual fire</small>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>Consecutive failures</dt>
                          <dd>
                            {current.autoPaused
                              ? '3'
                              : fixture === 'missing'
                                ? '0'
                                : '0'}
                            {current.limit > 0 && (
                              <small>Auto-pause at {current.limit}</small>
                            )}
                          </dd>
                        </div>
                      </dl>
                      <div className="policy-summary">
                        <h3>Policies</h3>
                        <dl>
                          <div>
                            <dt>When a previous run is active</dt>
                            <dd>
                              {current.overlap === 'skip'
                                ? 'Skip this fire'
                                : current.overlap === 'queue'
                                  ? 'Queue at most one run'
                                  : 'Allow another run'}
                            </dd>
                          </div>
                          <div>
                            <dt>After missed fires</dt>
                            <dd>
                              {current.missed === 'skip'
                                ? 'Wait for the next scheduled time'
                                : 'Run once, then continue the schedule'}
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <details className="input-details">
                        <summary>Run input and bindings</summary>
                        <pre>{JSON.stringify(current.input, null, 2)}</pre>
                        {Object.entries(current.bindings).map(
                          ([key, value]) => (
                            <div className="binding-display" key={key}>
                              <code>{key}</code>
                              <span>→</span>
                              <code>{value}</code>
                            </div>
                          ),
                        )}
                        {!Object.keys(current.bindings).length && (
                          <p>No fire metadata bindings.</p>
                        )}
                      </details>
                      <div className="recent">
                        <div className="recent-heading">
                          <h3>Recent fires</h3>
                          <span>Times in America/Denver</span>
                        </div>
                        {fixture === 'missing' ? (
                          <p className="muted">
                            No fire history yet. Last fire and lag will appear
                            after the first attempt.
                          </p>
                        ) : (
                          <>
                            <div
                              className="fire-row fire-labels"
                              aria-hidden="true"
                            >
                              <span>Scheduled</span>
                              <span>Outcome</span>
                              <span>Lag</span>
                              <span>Run</span>
                            </div>
                            {(current.autoPaused
                              ? [
                                  ['3:22 AM', 'Failed', '0.8s', 'No run'],
                                  ['3:20 AM', 'Failed', '0.6s', 'No run'],
                                  ['3:18 AM', 'Failed', '1.0s', 'No run'],
                                ]
                              : [
                                  ['3:22 AM', 'Started', '0.8s', 'run_8f2c'],
                                  [
                                    '3:20 AM',
                                    'Skipped overlap',
                                    '0.6s',
                                    'No new run',
                                  ],
                                  ['3:18 AM', 'Queued', '1.0s', 'run_7a91'],
                                ]
                            ).map((r, i) => (
                              <div className="fire-row" key={i}>
                                <span>
                                  <time>Nov 7 · {r[0]}</time>
                                </span>
                                <span>
                                  <Badge
                                    color={
                                      r[1] === 'Failed'
                                        ? 'red'
                                        : r[1] === 'Started'
                                          ? 'blue'
                                          : 'gray'
                                    }
                                    variant="light"
                                  >
                                    {r[1]}
                                  </Badge>
                                  {current.autoPaused && (
                                    <small>
                                      Input contract rejected: repository is
                                      required.
                                    </small>
                                  )}
                                </span>
                                <span>
                                  <small className="mobile-label">Lag </small>
                                  {r[2]}
                                </span>
                                <span>
                                  {r[3].startsWith('run_') ? (
                                    <button
                                      className="text-link"
                                      onClick={() =>
                                        setNotice(
                                          `Open existing run inspector for ${r[3]}.`,
                                        )
                                      }
                                    >
                                      {r[3]}
                                    </button>
                                  ) : (
                                    r[3]
                                  )}
                                </span>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                      <div className="schedule-actions">
                        <Button
                          variant="default"
                          disabled={draft}
                          onClick={() =>
                            setIntent(
                              current.enabled && !current.autoPaused
                                ? 'disable'
                                : 'enable',
                            )
                          }
                        >
                          {current.autoPaused
                            ? 'Re-enable schedule'
                            : current.enabled
                              ? 'Disable schedule'
                              : 'Enable schedule'}
                        </Button>
                        <Button
                          variant="subtle"
                          color="red"
                          leftSection={<Trash2 size={13} />}
                          onClick={() => setIntent('delete')}
                        >
                          Delete schedule
                        </Button>
                      </div>
                    </section>
                  )}
                </div>
              )}
            </>
          )}
          <details className="fixtures">
            <summary>Design fixtures · no engine writes</summary>
            <div className="fixture-controls">
              <Select
                label="Fixture state"
                value={fixture}
                onChange={chooseFixture}
                data={[
                  'normal',
                  'attention',
                  'lag',
                  'paused',
                  'empty',
                  'draft',
                  'imported',
                  'loading',
                  'error',
                  'missing',
                ]}
              />
              <Checkbox
                label="Reject next mutation"
                checked={rejected}
                onChange={(e) => setRejected(e.currentTarget.checked)}
              />
              <Checkbox
                label="Fail refresh after success"
                checked={stale}
                onChange={(e) => setStale(e.currentTarget.checked)}
              />
              <Button
                variant="default"
                onClick={() =>
                  setGlobalTab(globalTab === 'runs' ? 'workflows' : 'runs')
                }
              >
                Show {globalTab === 'runs' ? 'schedules' : 'Needs attention'}
              </Button>
            </div>
          </details>
        </div>
        {edit && (
          <Modal
            title={edit.id ? 'Edit schedule' : 'Add schedule'}
            size={820}
            height={720}
            busy={busy}
            onClose={() => {
              setEdit(null);
              setError('');
            }}
          >
            <ModalBody flush>
              <div className="editor-layout" inert={busy}>
                <nav aria-label="Schedule settings">
                  {[
                    ['timing', 'Timing'],
                    ['input', 'Run input'],
                    ['policies', 'Policies'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={section === id ? 'active' : ''}
                      aria-current={section === id ? 'page' : undefined}
                      onClick={() => setSection(id)}
                    >
                      {label}
                      {((id === 'timing' &&
                        (errors.name ||
                          errors.every ||
                          errors.cron ||
                          errors.zone)) ||
                        (id === 'input' && (errors.input || errors.bindings)) ||
                        (id === 'policies' && errors.limit)) && (
                        <span aria-label="Contains errors">!</span>
                      )}
                    </button>
                  ))}
                </nav>
                <div className="editor-content">
                  <p className="save-scope">
                    {edit.id
                      ? 'Changes apply to future fires after you save. Existing runs keep their captured input.'
                      : 'New schedules start disabled. Save, inspect, then enable.'}
                  </p>
                  {section === 'timing' ? (
                    <>
                      <TextInput
                        label="Schedule name"
                        value={edit.name}
                        onChange={(e) => update('name', e.currentTarget.value)}
                        error={errors.name}
                        required
                        data-autofocus
                        placeholder="For example, Intake heartbeat"
                      />
                      <Radio.Group
                        label="Timing"
                        value={edit.kind}
                        onChange={(v) => update('kind', v)}
                      >
                        <div className="radio-inline">
                          <Radio value="interval" label="Fixed interval" />
                          <Radio value="cron" label="Cron expression" />
                        </div>
                      </Radio.Group>
                      {edit.kind === 'interval' ? (
                        <div className="timing-fields">
                          <NumberInput
                            label="Every"
                            min={1}
                            value={edit.every}
                            onChange={(v) => update('every', Number(v))}
                            error={errors.every}
                          />
                          <Select
                            label="Unit"
                            data={['seconds', 'minutes', 'hours']}
                            value={edit.unit}
                            onChange={(v) => update('unit', v)}
                          />
                          <p className="field-note">
                            Minimum interval is 30 seconds.
                          </p>
                        </div>
                      ) : (
                        <>
                          <TextInput
                            label="Cron expression"
                            value={edit.cron}
                            onChange={(e) =>
                              update('cron', e.currentTarget.value)
                            }
                            error={errors.cron}
                            description="Five fields: minute, hour, day, month, weekday."
                            styles={{ input: { fontFamily: 'var(--mono)' } }}
                          />
                          <TextInput
                            label="Time zone"
                            value={edit.zone}
                            onChange={(e) =>
                              update('zone', e.currentTarget.value)
                            }
                            error={errors.zone}
                            description="IANA name. Cron follows local clock changes in this zone."
                          />
                          <div className="next-preview">
                            <h3>Next scheduled times</h3>
                            <p>
                              Mon, Nov 9 · 9:00 AM MST
                              <br />
                              Tue, Nov 10 · 9:00 AM MST
                              <br />
                              Wed, Nov 11 · 9:00 AM MST
                            </p>
                            <small>
                              Fixture preview for 0 9 * * 1-5 · America/Denver
                            </small>
                          </div>
                        </>
                      )}
                      {edit.enabled && (
                        <Alert color="blue">
                          This schedule is enabled. Saving timing changes
                          changes future fire times.
                        </Alert>
                      )}
                    </>
                  ) : section === 'input' ? (
                    <>
                      <div
                        onInput={(e) => {
                          const target = e.target as HTMLTextAreaElement;
                          if (target.tagName === 'TEXTAREA') {
                            try {
                              JSON.parse(target.value);
                              setJsonValid(true);
                            } catch {
                              setJsonValid(false);
                            }
                          }
                        }}
                      >
                        <JsonEditor
                          label="Input template (JSON)"
                          value={edit.input}
                          onChange={(v) => update('input', v)}
                          rows={6}
                        />
                      </div>
                      {errors.input && (
                        <p className="error-text">{errors.input}</p>
                      )}
                      <h3>Fire metadata bindings</h3>
                      <p className="field-note">
                        Optional. Add a value to the run input at a destination
                        path. Existing template values at that path are
                        replaced.
                      </p>
                      <div className="binding-editor">
                        {names.map((n) => (
                          <div key={n}>
                            <Checkbox
                              label={n}
                              checked={n in edit.bindings}
                              onChange={(e) =>
                                update(
                                  'bindings',
                                  e.currentTarget.checked
                                    ? { ...edit.bindings, [n]: `schedule.${n}` }
                                    : Object.fromEntries(
                                        Object.entries(edit.bindings).filter(
                                          ([k]) => k !== n,
                                        ),
                                      ),
                                )
                              }
                            />
                            {n in edit.bindings && (
                              <TextInput
                                aria-label={`${n} destination path`}
                                placeholder="schedule.scheduledAt"
                                value={edit.bindings[n]}
                                onChange={(e) =>
                                  update('bindings', {
                                    ...edit.bindings,
                                    [n]: e.currentTarget.value,
                                  })
                                }
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="field-note">
                        scheduledAt and firedAt are ISO timestamps.
                        previousRunId is null before this schedule has started a
                        run.
                      </p>
                      {errors.bindings && (
                        <p className="error-text">{errors.bindings}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <Radio.Group
                        label="When a previous run is active or queued"
                        value={edit.overlap}
                        onChange={(v) => update('overlap', v)}
                      >
                        <div className="radio-stack">
                          <Radio
                            value="skip"
                            label="Skip this fire"
                            description="Start no new run while the previous run is active or queued."
                          />
                          <Radio
                            value="queue"
                            label="Queue at most one run"
                            description="Keep one waiting run. Further fires do not build a backlog."
                          />
                          <Radio
                            value="allow"
                            label="Allow another run"
                            description="Runs may overlap. Workflow admission limits still apply."
                          />
                        </div>
                      </Radio.Group>
                      <Radio.Group
                        label="After sleep, downtime, or a pause"
                        value={edit.missed}
                        onChange={(v) => update('missed', v)}
                      >
                        <div className="radio-stack">
                          <Radio
                            value="skip"
                            label="Skip missed fires"
                            description="Wait for the next scheduled time."
                          />
                          <Radio
                            value="run_once"
                            label="Run once"
                            description="Make one recovery attempt, then return to the schedule. Never replay every missed slot."
                          />
                        </div>
                      </Radio.Group>
                      <div className="failure-option">
                        <Switch
                          label="Pause after consecutive failures"
                          checked={edit.limit > 0}
                          onChange={(e) =>
                            update('limit', e.currentTarget.checked ? 3 : 0)
                          }
                        />
                        {edit.limit > 0 && (
                          <NumberInput
                            label="Consecutive failures"
                            value={edit.limit}
                            min={1}
                            onChange={(v) => update('limit', Number(v))}
                            error={errors.limit}
                          />
                        )}
                        <p className="field-note">
                          An automatic pause adds a Needs attention alert.
                          Re-enable this schedule after reviewing the failures.
                        </p>
                      </div>
                    </>
                  )}
                  {error && (
                    <Alert color="red" title="Save failed" role="alert">
                      {error}
                    </Alert>
                  )}
                </div>
              </div>
            </ModalBody>
            <ModalFooter
              aside={
                <span className="footer-note">
                  {draft
                    ? 'Unpublished workflow · save disabled'
                    : edit.enabled
                      ? 'Schedule enabled'
                      : 'Schedule disabled'}
                </span>
              }
            >
              <Button
                variant="default"
                disabled={busy}
                onClick={() => {
                  setEdit(null);
                  setError('');
                }}
              >
                Cancel
              </Button>
              <Button disabled={busy} onClick={save}>
                {busy
                  ? 'Saving schedule…'
                  : edit.id
                    ? 'Save schedule'
                    : 'Create schedule'}
              </Button>
            </ModalFooter>
          </Modal>
        )}
        {intent && current && (
          <Modal
            title={`${intent === 'enable' && current.autoPaused ? 'Re-enable' : intent === 'enable' ? 'Enable' : intent === 'disable' ? 'Disable' : 'Delete'} ${current.name}?`}
            busy={busy}
            onClose={() => {
              setIntent(null);
              setError('');
            }}
            size={500}
          >
            <ModalBody>
              <p>
                {intent === 'delete'
                  ? 'This removes only this schedule and stops its future fires. Existing runs remain.'
                  : intent === 'disable'
                    ? 'Future fires stop. Existing active or queued runs continue.'
                    : 'This schedule can start runs using the latest published workflow, v7.'}
              </p>
              <code>{current.id}</code>
              {intent === 'enable' && (
                <>
                  <p>
                    {current.missed === 'run_once'
                      ? 'Missed-fire policy is Run once. Enabling may make one recovery attempt.'
                      : 'Missed fires are skipped. The next scheduled time will be used.'}
                  </p>
                  {current.autoPaused && (
                    <p>
                      Re-enabling clears this schedule’s automatic pause. Review
                      the cause of its 3 consecutive failures first.
                    </p>
                  )}
                  {paused && (
                    <Alert color="yellow">
                      Two workflow pause holds still block starts. Enabling this
                      schedule does not release those holds.
                    </Alert>
                  )}
                </>
              )}
              {error && <Alert color="red">{error}</Alert>}
            </ModalBody>
            <ModalFooter>
              <Button
                variant="default"
                disabled={busy}
                onClick={() => {
                  setIntent(null);
                  setError('');
                }}
              >
                Cancel
              </Button>
              <Button
                color={intent === 'delete' ? 'red' : undefined}
                disabled={busy}
                onClick={confirm}
              >
                {busy
                  ? 'Saving…'
                  : intent === 'delete'
                    ? 'Delete schedule'
                    : intent === 'disable'
                      ? 'Disable schedule'
                      : current.autoPaused
                        ? 'Re-enable schedule'
                        : 'Enable schedule'}
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <MantineProvider theme={theme} forceColorScheme="dark">
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </MantineProvider>,
);
