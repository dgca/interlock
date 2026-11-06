import { useUiFeatures } from './lib/uiFeatures';
import { useCallback, useEffect, useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { Button, Group, Modal, Notification, Text } from '@mantine/core';
import { Outlet, useBlocker, useMatch, useNavigate } from 'react-router';
import { paths } from './routes/paths';
import { useActionFeedback } from './lib/useActionFeedback';
import type { RunAttention, Workflow, SavedPrompt } from '@interlock/core';
import { Sidebar } from './components/Sidebar/Sidebar';
import { RunDialog } from './features/runs/RunDialog';
import { ConnectDialog } from './components/ConnectDialog/ConnectDialog';
import { api, errorMessage } from './lib/api';
import { subscribeToEngineEvents } from './lib/engineEvents';
import type { Action } from './lib/useActionFeedback';

export type AppContext = {
  workflows: Workflow[];
  prompts: SavedPrompt[];
  loaded: boolean;
  loadError: string;
  tick: number;
  act: Action;
  onDirty: (dirty: boolean) => void;
  onSaved: (workflow: Workflow) => void;
  onRun: (workflow: Workflow) => void;
  onConnect?: () => void;
};
export function App() {
  const features = useUiFeatures();
  const navigate = useNavigate();
  const workflowMatch = useMatch('/workflows/:workflowId');
  const runMatch = useMatch('/runs/*');
  const promptMatch = useMatch('/prompts/*');
  const variableMatch = useMatch('/variables/*');
  const harnessMatch = useMatch('/settings/harnesses');
  const page = harnessMatch
    ? 'harnesses'
    : variableMatch
      ? 'variables'
      : promptMatch
        ? 'prompts'
        : runMatch
          ? 'runs'
          : 'workflows';
  const [editorDirty, setEditorDirty] = useState(false);
  const [connectDialog, setConnectDialog] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [engineHost, setEngineHost] = useState<string>();
  useEffect(() => {
    let active = true;
    void api.connection
      .query()
      .then((config) => {
        if (active) setEngineHost(new URL(config.engineUrl).host);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const [loadError, setLoadError] = useState('');
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      editorDirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const [workflows, setWorkflows] = useState<Workflow[]>([]),
    [prompts, setPrompts] = useState<SavedPrompt[]>([]),
    [attention, setAttention] = useState<RunAttention[]>([]),
    [connected, setConnected] = useState(false),
    [tick, setTick] = useState(0),
    [runDialog, setRunDialog] = useState<Workflow>();
  const refresh = useCallback(async () => {
    const [w, p, a] = await Promise.all([
      api.workflows.list.query(),
      api.prompts.list.query(),
      api.runs.attention.query(),
    ]);
    setWorkflows(w);
    setPrompts(p);
    setAttention(a);
    setConnected(true);
    setLoaded(true);
    setLoadError('');
  }, []);
  useEffect(() => {
    let mounted = true;
    let streamHealthy = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      if (document.visibilityState === 'hidden') return;
      void refresh().catch((e) => {
        if (mounted) {
          setConnected(false);
          setLoadError(errorMessage(e));
        }
      });
      setTick((t) => t + 1);
    };
    const resetPolling = () => {
      clearInterval(interval);
      // The stream reports run and work changes. Refresh other views as well.
      if (document.visibilityState !== 'hidden')
        interval = setInterval(update, streamHealthy ? 60_000 : 5000);
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
    onVisibility();
    const stopEvents = subscribeToEngineEvents({
      onChange: schedule,
      onConnect: () => {
        streamHealthy = true;
        setConnected(true);
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
    loadError,
    tick,
    act,
    onDirty: setEditorDirty,
    onSaved: (w) =>
      setWorkflows((all) =>
        all.some((old) => old.id === w.id)
          ? all.map((old) => (old.id === w.id ? w : old))
          : [...all, w],
      ),
    onRun: setRunDialog,
    onConnect: features.connectAgent ? () => setConnectDialog(true) : undefined,
  };
  return (
    <div className="app">
      <Sidebar
        onConnect={context.onConnect}
        page={page}
        attentionCount={attention.length}
        connected={connected}
        engineHost={engineHost}
        onNavigate={(next) =>
          void navigate(
            next === 'harnesses'
              ? paths.harnesses
              : next === 'runs'
                ? paths.runs()
                : next === 'prompts'
                  ? paths.prompts
                  : next === 'variables'
                    ? paths.variables
                    : paths.workflows,
          )
        }
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
        <Outlet context={context} />
      </main>
      <Modal
        opened={blocker.state === 'blocked'}
        onClose={() => blocker.state === 'blocked' && blocker.reset()}
        title="Discard unsaved changes?"
        centered
      >
        <Text>You have changes that have not been saved.</Text>
        <Group justify="flex-end" mt="md">
          <Button
            variant="default"
            onClick={() => blocker.state === 'blocked' && blocker.reset()}
          >
            Keep editing
          </Button>
          <Button
            color="red"
            onClick={() => {
              if (blocker.state === 'blocked') {
                setEditorDirty(false);
                blocker.proceed();
              }
            }}
          >
            Discard changes
          </Button>
        </Group>
      </Modal>
      {features.connectAgent && connectDialog && (
        <ConnectDialog onClose={() => setConnectDialog(false)} />
      )}{' '}
      {runDialog && (
        <RunDialog
          workflow={runDialog}
          onClose={() => setRunDialog(undefined)}
          onStarted={(id) => {
            success('Workflow run started.');
            openRun(id);
          }}
        />
      )}
    </div>
  );
}
