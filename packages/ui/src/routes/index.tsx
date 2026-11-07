import {
  runTab as parseRunTab,
  type RunTab,
} from '../features/runs/runAttention';
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
import { paths, runOffset } from './paths';
import { flushSync } from 'react-dom';
import { useState } from 'react';
import { Button } from '@mantine/core';
import { RouteSkeleton, type LoadingSubject } from './RouteSkeleton';
import { PromptLibrary, PromptEditor } from '../features/prompts/Prompts';
import {
  VariableLibrary,
  VariableRoute,
} from '../features/variables/Variables';

function HarnessesRoute() {
  const { onDirty } = useOutletContext<AppContext>();
  return <Harnesses onDirty={onDirty} />;
}

function PromptsRoute() {
  const context = useOutletContext<AppContext>();
  if (!context.loaded) return <Loading subject="prompts" />;
  return <PromptLibrary prompts={context.prompts} act={context.act} />;
}
function PromptRoute() {
  const { promptId } = useParams();
  const context = useOutletContext<AppContext>();
  const prompt = context.prompts.find((p) => p.id === promptId);
  if (!context.loaded) return <Loading subject="prompt" />;
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
  const { workflows, act, loaded } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  if (!loaded) return <Loading subject="workflows" />;
  return (
    <WorkflowLibrary
      workflows={workflows}
      act={act}
      onOpen={(id) => void navigate(paths.workflow(id))}
    />
  );
}

function Loading({ subject }: { subject: LoadingSubject }) {
  const { loadError, retryLoad } = useOutletContext<AppContext>();
  const [retrying, setRetrying] = useState(false);
  if (!loadError) return <RouteSkeleton subject={subject} />;
  return (
    <div className="content-page">
      <p role="alert">
        Could not load {subject}. {loadError}
      </p>
      <Button
        variant="default"
        disabled={retrying}
        onClick={async () => {
          setRetrying(true);
          await retryLoad();
          setRetrying(false);
        }}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}

function useRunPage() {
  const [search, setSearch] = useSearchParams();
  const page = {
    tab: parseRunTab(search.get('tab')),
    offset: runOffset(search.get('offset')),
    onTabChange: (tab: RunTab) =>
      setSearch((previous) => {
        const next = new URLSearchParams(previous);
        if (tab !== 'active') next.set('tab', tab);
        else next.delete('tab');
        next.delete('offset');
        return next;
      }),
    onOffsetChange: (offset: number) =>
      setSearch((previous) => {
        const next = new URLSearchParams(previous);
        if (offset > 0) next.set('offset', String(offset));
        else next.delete('offset');
        return next;
      }),
  };
  return { search, setSearch, page };
}

function WorkflowRoute() {
  const { workflowId } = useParams();
  const context = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const { search, setSearch, page } = useRunPage();
  const workflow = context.workflows.find((w) => w.id === workflowId);
  if (!context.loaded) return <Loading subject="workflow" />;
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
          {...page}
          tick={context.tick}
          act={context.act}
          workflows={context.workflows}
          workflowId={workflow.id}
          onOpen={(id, executionId) =>
            void navigate(
              paths.run(id, workflow.id, page.tab, executionId, page.offset),
            )
          }
        />
      }
    />
  );
}

function RunsRoute() {
  const { tick, act, workflows } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const { page } = useRunPage();
  return (
    <RunList
      {...page}
      tick={tick}
      act={act}
      workflows={workflows}
      onOpen={(id, executionId) =>
        void navigate(
          paths.run(id, undefined, page.tab, executionId, page.offset),
        )
      }
    />
  );
}

function RunRoute() {
  const { runId } = useParams();
  const { tick, act, onConnect } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const workflowId = search.get('workflow') || undefined;
  const returnTab = parseRunTab(search.get('tab'));
  const offset = runOffset(search.get('offset'));
  return (
    <RunInspector
      key={runId}
      id={runId!}
      tick={tick}
      act={act}
      onConnect={onConnect}
      initialExecutionId={search.get('execution') ?? undefined}
      onOpen={(id, executionId) =>
        void navigate(paths.run(id, workflowId, returnTab, executionId, offset))
      }
      onBack={(status) => {
        const tab =
          returnTab === 'attention'
            ? 'attention'
            : status === 'running' || status === 'waiting'
              ? 'active'
              : 'history';
        void navigate(
          workflowId
            ? paths.workflowRuns(workflowId, returnTab, offset)
            : paths.runs(tab, tab === returnTab ? offset : 0),
        );
      }}
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
      { path: 'settings/harnesses', Component: HarnessesRoute },
      { path: 'prompts/:promptId', Component: PromptRoute },
      { path: 'workflows/:workflowId', Component: WorkflowRoute },
      { path: 'runs', Component: RunsRoute },
      { path: 'runs/:runId', Component: RunRoute },
      { path: '*', Component: NotFound },
    ],
  },
];
