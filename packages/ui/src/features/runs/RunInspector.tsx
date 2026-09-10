import { nodeKindLabel } from '@interlock/core';
import type { Action } from '../../lib/useActionFeedback';
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
import { runProgress } from './runProgress';
import { AgentHandoff } from './AgentHandoff';
import { WorkPanel } from './WorkPanel';
import styles from './RunInspector.module.css';
type Detail = Awaited<ReturnType<typeof api.runs.get.query>> & {
  availableWork: Awaited<ReturnType<typeof api.work.list.query>>;
};
async function inspectRun(id: string): Promise<Detail> {
  const [detail, availableWork] = await Promise.all([
    api.runs.get.query({ id }),
    api.work.list.query({ runId: id }),
  ]);
  return { ...detail, availableWork };
}

export function RunInspector({
  id,
  tick,
  onBack,
  onOpen,
  act,
  onConnect,
}: {
  id: string;
  tick: number;
  onBack: () => void;
  onOpen: (id: string) => void;
  act: Action;
  onConnect: () => void;
}) {
  const [data, setData] = useState<Detail>(),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<{
      nodeId: string;
      runId?: string;
      executionId?: string;
    }>();
  const refresh = () => {
    void inspectRun(id)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(() => {
    let active = true;
    inspectRun(id)
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
  if (!data || data.run.id !== id)
    return <div className="content-page">{error || 'Loading run…'}</div>;
  const { run, definition, events, children, work } = data;
  const descendants = data.descendants ?? [];
  const allWork = data.descendantWork ?? work;
  const progress = runProgress(run, definition, descendants, allWork);
  const nodeId = selected?.nodeId ?? run.executions.at(-1)?.nodeId;
  const node = definition.nodes.find((node) => node.id === nodeId);
  const nodeProgress = nodeId ? progress.nodes[nodeId] : undefined;
  const owner = selected?.runId
    ? [run, ...descendants].find((owner) => owner.id === selected.runId)
    : node?.batchId
      ? undefined
      : run;
  const execution = selected?.executionId
    ? owner?.executions.find(
        (execution) => execution.id === selected.executionId,
      )
    : owner?.executions
        .filter((execution) => execution.nodeId === nodeId)
        .at(-1);
  const itemRuns =
    node?.kind === 'batch'
      ? (execution?.childRunIds ?? []).flatMap((id) => {
          const child = descendants.find((child) => child.id === id);
          return child ? [child] : [];
        })
      : [];
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Button variant="ghost" onClick={onBack} aria-label="Back to runs">
          <ArrowLeft />
        </Button>
        <div>
          <span className="eyebrow">RUN INSPECTOR · V{run.version}</span>
          <h2>{run.workflowName}</h2>
        </div>
        <Badge status={progress.runStates[run.id] ?? run.status} />
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
                }, 'Run retry started.')
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
                }, 'Run cancelled.')
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
      <div className={styles.liveSummary} role="status" aria-live="polite">
        <strong>{progress.title}</strong>
        {progress.detail && <span>{progress.detail}</span>}
        {run.status === 'completed' && (
          <a href="#workflow-result">View result</a>
        )}
      </div>
      {['running', 'waiting'].includes(run.status) &&
        data.availableWork.length > 0 && (
          <div className={styles.handoff}>
            <AgentHandoff key={run.id} runId={run.id} onConnect={onConnect} />
          </div>
        )}
      <div className={styles.body}>
        <section className={styles.overview}>
          <div className={styles.graph}>
            <RunGraph
              key={run.id}
              definition={definition}
              progress={progress.nodes}
              selected={nodeId}
              onSelect={(nodeId) => setSelected({ nodeId })}
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
                onClick={() =>
                  setSelected({
                    nodeId: e.nodeId,
                    runId: run.id,
                    executionId: e.id,
                  })
                }
                className={`${styles.step} ${execution?.id === e.id ? styles.selected : ''}`}
              >
                <span className={styles.index}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <strong>{e.label}</strong>
                  <small>
                    {nodeKindLabel(e.kind)} ·{' '}
                    {new Date(e.startedAt).toLocaleTimeString()}
                  </small>
                </div>
                <Badge
                  status={
                    e.status === 'waiting' &&
                    progress.nodes[e.nodeId]?.state === 'running'
                      ? 'running'
                      : e.status
                  }
                />
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
                    <Badge
                      status={progress.runStates[child.id] ?? child.status}
                    />
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
              <section id="workflow-result" className={styles.result}>
                <h3>Workflow result</h3>
                {typeof run.output === 'string' ? (
                  <pre>{run.output}</pre>
                ) : (
                  <JsonEditor label="Output" value={run.output} />
                )}
              </section>
            )}
          </div>
        </section>
        <aside className={styles.detail}>
          <div className="inspector-heading">
            <span className="eyebrow">EXECUTION DETAILS</span>
            <h2>{node?.label ?? 'Workflow input'}</h2>
          </div>
          <div className="inspector-fields">
            {nodeProgress && (
              <p className={styles.progressLabel}>{nodeProgress.label}</p>
            )}
            {node?.batchId && (
              <section>
                <h3>Item executions</h3>
                <p className="hint">
                  Select an item to inspect its own input, output, and
                  assignment.
                </p>
                {nodeProgress?.items.length ? (
                  nodeProgress.items.map((item) => (
                    <button
                      key={item.run.id}
                      className={`${styles.child} ${owner?.id === item.run.id ? styles.selected : ''}`}
                      onClick={() =>
                        setSelected({ nodeId: node.id, runId: item.run.id })
                      }
                    >
                      <span>
                        Item {item.index + 1}
                        <small>{item.run.id.slice(0, 8)}</small>
                      </span>
                      <Badge status={item.state} />
                    </button>
                  ))
                ) : (
                  <p className="hint">No items have started yet.</p>
                )}
              </section>
            )}
            {itemRuns.length > 0 && (
              <section>
                <h3>Batch items</h3>
                {itemRuns.map((child, index) => (
                  <button
                    key={child.id}
                    className={styles.child}
                    onClick={() => onOpen(child.id)}
                  >
                    <span>
                      Item {index + 1}
                      <small>{child.id.slice(0, 8)}</small>
                    </span>
                    <Badge
                      status={progress.runStates[child.id] ?? child.status}
                    />
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </section>
            )}
            {owner && owner.id !== run.id && (
              <Button onClick={() => onOpen(owner.id)}>Open item run</Button>
            )}
            {selected && !execution && (
              <p className="hint">
                {node?.batchId && !owner
                  ? 'Choose an item above to see its data.'
                  : 'This step has not started.'}
              </p>
            )}
            {execution?.resumeAt && (
              <p className="hint">
                {execution.status === 'waiting'
                  ? 'Resumes at'
                  : 'Scheduled for'}{' '}
                {new Date(execution.resumeAt).toLocaleString()}
              </p>
            )}
            {execution?.port === 'timeout' && (
              <p className="hint">Followed Timeout with the original input.</p>
            )}
            {execution?.error && (
              <p className="error-banner">{execution.error}</p>
            )}
            {execution?.request && (
              <>
                <JsonEditor label="HTTP request" value={execution.request} />
                {execution.completedAt && (
                  <p className="hint">
                    Duration:{' '}
                    {Date.parse(execution.completedAt) -
                      Date.parse(execution.startedAt)}{' '}
                    ms
                  </p>
                )}
              </>
            )}
            {(execution || !nodeId) && (
              <JsonEditor label="Input" value={execution?.input ?? run.input} />
            )}
            {execution?.output !== undefined && (
              <JsonEditor label="Output" value={execution.output} />
            )}{' '}
            {allWork
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
