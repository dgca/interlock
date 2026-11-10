import {
  Button,
  Group,
  Notification,
  Text,
  Modal,
  ModalBody,
  ModalFooter,
} from './design-system';

import { PauseProvider } from './features/pauses/PauseControls';
import { useUiFeatures } from './lib/uiFeatures';
import { useCallback, useEffect, useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';

import { Outlet, useBlocker, useMatch, useNavigate } from 'react-router';
import { paths } from './routes/paths';
import { useActionFeedback } from './lib/useActionFeedback';
import type { Workflow, SavedPrompt } from '@interlock/core';
import { Sidebar } from './components/Sidebar/Sidebar';
import { RunDialog } from './features/runs/RunDialog';
import { ConnectDialog } from './components/ConnectDialog/ConnectDialog';
import { errorMessage } from './lib/api';
import { trpc, useQuery, useQueryClient, refreshQueries } from './lib/query';
import { subscribeToEngineEvents } from './lib/engineEvents';
import type { Action } from './lib/useActionFeedback';
import { aiSettingsTab } from './features/executors/aiSettingsNavigation';
import { WorkflowLayoutNotice } from './features/workflows/WorkflowLayoutNotice';

export type AppContext = {
  workflows: Workflow[];
  prompts: SavedPrompt[];
  loaded: boolean;
  loadError: string;
  retryLoad: () => Promise<void>;
  tick: number;
  act: Action;
  onDirty: (dirty: boolean) => void;
  onScheduleDirty: (dirty: boolean) => void;
  onSchedulePending: (pending: boolean) => void;
  onSaved: (workflow: Workflow) => void;
  onRun: (workflow: Workflow) => void;
  onConnect?: () => void;
};
export function App() {
  const features = useUiFeatures();
  const navigate = useNavigate();
  const workflowMatch = useMatch('/workflows/:workflowId');
  const runMatch = useMatch('/runs/*');
  const automationMatch = useMatch('/automations/*');
  const promptMatch = useMatch('/prompts/*');
  const variableMatch = useMatch('/variables/*');
  const harnessMatch = useMatch(paths.harnesses);
  const diagnosticsMatch = useMatch('/settings/diagnostics');
  const libraryReportMatch = useMatch('/report');
  const workflowReportMatch = useMatch('/workflows/:workflowId/report');
  const reportMatch = libraryReportMatch || workflowReportMatch;
  const page = automationMatch
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
  const attentionQuery = useQuery(trpc.runs.attention.queryOptions());
  const scheduleQuery = useQuery(
    trpc.triggers.attention.queryOptions({ limit: 1 }),
  );
  const connectionQuery = useQuery({
    ...trpc.connection.queryOptions(),
    meta: { engineRefresh: false },
  });
  const workflows = workflowsQuery.data ?? [];
  const prompts = promptsQuery.data ?? [];
  const attention = attentionQuery.data ?? [];
  const scheduleAttentionCount = scheduleQuery.data?.total ?? 0;
  const loaded = [
    workflowsQuery,
    promptsQuery,
    attentionQuery,
    scheduleQuery,
  ].every((query) => query.data !== undefined);
  const readError = [
    workflowsQuery,
    promptsQuery,
    attentionQuery,
    scheduleQuery,
  ].find((query) => query.error)?.error;
  const engineHost = connectionQuery.data
    ? new URL(connectionQuery.data.engineUrl).host
    : undefined;
  const [editorDirty, setEditorDirty] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [schedulePending, setSchedulePending] = useState(false);
  const [connectDialog, setConnectDialog] = useState(false);
  const [loadError, setLoadError] = useState('');
  const effectiveLoadError =
    loadError || (readError ? errorMessage(readError) : '');
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      (editorDirty &&
        (currentLocation.pathname !== nextLocation.pathname ||
          (currentLocation.pathname === paths.harnesses &&
            aiSettingsTab(currentLocation) !== aiSettingsTab(nextLocation)))) ||
      ((scheduleDirty || schedulePending) &&
        (currentLocation.pathname !== nextLocation.pathname ||
          currentLocation.search !== nextLocation.search)),
  );
  const [connected, setConnected] = useState(false),
    [tick, setTick] = useState(0),
    [runDialog, setRunDialog] = useState<Workflow>();
  useEffect(() => {
    if (readError) setConnected(false);
    else if (loaded && !loadError) setConnected(true);
  }, [loaded, readError, loadError]);
  const refresh = useCallback(async () => {
    await refreshQueries(queryClient);
    const workspaceError = [
      trpc.workflows.list.queryKey(),
      trpc.prompts.list.queryKey(),
      trpc.runs.attention.queryKey(),
      trpc.triggers.attention.queryKey({ limit: 1 }),
    ]
      .map((key) => queryClient.getQueryState(key)?.error)
      .find(Boolean);
    if (workspaceError) throw workspaceError;
    setConnected(true);
    setLoadError('');
  }, [queryClient]);
  const retryLoad = useCallback(async () => {
    try {
      await refresh();
      setTick((t) => t + 1);
    } catch (e) {
      setConnected(false);
      setLoadError(errorMessage(e));
    }
  }, [refresh]);
  useEffect(() => {
    let mounted = true;
    let streamHealthy = false;
    let refreshFailed = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      if (document.visibilityState === 'hidden') return;
      void refresh().then(
        () => {
          if (mounted && refreshFailed) {
            refreshFailed = false;
            resetPolling();
          }
        },
        (e) => {
          if (!mounted) return;
          setConnected(false);
          setLoadError(errorMessage(e));
          if (!refreshFailed) {
            refreshFailed = true;
            resetPolling();
          }
        },
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
        setConnected(false);
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
  }, [refresh]);
  const { act, feedback, dismiss, success } = useActionFeedback(async () => {
    await refresh();
    setTick((t) => t + 1);
  });
  const openRun = (id: string) => {
    void navigate(paths.run(id, workflowMatch?.params.workflowId));
    setRunDialog(undefined);
  };
  const context: AppContext = {
    workflows,
    prompts,
    loaded,
    loadError: effectiveLoadError,
    retryLoad,
    tick,
    act,
    onDirty: setEditorDirty,
    onScheduleDirty: setScheduleDirty,
    onSchedulePending: setSchedulePending,
    onSaved: (w) => {
      // Cancellation is synchronous; earlier list reads cannot replace this acknowledgement.
      void queryClient.cancelQueries(trpc.workflows.list.queryFilter());
      queryClient.setQueryData(trpc.workflows.list.queryKey(), (all = []) =>
        all.some((old) => old.id === w.id)
          ? all.map((old) =>
              old.id === w.id
                ? { ...old, draftMatchesLatest: null, ...w }
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
          onConnect={context.onConnect}
          page={page}
          attentionCount={attention.length + scheduleAttentionCount}
          connected={connected}
          connectionError={!!effectiveLoadError}
          engineHost={engineHost}
        />
        <main className="main">
          {loaded && effectiveLoadError && (
            <Group className="engine-warning" justify="space-between" gap="xs">
              <Text size="sm" role="status">
                Could not refresh workspace data. Open views may be out of date.
              </Text>
              <Button variant="secondary" onClick={() => void retryLoad()}>
                Retry connection
              </Button>
            </Group>
          )}
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
        {blocker.state === 'blocked' && (
          <Modal
            onClose={() => blocker.state === 'blocked' && blocker.reset()}
            title="Discard unsaved changes?"
          >
            <ModalBody>
              <Text>You have changes that have not been saved.</Text>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                onClick={() => blocker.state === 'blocked' && blocker.reset()}
              >
                Keep editing
              </Button>
              <Button
                variant="danger"
                disabled={schedulePending}
                onClick={() => {
                  if (blocker.state === 'blocked') {
                    setEditorDirty(false);
                    setScheduleDirty(false);
                    blocker.proceed();
                  }
                }}
              >
                Discard changes
              </Button>
            </ModalFooter>
          </Modal>
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
