import { useEffect, useState } from 'react';
import { Badge, Checkbox, NativeSelect, Textarea } from '@mantine/core';
import type {
  ExecutorAnswer,
  ExecutorRequest,
  WorkRequest,
} from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { api, errorMessage } from '../../lib/api';
import styles from './ManagedExecutionPanel.module.css';
import { permissionLabels } from './permissions';

type Inspection = Awaited<ReturnType<typeof api.executors.inspect.query>>;
export function ManagedExecutionPanel({
  work,
  onRefresh,
}: {
  work: Omit<WorkRequest, 'token'>;
  onRefresh: () => void;
}) {
  const [inspection, setInspection] = useState<Inspection>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const refresh = async () =>
    setInspection(await api.executors.inspect.query({ workId: work.id }));
  useEffect(() => {
    let alive = true;
    void api.executors.inspect
      .query({ workId: work.id })
      .then((result) => {
        if (alive) setInspection(result);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [work]);
  useEffect(() => {
    setConfirmed(false);
    setInspection(undefined);
  }, [work.id, work.attempt]);
  const record = inspection?.items[0];
  const perform = async (fn: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      await refresh();
      onRefresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!record)
    return error ? (
      <p role="alert" className="error-text">
        {error}
      </p>
    ) : null;
  const pending = record.requests.filter((r) => r.state === 'pending');
  return (
    <div className={styles.panel}>
      <div className={styles.heading}>
        <strong>{record.profile.name}</strong>
        <Badge
          tt="none"
          variant="light"
          color={
            record.state === 'needs_human'
              ? 'yellow'
              : record.state === 'interrupted'
                ? 'orange'
                : 'blue'
          }
        >
          {record.state.replaceAll('_', ' ')}
        </Badge>
        <span>Attempt {record.attempt}</span>
      </div>
      {record.error && <p className={styles.reason}>{record.error}</p>}
      {pending.map((request) => (
        <Request
          key={request.id}
          request={request}
          busy={busy}
          onAnswer={(answer) =>
            perform(() =>
              api.executors.manage.mutate({
                action: 'respond',
                executionId: record.id,
                requestId: request.id,
                answer,
              }),
            )
          }
        />
      ))}
      {record.state === 'interrupted' && (
        <div className={styles.recovery}>
          <Checkbox
            checked={confirmed}
            onChange={(e) => setConfirmed(e.currentTarget.checked)}
            label="I confirmed this harness session and its subprocesses have stopped"
          />
          <Button
            disabled={!confirmed || busy}
            onClick={() =>
              void perform(() =>
                api.executors.manage.mutate({
                  action: 'reconcile',
                  executionId: record.id,
                  confirmStopped: true,
                }),
              )
            }
          >
            Confirm stopped{work.status === 'held' ? ' and retry' : ''}
          </Button>
        </div>
      )}
      <details className={styles.details}>
        <summary>
          Execution details
          {record.logCount ? ` · ${record.logCount} updates` : ''}
        </summary>
        <dl>
          <dt>Harness</dt>
          <dd>{record.profile.harness}</dd>
          <dt>Permissions</dt>
          <dd>
            {permissionLabels[record.profile.permissions] ?? 'Standard'}
            {record.permissionSource
              ? ` · ${record.permissionSource === 'workflow' ? 'workflow override' : 'harness default'}`
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
                  ? ` · ${record.modelSource === 'node' ? 'node override' : record.modelSource === 'workflow' ? 'workflow override' : record.modelSource === 'harness' ? 'harness default' : 'CLI default'}`
                  : ''}
              </dd>
            </>
          )}
          <dt>Thinking effort</dt>
          <dd>
            {record.profile.effort ?? 'Native default'}
            {record.effortSource
              ? ` · ${record.effortSource === 'node' ? 'node override' : record.effortSource === 'workflow' ? 'workflow override' : record.effortSource === 'harness' ? 'harness default' : 'native default'}`
              : ''}
          </dd>
          {record.sessionId && (
            <>
              <dt>Session</dt>
              <dd>{record.sessionId}</dd>
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
          Recent progress only. Full conversations stay in the harness.{' '}
          {inspection && inspection.total > 1
            ? `${inspection.total} attempts recorded.`
            : ''}
        </p>
        {['starting', 'running', 'needs_human'].includes(record.state) && (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void perform(() =>
                api.executors.manage.mutate({
                  action: 'stop',
                  executionId: record.id,
                }),
              )
            }
          >
            Stop execution
          </Button>
        )}
      </details>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  );
}
function Request({
  request,
  busy,
  onAnswer,
}: {
  request: ExecutorRequest;
  busy: boolean;
  onAnswer: (answer: ExecutorAnswer) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
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
    <section className={styles.request}>
      <h4>{request.title}</h4>
      {request.detail && <pre>{request.detail}</pre>}
      {request.kind === 'permission' ? (
        <div className={styles.actions}>
          <Button
            disabled={busy}
            onClick={() => void onAnswer({ allow: false })}
          >
            Deny
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => void onAnswer({ allow: true })}
          >
            Allow once
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onAnswer({ answers: supplied });
          }}
        >
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
                            : (answers[q.id] ?? []).filter((v) => v !== option),
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
                    setAnswers({ ...answers, [q.id]: [e.currentTarget.value] })
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
              Send answers
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
