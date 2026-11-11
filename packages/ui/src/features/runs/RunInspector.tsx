import {
  LoadingSkeleton,
  Placeholder,
  CopyButton,
  Menu,
  ScrollArea,
  Button,
  JsonEditor,
  ActionError,
  PageHeader,
  workspacePage,
} from '../../design-system';

import { formatDuration } from '../workflows/DurationInput';
import { PauseBanner } from '../pauses/PauseControls';

import {
  nodeKindLabel,
  runDisplayTitle,
  type NodeExecution,
  type Run,
  type RunStatus,
} from '@interlock/core';
import type { Action } from '../../lib/useActionFeedback';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { paths } from '../../routes/paths';
import { ExternalTaskLink } from '../../components/ExternalTaskLink';
import { needsManagedAttention } from '../executors/managedStatus';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Square,
  Download,
} from 'lucide-react';

import { api, download, errorMessage } from '../../lib/api';
import { trpc, useQuery, useQueryClient } from '../../lib/query';

import { StatusBadge } from '../../components/StatusBadge/StatusBadge';

import { RunGraph } from './RunGraph';
import { runProgress } from './runProgress';
import { detachedBoundary } from './runScope';
import { AgentHandoff } from './AgentHandoff';
import { WorkPanel } from './WorkPanel';

import { manualClaims } from './manualClaims';
import styles from './RunInspector.module.css';
import { ComparisonContext } from './ComparisonContext';
import { RunUsage } from './RunUsage';
import { RunVersionDialog } from './RunVersionDialog';
import { RunCancellationDialog } from './RunCancellationDialog';
import { runProjectionLabels } from './runProjectionText';
import { RunTags } from './RunTags';
const stallLabels = {
  unclaimedStallMs: 'Unclaimed stall',
  claimedIdleStallMs: 'Claimed idle stall',
  humanWaitStallMs: 'External input stall',
  runStallMs: 'Run transition stall',
};
type RunReturn = { executionId: string; label: string };

function TimelineStep({
  step,
  owner,
  index,
  expanded,
  selected,
  running,
  onSelect,
}: {
  step: NodeExecution;
  owner: Run;
  index?: number;
  expanded?: boolean;
  selected: boolean;
  running: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-expanded={expanded}
      aria-controls={expanded ? `paths-${step.id}` : undefined}
      className={`${styles.step} ${index === undefined ? styles.pathStep : ''} ${selected ? styles.selected : ''}`}
    >
      {index !== undefined && (
        <span className={styles.index}>
          {String(index + 1).padStart(2, '0')}
        </span>
      )}
      {expanded === true && <ChevronDown size={14} aria-hidden="true" />}
      {expanded === false && <ChevronRight size={14} aria-hidden="true" />}
      <div className={styles.stepContent}>
        <strong>{step.label}</strong>
        <small>
          {nodeKindLabel(step.kind)} · v{step.version ?? owner.version} ·{' '}
          {new Date(step.startedAt).toLocaleTimeString()}
        </small>
      </div>
      <StatusBadge
        status={step.status === 'waiting' && running ? 'running' : step.status}
      />
    </button>
  );
}

export function RunInspector({
  id,
  tick,
  onBack,
  onOpen,
  act,
  onConnect,
  initialExecutionId,
  returnLabel,
}: {
  id: string;
  tick: number;
  onBack: (status: RunStatus) => void;
  onOpen: (id: string, executionId?: string, returnTo?: RunReturn) => void;
  initialExecutionId?: string;
  returnLabel?: string;
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
  const [cancellationDialog, setCancellationDialog] = useState(false);
  const [returnMenuFocus, setReturnMenuFocus] = useState(true);
  const queryClient = useQueryClient();
  const detail = useQuery(trpc.runs.get.queryOptions({ id }));
  const workQuery = useQuery(trpc.work.list.queryOptions({ runId: id }));
  const cancellation = useQuery(
    trpc.runs.previewCancellation.queryOptions({
      id,
      includeDetached: true,
      limit: 1,
    }),
  );
  const previousTick = useRef(tick);
  useEffect(() => {
    if (previousTick.current === tick) return;
    previousTick.current = tick;
    let current = true;
    // Explicit cancellation also supersedes an initial read with no cached
    // data; refetch alone joins that initial request instead of replacing it.
    void Promise.all([
      queryClient.cancelQueries(trpc.runs.get.queryFilter({ id })),
      queryClient.cancelQueries(trpc.work.list.queryFilter({ runId: id })),
      queryClient.cancelQueries(
        trpc.runs.previewCancellation.queryFilter({
          id,
          includeDetached: true,
          limit: 1,
        }),
      ),
    ]).then(() => {
      if (!current) return;
      void detail.refetch();
      void workQuery.refetch();
      void cancellation.refetch();
    });
    return () => {
      current = false;
    };
  }, [
    tick,
    id,
    queryClient,
    detail.refetch,
    workQuery.refetch,
    cancellation.refetch,
  ]);
  const data =
    detail.data && workQuery.data && cancellation.data
      ? {
          ...detail.data,
          availableWork: workQuery.data,
          cancellableRunCount: cancellation.data.total,
        }
      : undefined;
  const failure = detail.error ?? workQuery.error ?? cancellation.error;
  const error = failure ? errorMessage(failure) : '';
  const [selected, setSelected] = useState<{
    nodeId: string;
    runId?: string;
    executionId?: string;
  }>();
  const [collapsedParallelVisit, setCollapsedParallelVisit] =
    useState<string>();
  useEffect(() => {
    if (!focusReview.current) return;
    focusReview.current = false;
    detailRef.current?.focus();
    detailRef.current?.scrollIntoView?.({ block: 'start' });
  }, [selected]);
  const refresh = () => {
    void detail.refetch();
    void workQuery.refetch();
    void cancellation.refetch();
  };
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
        <header className={workspacePage.header} data-two-line>
          <div className={workspacePage.headerHeading}>
            <Placeholder h={28} w={32} />
            <div>
              <Placeholder h={16} w="min(42vw, 200px)" />
              <Placeholder mt={8} h={10} w={60} />
            </div>
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
    setCollapsedParallelVisit(undefined);
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
  const childWorkflows = children.filter(
    (child) => !child.parallelBranch && !child.batchNodeId,
  );
  const attention = allWork.filter(
    (w) =>
      needsManagedAttention(w) && !detachedBoundary(w.runId, run.id, runIndex),
  );
  const independent = descendants.filter(
    (r) =>
      r.parentMode === 'detached' &&
      ['queued', 'running', 'waiting'].includes(r.status),
  );
  const requestedOwner =
    !selected && initialExecutionId
      ? [run, ...children.filter((child) => child.parallelBranch)].find(
          (candidate) =>
            candidate.executions.some((e) => e.id === initialExecutionId),
        )
      : undefined;
  const requestedExecution = requestedOwner?.executions.find(
    (e) => e.id === initialExecutionId,
  );
  const nodeId =
    selected?.nodeId ??
    requestedExecution?.nodeId ??
    run.executions.at(-1)?.nodeId;
  const node = definition?.nodes.find((node) => node.id === nodeId);
  const owner = selected?.runId
    ? runIndex.get(selected.runId)
    : requestedOwner
      ? (runIndex.get(requestedOwner.id) ?? requestedOwner)
      : (node?.batchId && node.batchId !== run.batchNodeId) ||
          (node?.parallelId &&
            (node.parallelId !== run.parallelBranch?.nodeId ||
              node.parallelBranchId !== run.parallelBranch?.id))
        ? undefined
        : run;
  const execution = selected?.executionId
    ? owner?.executions.find((e) => e.id === selected.executionId)
    : (requestedExecution ??
      owner?.executions.findLast((e) => e.nodeId === nodeId));
  const pathOwner =
    owner?.parallelBranch && owner.parentRunId === run.id ? owner : undefined;
  const parallelVisit = pathOwner
    ? run.executions.find((e) => e.id === pathOwner.parentExecutionId)
    : execution?.kind === 'parallel'
      ? execution
      : undefined;
  const progress = runProgress(run, definition, descendants, allWork);
  const graphProgress =
    parallelVisit &&
    run.executions.findLast((step) => step.nodeId === parallelVisit.nodeId)
      ?.id !== parallelVisit.id
      ? runProgress(run, definition, descendants, allWork, parallelVisit).nodes
      : progress.nodes;
  const nodeProgress = nodeId ? graphProgress[nodeId] : undefined;
  const projection = runProjectionLabels(run);
  const attentionStatus =
    attention.length && ['queued', 'running', 'waiting'].includes(run.status)
      ? progress.status
      : undefined;
  const summaryTitle = run.chain?.nextRunId
    ? 'Continued as new'
    : run.waiting?.kind === 'human_request' && attentionStatus
      ? attentionStatus
      : (projection.waiting ?? progress.status);
  const summaryContext = [
    projection.stage,
    progress.nodeLabel !== projection.stage ? progress.nodeLabel : null,
    projection.actor,
  ]
    .filter(Boolean)
    .join(' · ');
  const waitingForInput =
    execution?.kind === 'input' && execution.status === 'waiting';
  const progressLabel =
    execution?.kind === 'input' && !waitingForInput
      ? execution.status[0].toUpperCase() + execution.status.slice(1)
      : execution?.kind === 'parallel'
        ? undefined
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
  const selectExecution = (
    step: NodeExecution,
    stepOwner: Run = run,
    focus = false,
  ) =>
    select(
      { nodeId: step.nodeId, runId: stepOwner.id, executionId: step.id },
      focus,
    );
  const openWorkflow = (child: Run, executionId?: string) => {
    const parent = child.parentRunId && runIndex.get(child.parentRunId);
    const caller =
      parent &&
      (parent.id === run.id ||
        (parent.parallelBranch && parent.parentRunId === run.id))
        ? parent.executions.find((step) => step.childRunIds.includes(child.id))
        : undefined;
    if (caller)
      onOpen(child.id, executionId, {
        executionId: caller.id,
        label: caller.label,
      });
    else onOpen(child.id, executionId);
  };
  const assignmentScope = (w: (typeof allWork)[number]) => {
    if (w.runId === run.id) return undefined;
    const item = progress.nodes[w.nodeId]?.items.find(
      (item) => item.run.id === w.runId,
    );
    const owner = runIndex.get(w.runId);
    if (owner?.parallelBranch) return owner.parallelBranch.key;
    return owner?.batchNodeId && item
      ? `Item ${item.index + 1}`
      : w.runId !== run.id
        ? `${owner?.workflowName ?? 'Child run'} · ${w.runId.slice(0, 8)}`
        : undefined;
  };
  const reviewWork = (w: (typeof allWork)[number]) => {
    const owner = runIndex.get(w.runId);
    if (
      owner &&
      owner.id !== run.id &&
      !owner.batchNodeId &&
      !owner.parallelBranch
    ) {
      openWorkflow(owner, w.executionId);
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
  const group = definition?.nodes.find(
    (candidate) =>
      candidate.kind === 'parallel' && candidate.id === parallelVisit?.nodeId,
  );
  const pathRows = parallelVisit
    ? [
        ...parallelVisit.childRunIds.flatMap((id) => {
          const child = runIndex.get(id);
          return child?.parallelBranch
            ? [
                {
                  id: child.parallelBranch.id,
                  key: child.parallelBranch.key,
                  run: child,
                },
              ]
            : [];
        }),
        ...(group?.kind === 'parallel' &&
        parallelVisit.status !== 'completed' &&
        (parallelVisit.version ?? run.version) === run.version
          ? group.branches
              .slice(parallelVisit.nextItem)
              .map((branch) => ({ ...branch, run: undefined }))
          : []),
      ]
    : [];
  const pathStatus = (child?: Run) =>
    child
      ? (progress.runStates[child.id] ?? child.status)
      : parallelVisit?.status === 'failed' ||
          parallelVisit?.status === 'cancelled'
        ? 'not started'
        : 'queued';
  const parallelParent = run.parallelBranch ? run.parentRunId : undefined;
  const managedSelection = selectedWork.some(
    (work) => work.executor && work.managedExecution?.executionId,
  );
  const stepState =
    execution &&
    !nodeProgress?.items.some((item) => item.execution?.id === execution.id)
      ? execution.status
      : (nodeProgress?.state ?? execution?.status);
  const stepStatus =
    stepState === 'pending' ? 'not_started' : (stepState ?? 'not_started');
  const kind = nodeKindLabel(execution?.kind ?? node?.kind ?? 'entry');
  const kindLabel = kind[0].toUpperCase() + kind.slice(1);
  const stepTitle = execution?.label ?? node?.label ?? 'Workflow input';
  const stepData = (execution || !nodeId) && (
    <details
      className={styles.stepData}
      open={selectedWork.some((w) => w.executor) ? undefined : true}
    >
      <summary>Step data</summary>
      <div className={styles.dataContainer}>
        {(execution || !nodeId) && (
          <JsonEditor
            label="Input"
            rows={5}
            value={execution ? execution.input : run.input}
          />
        )}
        {execution?.result !== undefined && (
          <JsonEditor
            rows={5}
            label="Accepted result"
            value={execution.result}
          />
        )}
        {execution?.output !== undefined && (
          <JsonEditor
            label={
              execution.result !== undefined ? 'Forwarded output' : 'Output'
            }
            rows={5}
            value={execution.output}
          />
        )}
      </div>
    </details>
  );
  return (
    <div
      className={`${styles.page} ${!definition ? styles.withoutDefinition : ''} ${run.comparison ? styles.comparison : ''}`}
    >
      <PageHeader
        title={runDisplayTitle(run)}
        onBack={() =>
          !returnLabel && parallelParent
            ? onOpen(parallelParent, run.parentExecutionId)
            : onBack(run.status)
        }
        backLabel={
          returnLabel ??
          (parallelParent ? 'Back to Parallel group' : 'Back to runs')
        }
        subtitle={
          <div className={styles.metadata}>
            {(run.title || run.externalTask?.title) && (
              <span>{run.workflowName}</span>
            )}
            <span>Version {run.version}</span>
            <ExternalTaskLink task={run.externalTask} />
            <StatusBadge
              status={
                run.status === 'queued'
                  ? 'queued'
                  : (progress.runStates[run.id] ?? run.status)
              }
            />
            <ComparisonContext comparison={run.comparison} />
          </div>
        }
        actions={
          <div className={styles.headerActions}>
            {!run.parallelBranch && (
              <Button onClick={() => setVersionDialog(true)}>
                Run version
              </Button>
            )}
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
            {run.parentRunId && !returnLabel && !parallelParent && (
              <Button
                onClick={() => onOpen(run.parentRunId!, run.parentExecutionId)}
              >
                {run.parentMode === 'detached' ? 'Started by' : 'Parent run'}
              </Button>
            )}
            {run.status === 'failed' &&
              definition &&
              !data.handledFailure &&
              !run.parallelBranch && (
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
            {data.cancellableRunCount > 0 && (
              <Button onClick={() => setCancellationDialog(true)}>
                Cancel run tree
              </Button>
            )}
            <Button onClick={() => download(`run-${id}.json`, data)}>
              <Download />
              Export run
            </Button>
          </div>
        }
      />
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
      {cancellationDialog && (
        <RunCancellationDialog
          key={id}
          runId={id}
          onClose={() => setCancellationDialog(false)}
          onCancelled={refresh}
          onOpen={onOpen}
        />
      )}
      <PauseBanner workflowId={run.workflowId} run />
      <div className={styles.liveSummary} role="status" aria-live="polite">
        <strong>{summaryTitle}</strong>
        {run.chain && data.chain && (
          <span>
            Chain run {run.chain.index} · {data.chain.maxRuns} run limit
          </span>
        )}
        {data.handledFailure && (
          <span>Failure handled by parent recovery.</span>
        )}
        <span>{summaryContext}</span>
        {attentionStatus && attentionStatus !== summaryTitle && (
          <span>{attentionStatus}</span>
        )}
        {run.cancellationReason && (
          <span className={styles.cancellationReason}>
            Cancellation reason: {run.cancellationReason}
          </span>
        )}
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
      <ActionError message={error} />
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
              <Button key={child.id} onClick={() => openWorkflow(child)}>
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
          className={`${styles.detail} ${managedSelection ? styles.managedDetail : ''}`}
        >
          <div className="inspector-heading">
            <h2>{stepTitle}</h2>
            {!managedSelection && (
              <div className={styles.stepMeta}>
                {kindLabel !== stepTitle && <span>{kindLabel}</span>}
                <StatusBadge status={stepStatus} />
              </div>
            )}
            {pathOwner && parallelVisit ? (
              <div className={styles.pathScope}>
                <button
                  type="button"
                  className={styles.pathBack}
                  aria-label={`Back to ${parallelVisit.label}`}
                  onClick={() => selectExecution(parallelVisit, run, true)}
                >
                  <ArrowLeft size={14} />
                  {parallelVisit.label}
                </button>
                <span aria-hidden="true">/</span>
                <span>{pathOwner.parallelBranch?.key}</span>
              </div>
            ) : (
              selectedWork[0] &&
              assignmentScope(selectedWork[0]) && (
                <p className={styles.stepScope}>
                  {assignmentScope(selectedWork[0])}
                </p>
              )
            )}
          </div>
          <div className="inspector-fields">
            {selectedWork.map((w) => {
              const key = `${w.id}:${w.attempt}`;
              return (
                <WorkPanel
                  key={w.id}
                  work={w}
                  details={stepData}
                  onRefresh={refresh}
                  draft={resultDrafts.current.get(key)}
                  onDraftChange={(value) => {
                    if (value === undefined) resultDrafts.current.delete(key);
                    else resultDrafts.current.set(key, value);
                  }}
                />
              );
            })}
            {progressLabel &&
              !waitingForInput &&
              !execution?.resumeAt &&
              !execution?.check &&
              !selectedWork.length &&
              ![
                'queued',
                'not started',
                'running',
                'waiting',
                'finished',
                'completed',
                'failed',
                'cancelled',
              ].includes(progressLabel.toLowerCase()) && (
                <p className={styles.progressLabel}>{progressLabel}</p>
              )}
            {node?.batchId && (
              <section>
                <h3>Item executions</h3>
                <p className="hint">
                  Select an item to inspect its own input, output, and
                  assignment.
                </p>
                <div className={styles.linkedRuns}>
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
                        <StatusBadge status={item.state} />
                      </button>
                    ))
                  ) : (
                    <p className="hint">No items have started yet.</p>
                  )}
                </div>
              </section>
            )}
            {itemRuns.length > 0 && (
              <section>
                <h3>Batch items</h3>
                <div className={styles.linkedRuns}>
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
                      <StatusBadge
                        status={progress.runStates[child.id] ?? child.status}
                      />
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              </section>
            )}
            {execution?.kind === 'parallel' && pathRows.length > 0 && (
              <section aria-label="Parallel paths">
                <h3>Paths</h3>
                <div className={styles.linkedRuns}>
                  {pathRows.map(({ id, key, run: child }) => {
                    const step = child?.executions.at(-1);
                    return step && child ? (
                      <button
                        key={id}
                        type="button"
                        className={styles.child}
                        onClick={() => selectExecution(step, child, true)}
                      >
                        <span className={styles.branchName}>{key}</span>
                        <StatusBadge status={pathStatus(child)} />
                        <ChevronRight size={14} />
                      </button>
                    ) : (
                      <div key={id} className={styles.branchPending}>
                        <span className={styles.branchName}>{key}</span>
                        <StatusBadge status={pathStatus(child)} />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            {execution?.kind === 'workflow' &&
              execution.childRunIds.map((childId) => {
                const child = runIndex.get(childId);
                return child ? (
                  <section key={child.id}>
                    <h3>
                      {child.parentMode === 'detached'
                        ? 'Started run'
                        : 'Child run'}
                    </h3>
                    <div className={styles.linkedRuns}>
                      <button
                        className={styles.child}
                        onClick={() => openWorkflow(child)}
                      >
                        <span>
                          {child.workflowName}
                          <small>{child.id.slice(0, 8)}</small>
                        </span>
                        <StatusBadge
                          status={progress.runStates[child.id] ?? child.status}
                        />
                        <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </section>
                ) : null;
              })}
            {owner?.batchNodeId && owner.id !== run.id && (
              <Button onClick={() => onOpen(owner.id, execution?.id)}>
                Open item run
              </Button>
            )}
            {selected && !execution && (
              <p className={styles.statePanel}>
                {node?.batchId && !owner
                  ? 'Choose an item above to see its data.'
                  : 'This step has not started.'}
              </p>
            )}
            {execution?.humanInput && owner && (
              <section className={styles.statePanel} aria-label="Human input">
                <p>{execution.humanInput.question}</p>
                <Button
                  component={Link}
                  to={paths.request({
                    kind: 'human',
                    runId: owner.id,
                    executionId: execution.id,
                  })}
                  state={{
                    returnTo: paths.run(
                      run.id,
                      undefined,
                      'attention',
                      execution.id,
                    ),
                  }}
                >
                  {execution.externalInput?.acceptedAt
                    ? 'View answer and evidence'
                    : 'View request'}
                </Button>
              </section>
            )}
            {waitingForInput && owner && !execution.humanInput && (
              <section
                className={styles.statePanel}
                aria-label="External input status"
              >
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
              </section>
            )}
            {execution?.resumeAt && (
              <p className={styles.statePanel}>
                {execution.status === 'waiting'
                  ? 'Resumes at'
                  : 'Scheduled for'}{' '}
                {new Date(execution.resumeAt).toLocaleString()}
              </p>
            )}
            {execution?.port === 'timeout' && (
              <p className={styles.statePanel}>
                Followed Timeout with the original input.
              </p>
            )}
            {(execution?.kind === 'script' ||
              execution?.kind === 'fetch' ||
              execution?.kind === 'workflow') &&
              execution.port === 'failed' && (
                <p className={styles.statePanel}>
                  Followed Failed with error data.
                </p>
              )}
            {execution?.background && (
              <section>
                <h3>Script execution</h3>
                <div className={styles.statePanel}>
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
                </div>
              </section>
            )}
            {execution?.check && (
              <section>
                <h3>Latest check</h3>
                <div className={styles.statePanel}>
                  <p className="hint">
                    Check {execution.check.count} at{' '}
                    {new Date(execution.check.at).toLocaleString()}
                    {execution.check.error
                      ? ` failed: ${execution.check.error}`
                      : ''}
                  </p>
                  {execution.nextCheckAt && (
                    <p className="hint">
                      Next check{' '}
                      {new Date(execution.nextCheckAt).toLocaleString()}
                    </p>
                  )}
                  {execution.timeoutAt && (
                    <p className="hint">
                      Deadline {new Date(execution.timeoutAt).toLocaleString()}
                    </p>
                  )}
                  {execution.check.output !== undefined && (
                    <JsonEditor
                      label="Last check output"
                      rows={5}
                      value={execution.check.output}
                    />
                  )}
                </div>
              </section>
            )}
            {(execution?.kind === 'switch' ||
              execution?.kind === 'condition') &&
              execution.port && (
                <p className={styles.statePanel}>
                  Followed route <strong>{execution.port}</strong>.
                </p>
              )}
            {data.stalls?.items
              .filter((s) => s.executionId === execution?.id)
              .map((s) => (
                <section key={s.id}>
                  <h3>Stalled</h3>
                  <p className={styles.statePanel}>
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
              <details key={execution.id} className={styles.errorPanel} open>
                <summary>Error details</summary>
                <pre className={styles.errorDetails}>{execution.error}</pre>
              </details>
            )}
            {execution?.request && (
              <section>
                <div className={styles.statePanel}>
                  <JsonEditor
                    label="HTTP request"
                    rows={5}
                    value={execution.request}
                  />
                  {execution.completedAt && (
                    <p className="hint">
                      Duration:{' '}
                      {Date.parse(execution.completedAt) -
                        Date.parse(execution.startedAt)}{' '}
                      ms
                    </p>
                  )}
                </div>
              </section>
            )}
            {!selectedWork.some(
              (w) => w.executor && w.managedExecution?.executionId,
            ) && stepData}
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
                progress={graphProgress}
                selected={nodeId}
                onSelect={(nodeId) => {
                  if (parallelVisit?.nodeId === nodeId) {
                    selectExecution(parallelVisit);
                    return;
                  }
                  const member = definition.nodes.find(
                    (node) => node.id === nodeId,
                  );
                  const branch = member?.parallelId
                    ? graphProgress[nodeId]?.items[0]
                    : undefined;
                  select({
                    nodeId,
                    ...(branch
                      ? {
                          runId: branch.run.id,
                          executionId: branch.execution?.id,
                        }
                      : {}),
                  });
                }}
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
            {run.executions.map((e, i) => {
              const expanded =
                e.kind === 'parallel' &&
                parallelVisit?.id === e.id &&
                collapsedParallelVisit !== e.id &&
                pathRows.length > 0;
              return (
                <div key={e.id}>
                  <TimelineStep
                    step={e}
                    owner={run}
                    index={i}
                    expanded={e.kind === 'parallel' ? expanded : undefined}
                    selected={execution?.id === e.id}
                    running={
                      graphProgress[e.nodeId]?.items[0]?.execution?.id ===
                        e.id && graphProgress[e.nodeId]?.state === 'running'
                    }
                    onSelect={() => {
                      selectExecution(e);
                      if (expanded && execution?.id === e.id)
                        setCollapsedParallelVisit(e.id);
                    }}
                  />
                  {expanded && (
                    <div
                      className={styles.parallelHistory}
                      id={`paths-${e.id}`}
                    >
                      {pathRows.map(({ id, key, run: child }) => (
                        <section
                          key={id}
                          aria-label={key}
                          className={styles.pathHistory}
                        >
                          <div className={styles.pathHeading}>
                            <h4>{key}</h4>
                            <StatusBadge status={pathStatus(child)} />
                          </div>
                          {child?.executions.map((step) => (
                            <TimelineStep
                              key={step.id}
                              step={step}
                              owner={child}
                              selected={execution?.id === step.id}
                              running={
                                graphProgress[step.nodeId]?.items[0]?.execution
                                  ?.id === step.id &&
                                graphProgress[step.nodeId]?.state === 'running'
                              }
                              onSelect={() => selectExecution(step, child)}
                            />
                          ))}
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {childWorkflows.length > 0 && (
              <>
                <h3 className={styles.childTitle}>Child runs</h3>
                {childWorkflows.map((child) => (
                  <button
                    key={child.id}
                    className={styles.child}
                    onClick={() => openWorkflow(child)}
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
                    <StatusBadge
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
