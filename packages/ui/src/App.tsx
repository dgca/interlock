import { useCallback, useEffect, useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { Button, Group, Modal, Notification, Text } from '@mantine/core';
import { Outlet, useBlocker, useMatch, useNavigate } from 'react-router';
import { paths } from './routes/paths';
import { useActionFeedback } from './lib/useActionFeedback';
import type { Run, Workflow } from '@interlock/core';
import { Sidebar } from './components/Sidebar/Sidebar';
import { RunDialog } from './features/runs/RunDialog';
import { ConnectDialog } from './components/ConnectDialog/ConnectDialog';
import { api, errorMessage } from './lib/api';
import type { Action } from './lib/useActionFeedback';

export type AppContext = {
  workflows: Workflow[];
  runs: Run[];
  loaded: boolean;
  loadError: string;
  tick: number;
  act: Action;
  onDirty: (dirty: boolean) => void;
  onSaved: (workflow: Workflow) => void;
  onRun: (workflow: Workflow) => void;
  onConnect: () => void;
};
export function App() {
  const navigate = useNavigate();
  const page = useMatch('/runs/*') ? 'runs' : 'workflows';
  const [editorDirty, setEditorDirty] = useState(false);
  const [connectDialog, setConnectDialog] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      editorDirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const [workflows, setWorkflows] = useState<Workflow[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [connected, setConnected] = useState(false),
    [tick, setTick] = useState(0),
    [runDialog, setRunDialog] = useState<Workflow>();
  const refresh = useCallback(async () => {
    const [w, r] = await Promise.all([
      api.workflows.list.query(),
      api.runs.list.query(),
    ]);
    setWorkflows(w);
    setRuns(r);
    setConnected(true);
    setLoaded(true);
    setLoadError('');
  }, []);
  useEffect(() => {
    let mounted = true;
    const update = () => {
      void refresh().catch((e) => {
        if (mounted) {
          setConnected(false);
          setLoadError(errorMessage(e));
        }
      });
      setTick((t) => t + 1);
    };
    let pending: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!pending)
        pending = setTimeout(() => {
          pending = undefined;
          update();
        }, 100);
    };
    update();
    const stream = new EventSource('/events');
    stream.addEventListener('change', schedule);
    stream.addEventListener('connected', () => setConnected(true));
    stream.onerror = () => setConnected(false);
    const interval = setInterval(update, 5000);
    return () => {
      mounted = false;
      stream.close();
      clearInterval(interval);
      clearTimeout(pending);
    };
  }, [refresh]);
  const { act, feedback, dismiss, success } = useActionFeedback(async () => {
    await refresh();
    setTick((t) => t + 1);
  });
  const openRun = (id: string) => {
    void navigate(paths.run(id));
    setRunDialog(undefined);
  };
  const context: AppContext = {
    workflows,
    runs,
    loaded,
    loadError,
    tick,
    act,
    onDirty: setEditorDirty,
    onSaved: (w) =>
      setWorkflows((all) => all.map((old) => (old.id === w.id ? w : old))),
    onRun: setRunDialog,
    onConnect: () => setConnectDialog(true),
  };
  return (
    <div className="app">
      <Sidebar
        onConnect={() => setConnectDialog(true)}
        page={page}
        connected={connected}
        onNavigate={(next) =>
          void navigate(next === 'runs' ? paths.runs() : paths.workflows)
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
        <Text>Your workflow has changes that have not been saved.</Text>
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
      {connectDialog && (
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
