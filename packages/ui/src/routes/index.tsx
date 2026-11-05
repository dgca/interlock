import { runTab as parseRunTab } from '../features/runs/runAttention';
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
import { Harnesses } from '../features/executors/Harnesses';
import { paths } from './paths';
import { flushSync } from 'react-dom';
import { PromptLibrary, PromptEditor } from '../features/prompts/Prompts';
import {
  VariableLibrary,
  VariableRoute,
} from '../features/variables/Variables';

function PromptsRoute() {
  const context = useOutletContext<AppContext>();
  if (!context.loaded) return <Loading error={context.loadError} />;
  return <PromptLibrary prompts={context.prompts} act={context.act} />;
}
function PromptRoute() {
  const { promptId } = useParams();
  const context = useOutletContext<AppContext>();
  const prompt = context.prompts.find((p) => p.id === promptId);
  if (!context.loaded) return <Loading error={context.loadError} />;
  if (!prompt) return <NotFound title="Prompt not found" />;
  return (
    <PromptEditor
      key={prompt.id}
      prompt={prompt}
      act={context.act}
      onDirty={context.onDirty}
      tick={context.tick}
    />
  );
}

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
  const [search, setSearch] = useSearchParams();
  const runTab = parseRunTab(search.get('tab'));
  const workflow = context.workflows.find((w) => w.id === workflowId);
  if (!context.loaded) return <Loading error={context.loadError} />;
  if (!workflow) return <NotFound title="Workflow not found" />;
  return (
    <WorkflowEditor
      key={workflow.id}
      workflow={workflow}
      workflows={context.workflows}
      prompts={context.prompts}
      act={context.act}
      onDirty={context.onDirty}
      onSaved={context.onSaved}
      onRun={context.onRun}
      onBack={() =>
        void navigate(
          workflow.ownerWorkflowId
            ? paths.workflow(workflow.ownerWorkflowId)
            : paths.workflows,
        )
      }
      onOpenWorkflow={(id) => void navigate(paths.workflow(id))}
      onDeleted={() => {
        flushSync(() => context.onDirty(false));
        void navigate(
          workflow.ownerWorkflowId
            ? paths.workflow(workflow.ownerWorkflowId)
            : paths.workflows,
        );
      }}
      section={
        search.get('view') === 'runs'
          ? 'runs'
          : search.get('view') === 'children' && !workflow.ownerWorkflowId
            ? 'children'
            : 'editor'
      }
      onSectionChange={(section) =>
        setSearch((previous) => {
          const next = new URLSearchParams(previous);
          if (section !== 'editor') next.set('view', section);
          else next.delete('view');
          return next;
        })
      }
      runsView={
        <RunList
          runs={context.runs}
          attention={context.attention}
          act={context.act}
          workflows={context.workflows}
          workflowId={workflow.id}
          tab={runTab}
          onTabChange={(tab) =>
            setSearch((previous) => {
              const next = new URLSearchParams(previous);
              if (tab !== 'active') next.set('tab', tab);
              else next.delete('tab');
              return next;
            })
          }
          onOpen={(id, executionId) =>
            void navigate(paths.run(id, workflow.id, runTab, executionId))
          }
        />
      }
    />
  );
}

function RunsRoute() {
  const { runs, attention, act, workflows } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  return (
    <RunList
      runs={runs}
      attention={attention}
      act={act}
      workflows={workflows}
      tab={parseRunTab(search.get('tab'))}
      onTabChange={(tab) =>
        setSearch((previous) => {
          const next = new URLSearchParams(previous);
          if (tab !== 'active') next.set('tab', tab);
          else next.delete('tab');
          return next;
        })
      }
      onOpen={(id, executionId) =>
        void navigate(
          paths.run(id, undefined, parseRunTab(search.get('tab')), executionId),
        )
      }
    />
  );
}

function RunRoute() {
  const { runId } = useParams();
  const { tick, act, onConnect, runs } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const workflowId = search.get('workflow') || undefined;
  const returnTab = parseRunTab(search.get('tab'));
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
      initialExecutionId={search.get('execution') ?? undefined}
      onOpen={(id, executionId) =>
        void navigate(paths.run(id, workflowId, returnTab, executionId))
      }
      onBack={() =>
        void navigate(
          workflowId
            ? paths.workflowRuns(workflowId, returnTab)
            : paths.runs(returnTab === 'attention' ? 'attention' : tab),
        )
      }
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
      { path: 'prompts', Component: PromptsRoute },
      { path: 'variables', Component: VariableLibrary },
      { path: 'variables/:variableId', Component: VariableRoute },
      { path: 'settings/harnesses', Component: Harnesses },
      { path: 'prompts/:promptId', Component: PromptRoute },
      { path: 'workflows/:workflowId', Component: WorkflowRoute },
      { path: 'runs', Component: RunsRoute },
      { path: 'runs/:runId', Component: RunRoute },
      { path: '*', Component: NotFound },
    ],
  },
];
