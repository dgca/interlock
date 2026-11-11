import {
  Badge,
  Checkbox,
  NativeSelect,
  Skeleton,
  Textarea,
  Button,
  SegmentedControl,
} from '../../design-system';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  ArrowUpRight,
  Check,
  Copy,
  MessageSquare,
  RotateCcw,
  ShieldCheck,
  Square,
} from 'lucide-react';
import type {
  ExecutorAnswer,
  ExecutorRequest,
  WorkRequest,
} from '@interlock/core';

import { api, errorMessage } from '../../lib/api';
import styles from './ManagedExecutionPanel.module.css';
import { permissionLabels } from './permissions';
import { ModelPicker } from './ModelPicker';
import {
  ManagedTranscript,
  TranscriptRecordingDetails,
} from './ManagedTranscript';

type Inspection = Awaited<ReturnType<typeof api.executors.inspect.query>>;
const stateLabels = {
  starting: 'Starting',
  running: 'Working',
  needs_human: 'Waiting for you',
  needs_model: 'Choose a model',
  completed: 'Completed',
  failed: 'Attempt ended',
  interrupted: 'Recovery needed',
};

export function ManagedExecutionPanel({
  work,
  onRefresh,
  children,
}: {
  work: Omit<WorkRequest, 'token'>;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  // A new attempt must never inherit a previous attempt's confirmation or feedback.
  return (
    <Execution
      key={`${work.id}:${work.attempt}`}
      work={work}
      onRefresh={onRefresh}
      children={children}
    />
  );
}
function Execution({
  work,
  onRefresh,
  children,
}: {
  work: Omit<WorkRequest, 'token'>;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [inspection, setInspection] = useState<Inspection>();
  const [view, setView] = useState('conversation');
  const [selectedAttempt, setSelectedAttempt] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>();
  const [copiedResume, setCopiedResume] = useState(false);

  const handleCopyResume = (cmd: string) => {
    void navigator.clipboard.writeText(cmd);
    setCopiedResume(true);
    setTimeout(() => setCopiedResume(false), 2000);
  };
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [answered, setAnswered] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [model, setModel] = useState<string>();
  const [modelRetryRecorded, setModelRetryRecorded] = useState(false);
  useEffect(() => {
    if (inFlight.current) return;
    let alive = true;
    const requestGeneration = ++generation.current;
    void api.executors.inspect
      .query({ workId: work.id })
      .then((result) => {
        if (alive && generation.current === requestGeneration) {
          setInspection(result);
          setError('');
        }
      })
      .catch((e) => {
        if (alive && generation.current === requestGeneration)
          setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [work, reload]);
  const record = inspection?.items[0];
  useEffect(() => setSelectedAttempt(record?.id), [record?.id]);
  const perform = async (
    key: string,
    fn: () => Promise<unknown>,
    message: string,
    requestId?: string,
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    ++generation.current;
    setError('');
    setFeedback('');
    setBusy(key);
    try {
      const result = (await fn()) as { applied?: boolean };
      if (requestId) setAnswered((ids) => [...ids, requestId]);
      setConfirmed(false);
      setFeedback(
        result.applied === false
          ? 'This request was already answered. Showing the latest state.'
          : message,
      );
      // Record the decision before refreshing. A failed refresh must not invite resubmission.
      try {
        const next = await api.executors.inspect.query({ workId: work.id });
        setInspection(next);
      } catch (e) {
        setError(
          `The action was recorded, but details could not refresh. ${errorMessage(e)}`,
        );
      }
      onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(undefined);
    }
  };
  if (!record)
    return (
      <div className={styles.panel}>
        {error ? (
          <p role="alert" className="error-text">
            {error}
          </p>
        ) : (
          !inspection && (
            <div role="status" aria-label="Loading agent execution">
              <Skeleton height={20} mb="md" />
              <Skeleton height={80} />
            </div>
          )
        )}
        {error && (
          <Button onClick={() => setReload((value) => value + 1)}>
            Reload execution
          </Button>
        )}
      </div>
    );
  const pending = record.requests.filter(
    (r) => r.state === 'pending' && !answered.includes(r.id),
  );
  const active = ['starting', 'running', 'needs_human'].includes(record.state);
  const viewed =
    inspection?.history.find((attempt) => attempt.id === selectedAttempt) ??
    record;
  const viewingCurrent = viewed.id === record.id;
  return (
    <div className={styles.panel}>
      <div className={styles.heading}>
        <div>
          <strong>
            {viewingCurrent ? record.profile.name : 'Recorded session'}
          </strong>
        </div>
        <Badge
          tt="none"
          variant="light"
          color={
            ['needs_human', 'interrupted', 'needs_model'].includes(viewed.state)
              ? 'yellow'
              : viewed.state === 'completed'
                ? 'green'
                : 'gray'
          }
        >
          {viewingCurrent &&
          record.state === 'needs_model' &&
          work.status !== 'held'
            ? 'Attempt ended'
            : viewingCurrent &&
                record.state === 'needs_human' &&
                !pending.length &&
                answered.length
              ? 'Response sent'
              : stateLabels[viewed.state]}
        </Badge>
        {active && viewingCurrent && (
          <div className={styles.stop}>
            <Button
              variant="danger"
              disabled={!!busy}
              aria-busy={busy === 'stop'}
              onClick={() =>
                void perform(
                  'stop',
                  () =>
                    api.executors.manage.mutate({
                      action: 'stop',
                      executionId: record.id,
                    }),
                  'Stop requested. Check that the agent and its commands have stopped before retrying.',
                )
              }
            >
              <Square size={14} aria-hidden="true" />
              {busy === 'stop' ? 'Stopping…' : 'Stop agent'}
            </Button>
          </div>
        )}
      </div>
      <div className={styles.attemptRow}>
        <NativeSelect
          aria-label="Execution attempt"
          value={selectedAttempt ?? record.id}
          onChange={(event) => setSelectedAttempt(event.currentTarget.value)}
          data={[record, ...(inspection?.history ?? [])].map((attempt) => ({
            value: attempt.id,
            label: `Attempt ${attempt.attempt}${attempt.id === record.id ? ' · current' : ' · ' + (stateLabels[attempt.state as keyof typeof stateLabels] ?? attempt.state)}`,
          }))}
        />
      </div>
      <div className={styles.attention}>
        <div role="status" aria-live="polite" className={styles.feedback}>
          {feedback && (
            <p>
              <Check size={16} aria-hidden="true" />
              {feedback}
            </p>
          )}
        </div>
        {!viewingCurrent && pending.length > 0 && (
          <p className={styles.explanation}>
            The current attempt is waiting for your response below.
          </p>
        )}
        {pending.map((request) => (
          <ManagedRequestControls
            key={request.id}
            request={request}
            busy={!!busy}
            sending={busy === request.id}
            onAnswer={(answer) =>
              perform(
                request.id,
                () =>
                  api.executors.manage.mutate({
                    action: 'respond',
                    executionId: record.id,
                    requestId: request.id,
                    answer,
                  }),
                request.kind === 'permission'
                  ? answer.allow
                    ? 'Allowed once. The agent can continue with this action.'
                    : 'Denied. The agent will receive your decision.'
                  : 'Answers sent. The agent can continue.',
                request.id,
              )
            }
          />
        ))}
        {record.state === 'needs_model' && work.status === 'held' && (
          <section
            className={styles.recovery}
            aria-labelledby={`model-${record.id}`}
          >
            <div className={styles.noticeTitle}>
              <RotateCcw size={19} aria-hidden="true" />
              <h3 id={`model-${record.id}`}>Choose a replacement model</h3>
            </div>
            <p className={styles.explanation}>
              {record.profile.model ?? 'CLI default'}: {record.error}
            </p>
            <ModelPicker
              label="Replacement model"
              defaultLabel="Choose a model"
              value={model}
              onChange={setModel}
              profileId={record.profile.id}
              paths={{ command: record.command, cwd: record.cwd }}
              disabled={!!busy}
            />
            <p className={styles.explanation}>
              Retry this assignment with native thinking defaults. Published
              workflow and harness defaults stay unchanged.
              {work.context.continuityGroup &&
                ' Later assignments in this continuity group use the selected model.'}
            </p>
            <Button
              variant="primary"
              disabled={!model || !!busy || modelRetryRecorded}
              aria-busy={busy === 'retry_model'}
              onClick={() =>
                void perform(
                  'retry_model',
                  async () => {
                    const result = await api.executors.manage.mutate({
                      action: 'retry_model',
                      executionId: record.id,
                      model: model!,
                    });
                    setModelRetryRecorded(true);
                    return result;
                  },
                  'Replacement recorded. The assignment is queued for a new attempt.',
                )
              }
            >
              {busy === 'retry_model'
                ? 'Queuing…'
                : 'Retry with selected model'}
            </Button>
          </section>
        )}
        {record.state === 'interrupted' && (
          <section
            className={styles.recovery}
            aria-labelledby={`recovery-${record.id}`}
          >
            <div className={styles.noticeTitle}>
              <RotateCcw size={19} aria-hidden="true" />
              <h3 id={`recovery-${record.id}`}>
                {work.status === 'held'
                  ? 'Check before retrying'
                  : 'Check the stopped agent'}
              </h3>
            </div>
            <p>
              {work.status === 'held'
                ? 'This attempt was interrupted. Interlock is holding its work to avoid starting it twice.'
                : 'This attempt was interrupted. Check its session before releasing its resource reservations.'}
            </p>
            <ol>
              <li>
                Check the agent session and any commands it started. Stop
                anything still running.
              </li>
              <li>
                Review files and other changes it may have made. Retrying can
                repeat those changes.
              </li>
            </ol>
            <details className={styles.details}>
              <summary>How to check this session</summary>
              <p className={styles.explanation}>
                Use your terminal or system process monitor to check the agent
                and commands started in this directory. A missing session alone
                does not prove its commands stopped.
              </p>
              <dl>
                <dt>Directory</dt>
                <dd>{record.cwd}</dd>
                <dt>Session</dt>
                <dd>{record.sessionId ?? 'No session ID was reported'}</dd>
                <dt>Stopped because</dt>
                <dd>
                  {record.error ?? 'The previous attempt was interrupted.'}
                </dd>
              </dl>
            </details>
            <div className={styles.confirmation}>
              <Checkbox
                checked={confirmed}
                disabled={!!busy}
                onChange={(e) => setConfirmed(e.currentTarget.checked)}
                label="I've checked that this agent and its commands have stopped"
              />
              <p>
                {work.status === 'held'
                  ? 'Retry starts a new attempt and releases this attempt’s resource reservations. The agent may ask for approval again.'
                  : 'Confirmation releases this attempt’s resource reservations. It does not restart the run.'}
              </p>
              <Button
                variant="primary"
                disabled={!confirmed || !!busy}
                aria-busy={busy === 'reconcile'}
                onClick={() =>
                  void perform(
                    'reconcile',
                    () =>
                      api.executors.manage.mutate({
                        action: 'reconcile',
                        executionId: record.id,
                        confirmStopped: true,
                      }),
                    work.status === 'held'
                      ? 'Recovery confirmed. The assignment is queued for a new attempt.'
                      : 'Recovery confirmed. Resource reservations released.',
                  )
                }
              >
                {busy === 'reconcile'
                  ? 'Confirming…'
                  : work.status === 'held'
                    ? 'Retry assignment'
                    : 'Confirm stopped'}
              </Button>
            </div>
          </section>
        )}
        {record.error &&
          record.state !== 'interrupted' &&
          !(record.state === 'needs_model' && work.status === 'held') && (
            <p className={styles.reason}>{record.error}</p>
          )}
      </div>
      <div className={styles.views}>
        <SegmentedControl
          aria-label="Agent execution view"
          value={view}
          onChange={setView}
          data={[
            { value: 'conversation', label: 'Conversation' },
            { value: 'details', label: 'Details' },
          ]}
          fullWidth
        />
        <section
          className={styles.viewPanel}
          hidden={view !== 'conversation'}
          aria-label="Conversation"
        >
          <ManagedTranscript
            key={selectedAttempt ?? record.id}
            executionId={selectedAttempt ?? record.id}
            current={!selectedAttempt || selectedAttempt === record.id}
            opened={view === 'conversation'}
          />
        </section>
        <section
          hidden={view !== 'details'}
          aria-label="Execution details"
          className={`${styles.viewPanel} ${styles.detailBody}`}
        >
          {(viewed.resumeCommand || viewed.deepLink) && (
            <div className={styles.sessionVisibilityBar}>
              <div className={styles.sessionActions}>
                {viewed.resumeCommand && (
                  <Button
                    variant="ghost"
                    onClick={() => handleCopyResume(viewed.resumeCommand!)}
                    title={viewed.resumeCommand}
                  >
                    {copiedResume ? <Check size={12} /> : <Copy size={12} />}
                    {copiedResume ? 'Copied' : 'Copy resume command'}
                  </Button>
                )}
                {viewed.deepLink && (
                  <Button
                    component="a"
                    variant="ghost"
                    href={viewed.deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={viewed.deepLink}
                  >
                    Open in harness
                    <ArrowUpRight size={14} />
                  </Button>
                )}
              </div>
            </div>
          )}
          {viewingCurrent &&
            ['starting', 'running', 'needs_human', 'needs_model'].includes(
              record.state,
            ) &&
            (record.logCount > 0 || !record.transcriptCapture) && (
              <section
                className={styles.liveTailSection}
                aria-label="Live progress tail"
              >
                <div className={styles.liveTailHeader}>
                  <h4>Live progress</h4>
                  {record.logCount > 0 && (
                    <span className={styles.logCountBadge}>
                      {record.logs.length} / {record.logCount} updates
                    </span>
                  )}
                </div>
                {record.logs.length > 0 ? (
                  <ol
                    className={styles.liveLogs}
                    tabIndex={0}
                    aria-live="polite"
                  >
                    {record.logs.map((log, i) => (
                      <li key={i}>
                        <time>{new Date(log.at).toLocaleTimeString()}</time>
                        <span>{log.message}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.liveEmpty}>
                    Waiting for progress updates…
                  </p>
                )}
              </section>
            )}
          {viewingCurrent ? (
            <section className={styles.details} aria-label="Execution settings">
              <dl>
                <dt>Harness</dt>
                <dd>{record.profile.harness}</dd>
                <dt>Permissions</dt>
                <dd>
                  {permissionLabels[record.profile.permissions] ?? 'Standard'}
                  {record.permissionSource
                    ? ` · ${record.permissionSource === 'preset' ? 'agent preset' : record.permissionSource === 'workflow' ? 'workflow override' : 'harness default'}`
                    : ''}
                </dd>
                <dt>Directory</dt>
                <dd>{record.cwd}</dd>
                <dt>Executable</dt>
                <dd>{record.command}</dd>
                {record.profile.model && (
                  <>
                    <dt>Model</dt>
                    <dd>
                      {record.profile.model}
                      {record.modelSource
                        ? ` · ${record.modelSource === 'recovery' ? 'selected for recovery' : record.modelSource === 'node' ? 'node override' : record.modelSource === 'workflow' ? 'workflow override' : record.modelSource === 'harness' ? 'harness default' : 'CLI default'}`
                        : ''}
                    </dd>
                  </>
                )}
                <dt>Thinking effort</dt>
                <dd>
                  {record.profile.effort ?? 'Native default'}
                  {record.effortSource
                    ? ` · ${record.effortSource === 'recovery' ? 'reset for recovery' : record.effortSource === 'node' ? 'node override' : record.effortSource === 'workflow' ? 'workflow override' : record.effortSource === 'harness' ? 'harness default' : 'native default'}`
                    : ''}
                </dd>
                {record.sessionId && (
                  <>
                    <dt>Session</dt>
                    <dd>{record.sessionId}</dd>
                  </>
                )}
                {record.sessionName && (
                  <>
                    <dt>Session name</dt>
                    <dd>{record.sessionName}</dd>
                  </>
                )}
                {viewed.resumeCommand && (
                  <>
                    <dt>Resume command</dt>
                    <dd className={styles.codeWrap}>{viewed.resumeCommand}</dd>
                  </>
                )}
                {viewed.deepLink && (
                  <>
                    <dt>Deep link</dt>
                    <dd>
                      <a
                        href={viewed.deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {viewed.deepLink}
                      </a>
                    </dd>
                  </>
                )}
              </dl>
              {record.logs.length > 0 && (
                <ol className={styles.logs}>
                  {record.logs.map((log, i) => (
                    <li key={i}>
                      <time>{new Date(log.at).toLocaleTimeString()}</time>
                      {log.message}
                    </li>
                  ))}
                </ol>
              )}
              <p className="hint">
                {record.logCount > 0 ? 'Recent progress updates. ' : ''}
                {inspection && inspection.total > 1
                  ? `${inspection.total} attempts recorded.`
                  : ''}
              </p>
              {record.requests.some((r) => r.state !== 'pending') && (
                <div className={styles.decisions}>
                  <h4>Recent requests</h4>
                  {record.requests
                    .filter((r) => r.state !== 'pending')
                    .map((r) => (
                      <p key={r.id}>
                        <strong>{r.title}</strong>
                        <span>
                          {r.state === 'cancelled'
                            ? 'Cancelled'
                            : r.kind === 'permission'
                              ? r.answer?.allow
                                ? 'Allowed once'
                                : 'Denied'
                              : 'Answered'}
                        </span>
                      </p>
                    ))}
                </div>
              )}
            </section>
          ) : (
            <section
              className={styles.details}
              aria-label="Historical execution details"
            >
              <dl>
                {viewed.sessionId && (
                  <>
                    <dt>Session</dt>
                    <dd>{viewed.sessionId}</dd>
                  </>
                )}
                {viewed.sessionName && (
                  <>
                    <dt>Session name</dt>
                    <dd>{viewed.sessionName}</dd>
                  </>
                )}
                {viewed.startedAt && (
                  <>
                    <dt>Started</dt>
                    <dd>{new Date(viewed.startedAt).toLocaleString()}</dd>
                  </>
                )}
                {viewed.endedAt && (
                  <>
                    <dt>Ended</dt>
                    <dd>{new Date(viewed.endedAt).toLocaleString()}</dd>
                  </>
                )}
              </dl>
              {viewed.error && <p className={styles.reason}>{viewed.error}</p>}
            </section>
          )}
          <TranscriptRecordingDetails
            executionId={selectedAttempt ?? record.id}
            opened={view === 'details'}
          />
          {viewingCurrent && children}
        </section>
      </div>
      {error && (
        <div role="alert">
          <p className="error-text">{error}</p>
          <Button onClick={() => setReload((value) => value + 1)}>
            Reload execution
          </Button>
        </div>
      )}
    </div>
  );
}

export function ManagedRequestControls({
  request,
  busy,
  sending,
  onAnswer,
  focused = false,
}: {
  request: ExecutorRequest;
  busy: boolean;
  sending: boolean;
  onAnswer: (answer: ExecutorAnswer) => Promise<void>;
  focused?: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<'allow' | 'deny'>();
  const supplied = Object.fromEntries(
    (request.questions ?? []).map((q) => [
      q.id,
      [
        ...(answers[q.id] ?? []),
        ...(q.allowOther && other[q.id]?.trim() ? [other[q.id]] : []),
      ],
    ]),
  );
  return (
    <section
      className={focused ? undefined : styles.request}
      aria-labelledby={focused ? undefined : `request-${request.id}`}
      aria-busy={sending}
    >
      {!focused && (
        <div className={styles.noticeTitle}>
          {request.kind === 'permission' ? (
            <ShieldCheck size={19} aria-hidden="true" />
          ) : (
            <MessageSquare size={19} aria-hidden="true" />
          )}
          <h3 id={`request-${request.id}`}>{request.title}</h3>
        </div>
      )}
      {!focused && (
        <p className={styles.explanation}>
          {request.kind === 'permission'
            ? 'Review the exact action below. Allow once applies only to this request; future actions may need another approval.'
            : 'The agent is waiting for your answer before continuing.'}
        </p>
      )}
      {!focused && request.detail && (
        <pre tabIndex={0} aria-label="Requested action">
          {request.detail}
        </pre>
      )}
      {request.kind === 'permission' ? (
        <div className={styles.actions}>
          <Button
            disabled={busy}
            onClick={() => {
              setDecision('deny');
              void onAnswer({ allow: false });
            }}
          >
            {sending && decision === 'deny' ? 'Sending decision…' : 'Deny'}
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setDecision('allow');
              void onAnswer({ allow: true });
            }}
          >
            {sending && decision === 'allow'
              ? 'Sending decision…'
              : 'Allow once'}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onAnswer({ answers: supplied });
          }}
        >
          <fieldset className={styles.questionFields} disabled={busy}>
            {request.questions?.map((q) => (
              <div key={q.id} className={styles.question}>
                {q.multiple && q.options?.length ? (
                  <>
                    <p>{q.text}</p>
                    {q.options.map((option) => (
                      <Checkbox
                        key={option}
                        mb="xs"
                        label={option}
                        checked={answers[q.id]?.includes(option) ?? false}
                        onChange={(e) =>
                          setAnswers({
                            ...answers,
                            [q.id]: e.currentTarget.checked
                              ? [...(answers[q.id] ?? []), option]
                              : (answers[q.id] ?? []).filter(
                                  (v) => v !== option,
                                ),
                          })
                        }
                      />
                    ))}
                  </>
                ) : q.options?.length ? (
                  <NativeSelect
                    label={q.text}
                    value={answers[q.id]?.[0] ?? ''}
                    data={[
                      { value: '', label: 'Choose an answer' },
                      ...q.options.map((value) => ({ value, label: value })),
                    ]}
                    onChange={(e) => {
                      setOther({ ...other, [q.id]: '' });
                      setAnswers({
                        ...answers,
                        [q.id]: e.currentTarget.value
                          ? [e.currentTarget.value]
                          : [],
                      });
                    }}
                  />
                ) : (
                  <Textarea
                    label={q.text}
                    value={answers[q.id]?.[0] ?? ''}
                    maxLength={4000}
                    onChange={(e) =>
                      setAnswers({
                        ...answers,
                        [q.id]: [e.currentTarget.value],
                      })
                    }
                  />
                )}
                {q.allowOther && !!q.options?.length && (
                  <Textarea
                    mt="sm"
                    label={
                      q.multiple
                        ? 'Additional answer'
                        : 'Or enter your own answer'
                    }
                    value={other[q.id] ?? ''}
                    maxLength={4000}
                    onChange={(e) => {
                      setOther({ ...other, [q.id]: e.currentTarget.value });
                      if (!q.multiple) setAnswers({ ...answers, [q.id]: [] });
                    }}
                  />
                )}
              </div>
            ))}
            <div className={styles.actions}>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  busy ||
                  !request.questions?.every((q) =>
                    supplied[q.id]?.some((v) => v.trim()),
                  )
                }
              >
                {sending ? 'Sending answers…' : 'Send answers'}
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
