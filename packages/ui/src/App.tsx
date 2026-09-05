import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Run, Workflow } from '@interlock/core';
import { Sidebar } from './components/Sidebar/Sidebar';
import { Button } from './components/Button/Button';
import { WorkflowLibrary } from './features/workflows/WorkflowLibrary';
import { WorkflowEditor } from './features/workflows/WorkflowEditor';
import { RunHistory } from './features/runs/RunHistory';
import { RunInspector } from './features/runs/RunInspector';
import { RunDialog } from './features/runs/RunDialog';
import { ConnectDialog } from './components/ConnectDialog/ConnectDialog';
import { api, errorMessage } from './lib/api';
export function App() {
  const [editorDirty, setEditorDirty] = useState(false);
  const [connectDialog, setConnectDialog] = useState(false);
  const [page, setPage] = useState<'workflows' | 'runs'>('workflows'),
    [workflowId, setWorkflowId] = useState<string>(),
    [runId, setRunId] = useState<string>();
  const [workflows, setWorkflows] = useState<Workflow[]>([]),
    [runs, setRuns] = useState<Run[]>([]),
    [error, setError] = useState(''),
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
  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await refresh();
      setTick((t) => t + 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
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
        {error && (
          <div role="alert" className="toast">
            {error}
            <Button
              variant="ghost"
              aria-label="Dismiss error"
              onClick={() => setError('')}
            >
              <X />
            </Button>
          </div>
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
            onOpen={openRun}
            onBack={() => setRunId(undefined)}
            act={act}
          />
        ) : (
          <RunHistory runs={runs} onOpen={openRun} />
        )}
      </main>
      {connectDialog && (
        <ConnectDialog onClose={() => setConnectDialog(false)} />
      )}{' '}
      {runDialog && (
        <RunDialog
          workflow={runDialog}
          onClose={() => setRunDialog(undefined)}
          onStarted={openRun}
        />
      )}
    </div>
  );
}
