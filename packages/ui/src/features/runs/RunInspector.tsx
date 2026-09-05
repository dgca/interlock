import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  RotateCcw,
  Square,
  Download,
} from 'lucide-react';

import { api, download, errorMessage } from '../../lib/api';
import { Button } from '../../components/Button/Button';
import { Badge } from '../../components/Badge/Badge';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { RunGraph } from './RunGraph';
import { WorkPanel } from './WorkPanel';
import styles from './RunInspector.module.css';
type Detail = Awaited<ReturnType<typeof api.runs.get.query>>;

export function RunInspector({
  id,
  tick,
  onBack,
  onOpen,
  act,
}: {
  id: string;
  tick: number;
  onBack: () => void;
  onOpen: (id: string) => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [data, setData] = useState<Detail>(),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<string>();
  const refresh = () => {
    void api.runs.get
      .query({ id })
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(() => {
    let active = true;
    api.runs.get
      .query({ id })
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [id, tick]);
  if (!data)
    return <div className="content-page">{error || 'Loading run…'}</div>;
  const { run, definition, events, children, work } = data;
  const execution =
    run.executions.find((e) => e.id === selected) ?? run.executions.at(-1);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Button
          variant="ghost"
          onClick={onBack}
          aria-label="Back to run history"
        >
          <ArrowLeft />
        </Button>
        <div>
          <span className="eyebrow">RUN INSPECTOR · V{run.version}</span>
          <h2>{run.workflowName}</h2>
        </div>
        <Badge status={run.status} />
        <div className="actions">
          {run.parentRunId && (
            <Button onClick={() => onOpen(run.parentRunId!)}>Parent run</Button>
          )}
          {run.status === 'failed' && (
            <Button
              onClick={() =>
                void act(async () => {
                  await api.runs.retry.mutate({ id });
                  refresh();
                })
              }
            >
              <RotateCcw />
              Retry failed step
            </Button>
          )}
          {['running', 'waiting'].includes(run.status) && (
            <Button
              onClick={() =>
                void act(async () => {
                  await api.runs.cancel.mutate({ id });
                  refresh();
                })
              }
            >
              <Square />
              Cancel run
            </Button>
          )}
          <Button onClick={() => download(`run-${id}.json`, data)}>
            <Download />
            Export run
          </Button>
        </div>
      </header>
      <div className={styles.body}>
        <section className={styles.overview}>
          <div className={styles.graph}>
            <RunGraph
              definition={definition}
              executions={run.executions}
              onSelect={setSelected}
            />
          </div>
          <div className={styles.log}>
            <div className="section-heading">
              <h3>Execution timeline</h3>
              <code>{run.id.slice(0, 8)}</code>
            </div>
            {run.error && <p className="error-banner">{run.error}</p>}
            {run.executions.map((e, i) => (
              <button
                key={e.id}
                onClick={() => setSelected(e.id)}
                className={`${styles.step} ${execution?.id === e.id ? styles.selected : ''}`}
              >
                <span className={styles.index}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <strong>{e.label}</strong>
                  <small>
                    {e.kind} · {new Date(e.startedAt).toLocaleTimeString()}
                  </small>
                </div>
                <Badge status={e.status} />
              </button>
            ))}
            {children.length > 0 && (
              <>
                <h3 className={styles.childTitle}>Child runs</h3>
                {children.map((child) => (
                  <button
                    key={child.id}
                    className={styles.child}
                    onClick={() => onOpen(child.id)}
                  >
                    <span>
                      {child.workflowName}
                      <small>{child.id.slice(0, 8)}</small>
                    </span>
                    <Badge status={child.status} />
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </>
            )}
            <details className={styles.events}>
              <summary>Run events · {events.length}</summary>
              {events.map((e) => (
                <div key={e.id}>
                  <time>{new Date(e.at).toLocaleTimeString()}</time>
                  <span>{e.message}</span>
                </div>
              ))}
            </details>
            {run.status === 'completed' && (
              <JsonEditor label="Workflow result" value={run.output} />
            )}
          </div>
        </section>
        <aside className={styles.detail}>
          <div className="inspector-heading">
            <span className="eyebrow">EXECUTION DETAILS</span>
            <h2>{execution?.label ?? 'Workflow input'}</h2>
          </div>
          <div className="inspector-fields">
            {execution?.error && (
              <p className="error-banner">{execution.error}</p>
            )}
            <JsonEditor label="Input" value={execution?.input ?? run.input} />
            {execution?.output !== undefined && (
              <JsonEditor label="Output" value={execution.output} />
            )}{' '}
            {work
              .filter((w) => w.executionId === execution?.id)
              .map((w) => (
                <WorkPanel key={w.id} work={w} onRefresh={refresh} />
              ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
