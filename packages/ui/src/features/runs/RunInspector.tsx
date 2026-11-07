import { formatDuration } from '../workflows/DurationInput';
import { PauseBanner } from '../pauses/PauseControls';
import {
  LoadingSkeleton,
  Placeholder,
} from '../../components/LoadingSkeleton/LoadingSkeleton';
import { CopyButton, Menu, ScrollArea } from '@mantine/core';
import { nodeKindLabel, type RunStatus } from '@interlock/core';
import type { Action } from '../../lib/useActionFeedback';
import { useEffect, useRef, useState } from 'react';
import { needsManagedAttention } from '../executors/managedStatus';
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
import { detachedBoundary } from './runScope';
import { AgentHandoff } from './AgentHandoff';
import { WorkPanel } from './WorkPanel';
import { ActionError } from '../../components/ActionError/ActionError';
import { manualClaims } from './manualClaims';
import styles from './RunInspector.module.css';
import { ComparisonContext } from './ComparisonContext';
import { RunUsage } from './RunUsage';
import { RunVersionDialog } from './RunVersionDialog';
import { runProjectionText } from './runProjectionText';
import { RunTags } from './RunTags';
const stallLabels = {
  unclaimedStallMs: 'Unclaimed stall',
  claimedIdleStallMs: 'Claimed idle stall',
  humanWaitStallMs: 'External input stall',
  runStallMs: 'Run transition stall',
};
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
  initialExecutionId,
}: {
  id: string;
  tick: number;
  onBack: (status: RunStatus) => void;
  onOpen: (id: string, executionId?: string) => void;
  initialExecutionId?: string;
  act: Action;
  onConnect?: () => void;
}) {
  const detailRef = useRef<HTMLElement>(null);
  const focusReview = useRef(false);
  const resultDrafts = useRef(new Map<string, string>());
  const retryPending = useRef(false);
  const [retrying, setRetrying] = useState(false);
  const [retryRequested, setRetryRequested] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [versionDialog, setVersionDialog] = useState(false);
  const [returnMenuFocus, setReturnMenuFocus] = useState(true);
  const [data, setData] = useState<Detail>(),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<{
      nodeId: string;
      runId?: string;
      executionId?: string;
    }>();
  useEffect(() => {
    if (!focusReview.current) return;
    focusReview.current = false;
    detailRef.current?.focus();
    detailRef.current?.scrollIntoView?.({ block: 'start' });
  }, [selected]);
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
  useEffect(() => {
    if (!data) return;
    const drafts = resultDrafts.current;
    const active = new Set(
      (data.descendantWork ?? data.work)
        .filter(
          (work) =>
            work.status === 'claimed' &&
            manualClaims.get(work.id)?.attempt === work.attempt &&
            manualClaims.get(work.id)?.workerId === work.workerId,
        )
        .map((work) => `${work.id}:${work.attempt}`),
    );
    for (const key of drafts.keys()) if (!active.has(key)) drafts.delete(key);
  }, [data]);
  if (!data || data.run.id !== id)
    return error ? (
      <div className="content-page" role="alert">
        {error}
      </div>
    ) : (
      <LoadingSkeleton label="Loading run…" className={styles.page}>
        <header className={styles.header}>
          <Placeholder h={28} w={32} />
          <div>
            <Placeholder h={16} w="min(42vw, 200px)" />
            <Placeholder mt={8} h={10} w={60} />
          </div>
        </header>
        <div className={styles.liveSummary}>
          <Placeholder h={15} w="min(55vw, 220px)" />
        </div>
        <div className={styles.body}>
          <div className={styles.detail}>
            <div className="inspector-heading">
              <Placeholder h={16} w="55%" />
            </div>
            <div className="inspector-fields">
              <Placeholder h={100} />
            </div>
          </div>
          <div className={styles.overview}>
            <div className={styles.graph}>
              <Placeholder mt="xl" mx="auto" h={72} w="min(42%, 180px)" />
            </div>
          </div>
        </div>
      </LoadingSkeleton>
    );
  const { run, definition, events, children, work } = data;
  const select = (target: NonNullable<typeof selected>, focus = false) => {
    focusReview.current =
      focus || window.matchMedia?.('(max-width: 1100px)').matches;
    setSelected(target);
  };
  const retry = async () => {
    if (retryPending.current) return;
    retryPending.current = true;
    setRetrying(true);
    setRetryRequested(false);
    setRetryError('');
    try {
      await act(
        async () => {
          await api.runs.retry.mutate({ id });
          setRetryRequested(true);
          refresh();
        },
        undefined,
        setRetryError,
      );
    } finally {
      retryPending.current = false;
      setRetrying(false);
    }
  };
  const descendants = data.descendants ?? [];
  const allWork = data.descendantWork ?? work;
  const runIndex = new Map([run, ...descendants].map((r) => [r.id, r]));
  const attention = allWork.filter(
    (w) =>
      needsManagedAttention(w) && !detachedBoundary(w.runId, run.id, runIndex),
  );
  const independent = descendants.filter(
    (r) =>
      r.parentMode === 'detached' &&
      ['queued', 'running', 'waiting'].includes(r.status),
  );
  const requestedExecution =
    !selected && run.executions.find((e) => e.id === initialExecutionId);
  const progress = runProgress(run, definition, descendants, allWork);
  const nodeId =
    selected?.nodeId ??
    (requestedExecution ? requestedExecution.nodeId : undefined) ??
    run.executions.at(-1)?.nodeId;
  const node = definition?.nodes.find((node) => node.id === nodeId);
  const nodeProgress = nodeId ? progress.nodes[nodeId] : undefined;
  const owner = selected?.runId
    ? [run, ...descendants].find((owner) => owner.id === selected.runId)
    : node?.batchId !== run.batchNodeId && node?.batchId
      ? undefined
      : run;
  const execution = selected?.executionId
    ? owner?.executions.find(
        (execution) => execution.id === selected.executionId,
      )
    : requestedExecution ||
      owner?.executions
        .filter((execution) => execution.nodeId === nodeId)
        .at(-1);
  const waitingForInput =
    execution?.kind === 'input' && execution.status === 'waiting';
  const progressLabel =
    execution?.kind === 'input' && !waitingForInput
      ? execution.status[0].toUpperCase() + execution.status.slice(1)
      : nodeProgress?.label;
  let holdScope = waitingForInput ? owner : undefined;
  while (
    holdScope &&
    holdScope.id !== run.id &&
    !holdScope.externalInputHold?.heldAt &&
    holdScope.parentMode !== 'detached'
  ) {
    holdScope = holdScope.parentRunId
      ? runIndex.get(holdScope.parentRunId)
      : undefined;
  }
  const inputHeld =
    run.waiting?.kind === 'pause' ||
    Boolean(
      holdScope?.externalInputHold?.heldAt ||
      (holdScope?.id === run.id && data.externalInputHeldByRunId),
    );
  const selectedWork = allWork.filter((w) => w.executionId === execution?.id);
  const assignmentScope = (w: (typeof allWork)[number]) => {
    if (w.runId === run.id) return undefined;
    const item = progress.nodes[w.nodeId]?.items.find(
      (item) => item.run.id === w.runId,
    );
    const owner = runIndex.get(w.runId);
    return owner?.batchNodeId && item
      ? `Item ${item.index + 1}`
      : w.runId !== run.id
        ? `${owner?.workflowName ?? 'Child run'} · ${w.runId.slice(0, 8)}`
        : undefined;
  };
  const reviewWork = (w: (typeof allWork)[number]) => {
    const owner = runIndex.get(w.runId);
    if (owner && owner.id !== run.id && !owner.batchNodeId) {
      onOpen(owner.id, w.executionId);
      return;
    }
    // Choosing a request moves focus to its details after the menu releases its trap.
    setReturnMenuFocus(false);
    select(
      {
        nodeId: w.nodeId,
        runId: w.runId,
        executionId: w.executionId,
      },
      true,
    );
  };
  const itemRuns =
    node?.kind === 'batch'
      ? (execution?.childRunIds ?? []).flatMap((id) => {
          const child = descendants.find((child) => child.id === id);
          return child ? [child] : [];
        })
      : [];
  return (
    <div
      className={`${styles.page} ${!definition ? styles.withoutDefinition : ''} ${run.comparison ? styles.comparison : ''}`}
    >
      <header className={styles.header}>
        <Button
          variant="ghost"
          onClick={() => onBack(run.status)}
          aria-label="Back to runs"
        >
          <ArrowLeft />
        </Button>
        <div>
          <h2>{run.workflowName}</h2>
          <span className={styles.version}>Version {run.version}</span>
          <ComparisonContext comparison={run.comparison} />
        </div>
        <Badge
          status={
            run.status === 'queued'
              ? 'queued'
              : (progress.runStates[run.id] ?? run.status)
          }
        />
        <div className="actions">
          <Button onClick={() => setVersionDialog(true)}>Run version</Button>
          {run.chain?.previousRunId && (
            <Button onClick={() => onOpen(run.chain!.previousRunId!)}>
              Previous run
            </Button>
          )}
          {run.chain?.nextRunId && (
            <Button onClick={() => onOpen(run.chain!.nextRunId!)}>
              Next run
            </Button>
          )}
          {data.chain &&
            !data.chain.cancelledAt &&
            ['queued', 'running', 'waiting', 'failed'].includes(
              data.chain.latestStatus,
            ) && (
              <Button
                onClick={() =>
                  void act(async () => {
                    await api.runs.cancel.mutate({ id, scope: 'chain' });
                    refresh();
                  }, 'Run chain stopped.')
                }
              >
                <Square />
                Stop chain
              </Button>
            )}
          {data.counterpartRunId && (
            <Button onClick={() => onOpen(data.counterpartRunId!)}>
              {run.comparison?.side === 'baseline'
                ? 'Candidate run'
                : 'Baseline run'}
              <ArrowUpRight />
            </Button>
          )}
          {run.parentRunId && (
            <Button
              onClick={() => onOpen(run.parentRunId!, run.parentExecutionId)}
            >
              {run.parentMode === 'detached' ? 'Started by' : 'Parent run'}
            </Button>
          )}
          {run.status === 'failed' && definition && !data.handledFailure && (
            <Button disabled={retrying} onClick={() => void retry()}>
              <RotateCcw />
              {retrying ? 'Requesting retry…' : 'Retry failed step'}
            </Button>
          )}
          {['queued', 'running', 'waiting'].includes(run.status) && (
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
      {Object.keys(run.tags ?? {}).length > 0 && (
        <details className={styles.tags}>
          <summary>Tags ({Object.keys(run.tags!).length})</summary>
          <RunTags tags={run.tags} />
        </details>
      )}
      {versionDialog && (
        <RunVersionDialog
          key={id}
          runId={id}
          workflowId={run.workflowId}
          active={['queued', 'running', 'waiting'].includes(run.status)}
          onClose={() => setVersionDialog(false)}
          onChanged={refresh}
        />
      )}
      <PauseBanner workflowId={run.workflowId} run />
      <div className={styles.liveSummary} role="status" aria-live="polite">
        <strong>
          {run.chain?.nextRunId
            ? 'Continued as new'
            : run.waiting?.kind === 'pause'
              ? 'Paused'
              : progress.title}
        </strong>
        {run.chain && data.chain && (
          <span>
            Chain run {run.chain.index} · {data.chain.maxRuns} run limit
          </span>
        )}
        {data.handledFailure && (
          <span>Failure handled by parent recovery.</span>
        )}
        <span>{runProjectionText(run)}</span>
        {progress.detail && <span>{progress.detail}</span>}
        {retryRequested && <span>Retry requested.</span>}
        {attention.length > 0 && (
          <div className={styles.attentionActions}>
            {attention.length === 1 ? (
              <Button onClick={() => reviewWork(attention[0])}>
                {attention[0].managedExecution?.state === 'needs_model'
                  ? 'Choose a model'
                  : attention[0].managedExecution?.state === 'interrupted'
                    ? 'Review recovery'
                    : 'Review request'}
              </Button>
            ) : (
              <Menu
                position="bottom-end"
                withinPortal
                returnFocus={returnMenuFocus}
                onOpen={() => setReturnMenuFocus(true)}
              >
                <Menu.Target>
                  <Button>Review {attention.length} steps</Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <ScrollArea.Autosize mah={280}>
                    {attention.map((w) => (
                      <Menu.Item key={w.id} onClick={() => reviewWork(w)}>
                        {w.label}
                        {assignmentScope(w)
                          ? ` · ${assignmentScope(w)}`
                          : ''} ·{' '}
                        {w.managedExecution?.state === 'needs_model'
                          ? 'Model needed'
                          : w.managedExecution?.state === 'interrupted'
                            ? 'Recovery'
                            : 'Response needed'}
                      </Menu.Item>
                    ))}
                  </ScrollArea.Autosize>
                </Menu.Dropdown>
              </Menu>
            )}
          </div>
        )}
        {run.status === 'completed' && !run.chain?.nextRunId && (
          <a href="#workflow-result">View result</a>
        )}
      </div>
      <ActionError message={retryError} />
      {!!run.variableCaptures?.length && (
        <details className={styles.independent}>
          <summary>Captured variables</summary>
          {run.variableCaptures.map((v) => (
            <p key={v.referenceId}>
              {v.name} · {v.kind === 'secret' ? 'Secret' : 'Config'} · value
              revision {v.valueRevision}
            </p>
          ))}
        </details>
      )}
      {!!run.promptSnapshots?.length && (
        <details className={styles.independent}>
          <summary>Captured prompts</summary>
          {run.promptSnapshots.map((prompt) => (
            <details key={prompt.id}>
              <summary>
                {prompt.name} · revision {prompt.revision}
              </summary>
              <p className="assignment-prompt">{prompt.content}</p>
            </details>
          ))}
        </details>
      )}
      {independent.length > 0 && (
        <div className={styles.independent}>
          <p>
            {['queued', 'running', 'waiting'].includes(run.status)
              ? 'These independent runs will keep running if you cancel this run.'
              : 'These independent runs are still active.'}
          </p>
          <div className="actions">
            {independent.map((child) => (
              <Button key={child.id} onClick={() => onOpen(child.id)}>
                {child.workflowName} · {child.id.slice(0, 8)}
              </Button>
            ))}
          </div>
        </div>
      )}
      {['queued', 'running', 'waiting'].includes(run.status) &&
        data.availableWork.some(
          (w) => !w.executor && !detachedBoundary(w.runId, run.id, runIndex),
        ) && (
          <div className={styles.handoff}>
            <AgentHandoff key={run.id} runId={run.id} onConnect={onConnect} />
          </div>
        )}
      <div className={styles.body}>
        <aside
          ref={detailRef}
          tabIndex={-1}
          aria-label="Selected step"
          className={styles.detail}
        >
          <div className="inspector-heading">
            <h2>{node?.label ?? execution?.label ?? 'Workflow input'}</h2>
            {selectedWork[0] && assignmentScope(selectedWork[0]) && (
              <p className={styles.stepScope}>
                {assignmentScope(selectedWork[0])}
              </p>
            )}
          </div>
          <div className="inspector-fields">
            {selectedWork.map((w) => {
              const key = `${w.id}:${w.attempt}`;
              return (
                <WorkPanel
                  key={w.id}
                  work={w}
                  onRefresh={refresh}
                  draft={resultDrafts.current.get(key)}
                  onDraftChange={(value) => {
                    if (value === undefined) resultDrafts.current.delete(key);
                    else resultDrafts.current.set(key, value);
                  }}
                />
              );
            })}
            {progressLabel && !selectedWork.some((w) => w.executor) && (
              <p className={styles.progressLabel}>{progressLabel}</p>
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
            {execution?.kind === 'workflow' &&
              execution.childRunIds.map((childId) => {
                const child = runIndex.get(childId);
                return child?.parentMode === 'detached' ? (
                  <section key={child.id}>
                    <h3>Started run</h3>
                    <button
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
                  </section>
                ) : null;
              })}
            {owner && owner.id !== run.id && (
              <Button onClick={() => onOpen(owner.id, execution?.id)}>
                Open item run
              </Button>
            )}
            {selected && !execution && (
              <p className="hint">
                {node?.batchId && !owner
                  ? 'Choose an item above to see its data.'
                  : 'This step has not started.'}
              </p>
            )}
            {waitingForInput && owner && (
              <>
                {(inputHeld ||
                  Boolean(execution.externalInput?.revision) ||
                  progressLabel !== 'Waiting for external input') && (
                  <p className="hint" role="status">
                    {inputHeld
                      ? 'Acceptance on hold'
                      : execution.externalInput?.revision
                        ? 'Waiting for acceptance'
                        : 'Waiting for external input'}
                    {execution.externalInput?.revision
                      ? ` · Revision ${execution.externalInput.revision} pending`
                      : ''}
                  </p>
                )}
                <p className="hint">
                  Waiting since {new Date(execution.startedAt).toLocaleString()}
                </p>
                <CopyButton
                  value={JSON.stringify({
                    runId: owner.id,
                    executionId: execution.id,
                  })}
                >
                  {({ copied, copy }) => (
                    <Button variant="secondary" onClick={copy}>
                      {copied ? 'Copied' : 'Copy submission target'}
                    </Button>
                  )}
                </CopyButton>
              </>
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
            {(execution?.kind === 'script' ||
              execution?.kind === 'fetch' ||
              execution?.kind === 'workflow') &&
              execution.port === 'failed' && (
                <p className="hint">Followed Failed with error data.</p>
              )}
            {execution?.background && (
              <>
                <p className="hint">
                  Background Script: {execution.background.state}. Deadline{' '}
                  {new Date(execution.background.deadline).toLocaleString()}.
                </p>
                {execution.background.progress && (
                  <details>
                    <summary>Script progress</summary>
                    <pre className={styles.errorDetails}>
                      {execution.background.progress}
                    </pre>
                  </details>
                )}
              </>
            )}
            {execution?.check && (
              <>
                <p className="hint">
                  Check {execution.check.count} at{' '}
                  {new Date(execution.check.at).toLocaleString()}
                  {execution.check.error
                    ? ` failed: ${execution.check.error}`
                    : ''}
                </p>
                {execution.check.output !== undefined && (
                  <JsonEditor
                    label="Last check output"
                    value={execution.check.output}
                  />
                )}
              </>
            )}
            {execution?.kind === 'switch' && execution.port && (
              <p className="hint">Followed route {execution.port}.</p>
            )}
            {data.stalls?.items
              .filter((s) => s.executionId === execution?.id)
              .map((s) => (
                <section key={s.id}>
                  <h3>Stalled</h3>
                  <p>
                    {stallLabels[s.kind]} after {formatDuration(s.thresholdMs)}{' '}
                    of active time. Waiting since{' '}
                    {new Date(s.since).toLocaleString()}.
                  </p>
                </section>
              ))}
            {execution &&
              data.work
                .filter(
                  (w) => w.executionId === execution.id && w.maxExecutionMs,
                )
                .map((w) => (
                  <p className="hint" key={w.id}>
                    {w.status === 'claimed'
                      ? `Attempt ${w.attempt} active execution limit`
                      : 'Active execution limit per attempt'}
                    : {formatDuration(w.maxExecutionMs!)}. Lease renewal does
                    not extend this limit.
                  </p>
                ))}
            {execution?.error && (
              <details>
                <summary>Error details</summary>
                <pre className={styles.errorDetails}>{execution.error}</pre>
              </details>
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
            <details
              className={styles.stepData}
              open={selectedWork.some((w) => w.executor) ? undefined : true}
            >
              <summary>Step data</summary>
              {(execution || !nodeId) && (
                <JsonEditor
                  label="Input"
                  value={execution ? execution.input : run.input}
                />
              )}
              {execution?.result !== undefined && (
                <JsonEditor label="Accepted result" value={execution.result} />
              )}
              {execution?.output !== undefined && (
                <JsonEditor
                  label={
                    execution.result !== undefined
                      ? 'Forwarded output'
                      : 'Output'
                  }
                  value={execution.output}
                />
              )}{' '}
            </details>
          </div>
        </aside>
        <section className={styles.overview}>
          <div
            className={`${styles.graph} ${!definition ? styles.unavailableGraph : ''}`}
          >
            {definition ? (
              <RunGraph
                key={run.id}
                definition={definition}
                progress={progress.nodes}
                selected={nodeId}
                onSelect={(nodeId) => select({ nodeId })}
              />
            ) : (
              <p className="hint">
                Published version v{run.version} was removed. Graph inspection
                and retry are unavailable. Stored results, execution details,
                events, and child runs remain available.
              </p>
            )}
          </div>
          <div className={styles.log}>
            <div className="section-heading">
              <h3>Execution timeline</h3>
              <code>{run.id.slice(0, 8)}</code>
            </div>
            {run.error &&
              !run.executions.some(
                (execution) => execution.error === run.error,
              ) && (
                <details>
                  <summary>Run error details</summary>
                  <pre className={styles.errorDetails}>{run.error}</pre>
                </details>
              )}
            {run.executions.map((e, i) => (
              <button
                key={e.id}
                onClick={() =>
                  select({
                    nodeId: e.nodeId,
                    runId: run.id,
                    executionId: e.id,
                  })
                }
                aria-pressed={execution?.id === e.id}
                className={`${styles.step} ${execution?.id === e.id ? styles.selected : ''}`}
              >
                <span className={styles.index}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className={styles.stepContent}>
                  <strong>{e.label}</strong>
                  <small>
                    {nodeKindLabel(e.kind)} · v{e.version ?? run.version} ·{' '}
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
                      <small>
                        {child.parentMode === 'detached'
                          ? 'Started independently · '
                          : ''}
                        {child.id.slice(0, 8)}
                      </small>
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
            {run.status === 'completed' && !run.chain?.nextRunId && (
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
          <RunUsage id={id} tick={tick} />
        </section>
      </div>
    </div>
  );
}
