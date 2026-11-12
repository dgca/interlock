import { Notification } from './design-system';

import { PauseProvider } from './features/pauses/PauseControls';
import { useUiFeatures } from './lib/uiFeatures';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';

import { Outlet, useBlocker, useMatch, useNavigate } from 'react-router';
import { automationDraftKey, paths } from './routes/paths';
import { useActionFeedback } from './lib/useActionFeedback';
import { workflowCatalogEntry, type Workflow } from '@interlock/core';
import { TRPCClientError } from '@interlock/client';
import { Sidebar, type AttentionFailure } from './components/Sidebar/Sidebar';
import { RunDialog } from './features/runs/RunDialog';
import { ConnectDialog } from './components/ConnectDialog/ConnectDialog';
import { trpc, useQuery, useQueryClient, refreshQueries } from './lib/query';
import { subscribeToEngineEvents } from './lib/engineEvents';
import type { Action } from './lib/useActionFeedback';
import { aiSettingsTab } from './features/executors/aiSettingsNavigation';
import { DiscardChangesDialog } from './components/DiscardChangesDialog';
import { WorkflowLayoutNotice } from './features/workflows/WorkflowLayoutNotice';

function isRetryableReadFailure(error: unknown) {
  if (
    !(error instanceof TRPCClientError) ||
    error.data?.domainRejection === true
  )
    return false;
  const response = error.meta?.response;
  const status =
    error.data?.httpStatus ??
    (response instanceof Response ? response.status : undefined);
  return (
    status === undefined ||
    status < 400 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

type EditorGuard = 'dirty' | 'saving' | undefined;

export type AppContext = {
  act: Action;
  onDirty: (dirty: boolean) => void;
  onEditorGuard: (guard: EditorGuard) => void;
  editorNavigationBlocked: boolean;
  onSaved: (
    workflow: Workflow & {
      layoutRevision?: number;
      draftMatchesLatest?: boolean | null;
    },
  ) => void;
  onPublicationChecked: (workflowId: string, latestVersion: number) => number;
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
  const harnessMatch = useMatch({ path: paths.harnesses, end: false });
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
            queryClient
              .getQueryCache()
              .findAll({ type: 'active' })
              .some(
                (query) =>
                  query.meta?.engineRefresh !== false &&
                  isRetryableReadFailure(query.state.error),
              ),
          ),
        () => updateRefreshHealth(true),
      );
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
  const { act, feedback, dismiss, success } = useActionFeedback(() =>
    refreshQueries(queryClient),
  );
  const openRun = (id: string) => {
    void navigate(
      paths.run(id, { workflowId: workflowMatch?.params.workflowId }),
    );
    setRunDialog(undefined);
  };
  const context: AppContext = {
    act,
    onDirty: setEditorDirty,
    onEditorGuard,
    editorNavigationBlocked,
    onSaved: (workflow) => {
      const detailKey = trpc.workflows.get.queryKey({ id: workflow.id });
      const current = queryClient.getQueryData(detailKey);
      // A membership receipt has no layout overlay. Keep the observed draft.
      const saved =
        workflow.layoutRevision === undefined && current
          ? { ...current, boardId: workflow.boardId }
          : current &&
              (current.draftRevision > workflow.draftRevision ||
                current.latestVersion > workflow.latestVersion)
            ? current
            : {
                ...workflow,
                layoutRevision: workflow.layoutRevision ?? 0,
                draftMatchesLatest: workflow.draftMatchesLatest ?? null,
              };
      void queryClient.cancelQueries({ queryKey: detailKey, exact: true });
      queryClient.setQueryData(detailKey, saved);

      const catalogKey = trpc.workflows.catalog.queryKey();
      const catalog = queryClient.getQueryData(catalogKey);
      if (!catalog) return;
      void queryClient.cancelQueries({ queryKey: catalogKey, exact: true });
      const entry = workflowCatalogEntry(saved);
      queryClient.setQueryData(
        catalogKey,
        catalog.some((item) => item.id === saved.id)
          ? catalog.map((item) => (item.id === saved.id ? entry : item))
          : [...catalog, entry],
      );
    },
    onPublicationChecked: (workflowId, latestVersion) => {
      const detailKey = trpc.workflows.get.queryKey({ id: workflowId });
      const detail = queryClient.getQueryData(detailKey);
      const catalogKeys = [
        trpc.workflows.catalog.queryKey(),
        trpc.workflows.catalog.queryKey({ id: workflowId }),
        ...(detail?.boardId
          ? [trpc.workflows.catalog.queryKey({ boardId: detail.boardId })]
          : []),
        ...(detail?.ownerWorkflowId
          ? [
              trpc.workflows.catalog.queryKey({
                ownerWorkflowId: detail.ownerWorkflowId,
              }),
            ]
          : []),
      ];
      const catalogs = catalogKeys.map((key) => {
        const rows = queryClient.getQueryData(key);
        return { key, rows, entry: rows?.find((row) => row.id === workflowId) };
      });
      const acknowledged = Math.max(
        latestVersion,
        detail?.latestVersion ?? 0,
        ...catalogs.map(({ entry }) => entry?.latestVersion ?? 0),
      );
      function retainVersion<T>(
        key: readonly unknown[],
        before: T | undefined,
        after: T | undefined,
      ) {
        const exact = { queryKey: key, exact: true };
        const pending =
          queryClient.getQueryState(key)?.fetchStatus === 'fetching';
        // An earlier snapshot can carry an older version. Keep the known data
        // through cancellation and refresh, including when the retry fails.
        if (pending) void queryClient.cancelQueries(exact);
        if (after !== undefined && (pending || after !== before))
          queryClient.setQueryData(key, after);
        if (pending)
          void queryClient.refetchQueries(exact, { cancelRefetch: false });
      }
      retainVersion(
        detailKey,
        detail,
        detail && detail.latestVersion < acknowledged
          ? { ...detail, latestVersion: acknowledged, draftMatchesLatest: null }
          : detail,
      );
      for (const { key, rows, entry } of catalogs)
        retainVersion(
          key,
          rows,
          entry && entry.latestVersion < acknowledged
            ? rows?.map((row) =>
                row === entry ? { ...row, latestVersion: acknowledged } : row,
              )
            : rows,
        );
      return acknowledged;
    },
    onRun: setRunDialog,
    onConnect: features.connectAgent ? () => setConnectDialog(true) : undefined,
  };
  return (
    <PauseProvider>
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
