import { Notification } from './design-system';

import { PauseProvider } from './features/pauses/PauseControls';
import { useUiFeatures } from './lib/uiFeatures';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';

import { Outlet, useBlocker, useMatch, useNavigate } from 'react-router';
import { automationDraftKey, paths } from './routes/paths';
import { useActionFeedback } from './lib/useActionFeedback';
import type { Workflow, SavedPrompt } from '@interlock/core';
import { Sidebar, type AttentionFailure } from './components/Sidebar/Sidebar';
import { RunDialog } from './features/runs/RunDialog';
import { ConnectDialog } from './components/ConnectDialog/ConnectDialog';
import { errorMessage } from './lib/api';
import { trpc, useQuery, useQueryClient, refreshQueries } from './lib/query';
import { subscribeToEngineEvents } from './lib/engineEvents';
import type { Action } from './lib/useActionFeedback';
import { aiSettingsTab } from './features/executors/aiSettingsNavigation';
import { DiscardChangesDialog } from './components/DiscardChangesDialog';
import type { WorkspaceRead } from './components/WorkspaceReads';
import { WorkflowLayoutNotice } from './features/workflows/WorkflowLayoutNotice';

type EditorGuard = 'dirty' | 'saving' | undefined;

export type AppContext = {
  workflows: Workflow[];
  prompts: SavedPrompt[];
  workflowsRead: WorkspaceRead;
  promptsRead: WorkspaceRead;
  tick: number;
  act: Action;
  onDirty: (dirty: boolean) => void;
  onEditorGuard: (guard: EditorGuard) => void;
  editorNavigationBlocked: boolean;
  onSaved: (workflow: Workflow) => void;
  onRun: (workflow: Workflow) => void;
  onConnect?: () => void;
};
export function App() {
  const features = useUiFeatures();
  const navigate = useNavigate();
  const workflowMatch = useMatch('/workflows/:workflowId');
  const runMatch = useMatch('/runs/*');
  const boardMatch = useMatch('/boards/*');
  const requestMatch = useMatch('/runs/request');
  const automationMatch = useMatch('/automations/*');
  const promptMatch = useMatch('/prompts/*');
  const variableMatch = useMatch('/variables/*');
  const harnessMatch = useMatch(paths.harnesses);
  const diagnosticsMatch = useMatch('/settings/diagnostics');
  const libraryReportMatch = useMatch('/report');
  const workflowReportMatch = useMatch('/workflows/:workflowId/report');
  const reportMatch = libraryReportMatch || workflowReportMatch;
  const page = boardMatch
    ? 'boards'
    : automationMatch
      ? 'automations'
      : diagnosticsMatch
        ? 'diagnostics'
        : reportMatch
          ? 'report'
          : harnessMatch
            ? 'harnesses'
            : variableMatch
              ? 'variables'
              : promptMatch
                ? 'prompts'
                : runMatch
                  ? 'runs'
                  : 'workflows';
  const queryClient = useQueryClient();
  const workflowsQuery = useQuery(trpc.workflows.list.queryOptions());
  const promptsQuery = useQuery(trpc.prompts.list.queryOptions());
  const attentionQuery = useQuery(
    trpc.requests.list.queryOptions({ limit: 1 }),
  );
  const scheduleQuery = useQuery(
    trpc.triggers.attention.queryOptions({ limit: 1 }),
  );
  const connectionQuery = useQuery({
    ...trpc.connection.queryOptions(),
    meta: { engineRefresh: false },
  });
  const workflows = workflowsQuery.data ?? [];
  const prompts = promptsQuery.data ?? [];
  const attentionCount =
    attentionQuery.data && scheduleQuery.data
      ? attentionQuery.data.total + scheduleQuery.data.total
      : undefined;
  const attentionFailures: AttentionFailure[] = [];
  if (attentionQuery.error)
    attentionFailures.push({
      source: 'requests',
      retrying: attentionQuery.isFetching,
      retry: () => void attentionQuery.refetch({ cancelRefetch: false }),
    });
  if (scheduleQuery.error)
    attentionFailures.push({
      source: 'automations',
      retrying: scheduleQuery.isFetching,
      retry: () => void scheduleQuery.refetch({ cancelRefetch: false }),
    });
  const engineHost = connectionQuery.data
    ? new URL(connectionQuery.data.engineUrl).host
    : undefined;
  const [editorDirty, setEditorDirty] = useState(false);
  const editorGuard = useRef<EditorGuard>(undefined);
  const onEditorGuard = useCallback((guard: EditorGuard) => {
    editorGuard.current = guard;
  }, []);
  const blockedWhileSaving = useRef(false);
  const [connectDialog, setConnectDialog] = useState(false);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const leavingEditor =
      currentLocation.pathname !== nextLocation.pathname ||
      (currentLocation.pathname === paths.harnesses &&
        aiSettingsTab(currentLocation) !== aiSettingsTab(nextLocation)) ||
      (currentLocation.pathname === paths.automationNew &&
        automationDraftKey(new URLSearchParams(currentLocation.search)) !==
          automationDraftKey(new URLSearchParams(nextLocation.search)));
    const blocked =
      leavingEditor && (editorDirty || editorGuard.current !== undefined);
    if (blocked)
      blockedWhileSaving.current =
        leavingEditor && editorGuard.current === 'saving';
    return blocked;
  });
  const editorNavigationBlocked =
    blocker.state === 'blocked' && !blockedWhileSaving.current;
  useEffect(() => {
    // A navigation attempted during a save must never proceed after it settles.
    if (blocker.state === 'blocked' && blockedWhileSaving.current)
      blocker.reset();
  }, [blocker]);
  const [tick, setTick] = useState(0);
  const [runDialog, setRunDialog] = useState<Workflow>();
  useEffect(() => {
    let mounted = true;
    let streamHealthy = false;
    let refreshFailed = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const checkConnection = () =>
      void queryClient.refetchQueries(trpc.connection.queryFilter(), {
        cancelRefetch: false,
      });
    const updateRefreshHealth = (failed: boolean) => {
      if (!mounted) return;
      if (failed) checkConnection();
      if (refreshFailed !== failed) {
        refreshFailed = failed;
        resetPolling();
      }
    };
    const update = () => {
      if (document.visibilityState === 'hidden') return;
      if (queryClient.getQueryState(trpc.connection.queryKey())?.error)
        checkConnection();
      void refreshQueries(queryClient).then(
        () =>
          updateRefreshHealth(
            [trpc.workflows.list.queryKey(), trpc.prompts.list.queryKey()].some(
              (key) => queryClient.getQueryState(key)?.error,
            ),
          ),
        () => updateRefreshHealth(true),
      );
      setTick((t) => t + 1);
    };
    const resetPolling = () => {
      clearInterval(interval);
      // The stream reports run and work changes. Refresh other views as well.
      if (document.visibilityState !== 'hidden')
        interval = setInterval(
          update,
          streamHealthy && !refreshFailed ? 60_000 : 5000,
        );
    };
    let pending: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (document.visibilityState === 'hidden') return;
      if (!pending)
        pending = setTimeout(() => {
          pending = undefined;
          update();
        }, 100);
    };
    const onVisibility = () => {
      resetPolling();
      update();
    };
    resetPolling();
    const stopEvents = subscribeToEngineEvents({
      onChange: schedule,
      onConnect: () => {
        streamHealthy = true;
        resetPolling();
        schedule();
      },
      onError: () => {
        streamHealthy = false;
        checkConnection();
        resetPolling();
      },
    });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      stopEvents();
      clearInterval(interval);
      clearTimeout(pending);
    };
  }, [queryClient]);
  const { act, feedback, dismiss, success } = useActionFeedback(async () => {
    await refreshQueries(queryClient);
    setTick((t) => t + 1);
  });
  const openRun = (id: string) => {
    void navigate(paths.run(id, workflowMatch?.params.workflowId));
    setRunDialog(undefined);
  };
  const context: AppContext = {
    workflows,
    prompts,
    workflowsRead: {
      resource: 'workflows',
      ready: workflowsQuery.data !== undefined,
      error: workflowsQuery.error ? errorMessage(workflowsQuery.error) : '',
      fetching: workflowsQuery.isFetching,
      retry: () => void workflowsQuery.refetch({ cancelRefetch: false }),
    },
    promptsRead: {
      resource: 'prompts',
      ready: promptsQuery.data !== undefined,
      error: promptsQuery.error ? errorMessage(promptsQuery.error) : '',
      fetching: promptsQuery.isFetching,
      retry: () => void promptsQuery.refetch({ cancelRefetch: false }),
    },
    tick,
    act,
    onDirty: setEditorDirty,
    onEditorGuard,
    editorNavigationBlocked,
    onSaved: (w) => {
      // Cancellation is synchronous; earlier list reads cannot replace this acknowledgement.
      void queryClient.cancelQueries(trpc.workflows.list.queryFilter());
      queryClient.setQueryData(trpc.workflows.list.queryKey(), (all = []) =>
        all.some((old) => old.id === w.id)
          ? all.map((old) =>
              old.id === w.id
                ? { ...old, draftMatchesLatest: null, ...w, boardId: w.boardId }
                : old,
            )
          : [...all, { draftMatchesLatest: null, layoutRevision: 0, ...w }],
      );
    },
    onRun: setRunDialog,
    onConnect: features.connectAgent ? () => setConnectDialog(true) : undefined,
  };
  return (
    <PauseProvider tick={tick}>
      <div className="app">
        <Sidebar
          compactAt960={Boolean(boardMatch || requestMatch)}
          onConnect={context.onConnect}
          page={page}
          attentionCount={attentionCount}
          attentionFailures={attentionFailures}
          connected={Boolean(connectionQuery.data && !connectionQuery.error)}
          connectionError={Boolean(connectionQuery.error)}
          engineHost={engineHost}
        />
        <main className="main">
          {feedback && (
            <Notification
              key={feedback.id}
              className="action-toast"
              role={feedback.kind === 'error' ? 'alert' : 'status'}
              color={feedback.kind === 'success' ? 'green' : 'red'}
              icon={
                feedback.kind === 'success' ? (
                  <Check size={18} />
                ) : (
                  <AlertCircle size={18} />
                )
              }
              title={
                feedback.kind === 'success' ? 'Success' : 'Something went wrong'
              }
              onClose={dismiss}
              closeButtonProps={{ 'aria-label': 'Dismiss notification' }}
            >
              {feedback.message}
            </Notification>
          )}
          <WorkflowLayoutNotice
            currentWorkflowId={workflowMatch?.params.workflowId}
            onOpen={(id) => void navigate(paths.workflow(id))}
          />
          <Outlet context={context} />
        </main>
        {blocker.state === 'blocked' && editorNavigationBlocked && (
          <DiscardChangesDialog
            onKeepEditing={blocker.reset}
            onDiscard={() => {
              setEditorDirty(false);
              blocker.proceed();
            }}
          />
        )}
        {features.connectAgent && connectDialog && (
          <ConnectDialog onClose={() => setConnectDialog(false)} />
        )}{' '}
        {runDialog && (
          <RunDialog
            workflow={runDialog}
            onClose={() => setRunDialog(undefined)}
            onStarted={(id) => {
              void refreshQueries(queryClient);
              success('Workflow run started.');
              openRun(id);
            }}
          />
        )}
      </div>
    </PauseProvider>
  );
}
