import {
  Link,
  Navigate,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
  type RouteObject,
} from 'react-router';
import { App, type AppContext } from '../App';
import { WorkflowLibrary } from '../features/workflows/WorkflowLibrary';
import { WorkflowEditor } from '../features/workflows/WorkflowEditor';
import { RunList } from '../features/runs/RunList';
import { RunInspector } from '../features/runs/RunInspector';
import { paths } from './paths';

function LibraryRoute() {
  const { workflows, act, loaded, loadError } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  if (!loaded) return <Loading error={loadError} />;
  return (
    <WorkflowLibrary
      workflows={workflows}
      act={act}
      onOpen={(id) => void navigate(paths.workflow(id))}
    />
  );
}

function Loading({ error }: { error: string }) {
  return (
    <div className="content-page" role={error ? 'alert' : 'status'}>
      {error || 'Loading workflows…'}
    </div>
  );
}

function WorkflowRoute() {
  const { workflowId } = useParams();
  const context = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const workflow = context.workflows.find((w) => w.id === workflowId);
  if (!context.loaded) return <Loading error={context.loadError} />;
  if (!workflow) return <NotFound title="Workflow not found" />;
  return (
    <WorkflowEditor
      key={workflow.id}
      workflow={workflow}
      workflows={context.workflows}
      act={context.act}
      onDirty={context.onDirty}
      onSaved={context.onSaved}
      onRun={context.onRun}
      onBack={() => void navigate(paths.workflows)}
    />
  );
}

function RunsRoute() {
  const { runs } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  return (
    <RunList
      runs={runs}
      tab={search.get('tab') === 'history' ? 'history' : 'active'}
      onTabChange={(tab) =>
        setSearch((previous) => {
          const next = new URLSearchParams(previous);
          if (tab === 'history') next.set('tab', tab);
          else next.delete('tab');
          return next;
        })
      }
      onOpen={(id) => void navigate(paths.run(id))}
    />
  );
}

function RunRoute() {
  const { runId } = useParams();
  const { tick, act, onConnect, runs } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const run = runs.find((r) => r.id === runId);
  const tab =
    run && !['running', 'waiting'].includes(run.status) ? 'history' : 'active';
  return (
    <RunInspector
      key={runId}
      id={runId!}
      tick={tick}
      act={act}
      onConnect={onConnect}
      onOpen={(id) => void navigate(paths.run(id))}
      onBack={() => void navigate(paths.runs(tab))}
    />
  );
}

function NotFound({ title = 'Page not found' }: { title?: string }) {
  return (
    <div className="content-page">
      <h1>{title}</h1>
      <Link to={paths.workflows}>Back to workflows</Link>
    </div>
  );
}

// A shared layout keeps connections alive while child routes change. Future
// folder/group pages can be siblings without changing resource URLs.
export const routes: RouteObject[] = [
  {
    Component: App,
    children: [
      { index: true, element: <Navigate to={paths.workflows} replace /> },
      { path: 'workflows', Component: LibraryRoute },
      { path: 'workflows/:workflowId', Component: WorkflowRoute },
      { path: 'runs', Component: RunsRoute },
      { path: 'runs/:runId', Component: RunRoute },
      { path: '*', Component: NotFound },
    ],
  },
];
