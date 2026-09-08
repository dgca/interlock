import { useCallback, useEffect, useState } from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { Notification } from '@mantine/core';
import { useActionFeedback } from './lib/useActionFeedback';
import type { Run, Workflow } from '@interlock/core';
import { Sidebar } from './components/Sidebar/Sidebar';
import { WorkflowLibrary } from './features/workflows/WorkflowLibrary';
import { WorkflowEditor } from './features/workflows/WorkflowEditor';
import { WorkflowActivity } from './features/runs/WorkflowActivity';
import { RunInspector } from './features/runs/RunInspector';
import { RunDialog } from './features/runs/RunDialog';
import { ConnectDialog } from './components/ConnectDialog/ConnectDialog';
import { api } from './lib/api';
export function App() {
  const [activityTab, setActivityTab] = useState<'active' | 'history'>(
    'active',
  );
  const [editorDirty, setEditorDirty] = useState(false);
  const [connectDialog, setConnectDialog] = useState(false);
  const [page, setPage] = useState<'workflows' | 'runs'>('workflows'),
    [workflowId, setWorkflowId] = useState<string>(),
    [runId, setRunId] = useState<string>();
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
  }, []);
  useEffect(() => {
    let mounted = true;
    const update = () => {
      void refresh().catch((e) => {
        if (mounted) {
          setConnected(false);
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
    setRunId(id);
    setPage('runs');
    setRunDialog(undefined);
  };
  const selected = workflows.find((w) => w.id === workflowId);
  return (
    <div className="app">
      <Sidebar
        onConnect={() => setConnectDialog(true)}
        page={page}
        connected={connected}
        onNavigate={(next) => {
          if (editorDirty && !window.confirm('Discard unsaved changes?'))
            return;
          setEditorDirty(false);
          setPage(next);
          setWorkflowId(undefined);
          setRunId(undefined);
        }}
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
        {page === 'workflows' ? (
          selected ? (
            <WorkflowEditor
              onDirty={setEditorDirty}
              key={selected.id}
              workflow={selected}
              workflows={workflows}
              act={act}
              onSaved={(w) =>
                setWorkflows((all) =>
                  all.map((old) => (old.id === w.id ? w : old)),
                )
              }
              onBack={() => setWorkflowId(undefined)}
              onRun={setRunDialog}
            />
          ) : (
            <WorkflowLibrary
              workflows={workflows}
              onOpen={setWorkflowId}
              act={act}
            />
          )
        ) : runId ? (
          <RunInspector
            key={runId}
            id={runId}
            tick={tick}
            onConnect={() => setConnectDialog(true)}
            onOpen={openRun}
            onBack={() => setRunId(undefined)}
            act={act}
          />
        ) : (
          <WorkflowActivity
            runs={runs}
            onOpen={openRun}
            tab={activityTab}
            onTabChange={setActivityTab}
          />
        )}
      </main>
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
