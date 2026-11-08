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
import { paths, runOffset, runTagFilter } from './paths';
import { flushSync } from 'react-dom';
import { lazy, Suspense, useState } from 'react';
import { Button, Center, Loader } from '@mantine/core';
import { RouteSkeleton, type LoadingSubject } from './RouteSkeleton';
import { AutomationListSkeleton } from '../features/automations/AutomationListSkeleton';

const Automations = lazy(() =>
  import('../features/automations/Automations').then((m) => ({
    default: m.Automations,
  })),
);
const WorkflowLibrary = lazy(() =>
  import('../features/workflows/WorkflowLibrary').then((m) => ({
    default: m.WorkflowLibrary,
  })),
);
const WorkflowEditor = lazy(() =>
  import('../features/workflows/WorkflowEditor').then((m) => ({
    default: m.WorkflowEditor,
  })),
);
const RunList = lazy(() =>
  import('../features/runs/RunList').then((m) => ({
    default: m.RunList,
  })),
);
const RunInspector = lazy(() =>
  import('../features/runs/RunInspector').then((m) => ({
    default: m.RunInspector,
  })),
);
const Harnesses = lazy(() =>
  import('../features/executors/Harnesses').then((m) => ({
    default: m.Harnesses,
  })),
);
const Diagnostics = lazy(() =>
  import('../features/diagnostics/Diagnostics').then((m) => ({
    default: m.Diagnostics,
  })),
);
const WorkflowReportView = lazy(() =>
  import('../features/report/WorkflowReportView').then((m) => ({
    default: m.WorkflowReportView,
  })),
);
const PromptLibrary = lazy(() =>
  import('../features/prompts/Prompts').then((m) => ({
    default: m.PromptLibrary,
  })),
);
const PromptEditor = lazy(() =>
  import('../features/prompts/Prompts').then((m) => ({
    default: m.PromptEditor,
  })),
);
const VariableLibrary = lazy(() =>
  import('../features/variables/Variables').then((m) => ({
    default: m.VariableLibrary,
  })),
);
const VariableRoute = lazy(() =>
  import('../features/variables/Variables').then((m) => ({
    default: m.VariableRoute,
  })),
);

function RouteLoading({ label = 'Loading…' }: { label?: string }) {
  return (
    <Center
      h="100%"
      style={{ minHeight: 200 }}
      role="status"
      aria-label={label}
    >
      <Loader size="md" />
    </Center>
  );
}

function HarnessesRoute() {
  const { onDirty } = useOutletContext<AppContext>();
  return (
    <Suspense fallback={<RouteLoading label="Loading harnesses…" />}>
      <Harnesses onDirty={onDirty} />
    </Suspense>
  );
}

function DiagnosticsRoute() {
  return (
    <Suspense fallback={<RouteLoading label="Loading diagnostics…" />}>
      <Diagnostics />
    </Suspense>
  );
}

function ReportRoute() {
  const { workflowId } = useParams<{ workflowId?: string }>();
  return (
    <Suspense
      fallback={<RouteLoading label="Loading performance and cost report…" />}
    >
      <WorkflowReportView
        key={workflowId ?? 'library'}
        workflowId={workflowId}
      />
    </Suspense>
  );
}

function PromptsRoute() {
  const context = useOutletContext<AppContext>();
  if (!context.loaded) return <Loading subject="prompts" />;
  return (
    <Suspense fallback={<RouteSkeleton subject="prompts" />}>
      <PromptLibrary prompts={context.prompts} act={context.act} />
    </Suspense>
  );
}

function PromptRoute() {
  const { promptId } = useParams();
  const context = useOutletContext<AppContext>();
  const prompt = context.prompts.find((p) => p.id === promptId);
  if (!context.loaded) return <Loading subject="prompt" />;
  if (!prompt) return <NotFound title="Prompt not found" />;
  return (
    <Suspense fallback={<RouteSkeleton subject="prompt" />}>
      <PromptEditor
        key={prompt.id}
        prompt={prompt}
        act={context.act}
        onDirty={context.onDirty}
        tick={context.tick}
      />
    </Suspense>
  );
}

function LibraryRoute() {
  const { workflows, act, loaded } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  if (!loaded) return <Loading subject="workflows" />;
  return (
    <Suspense fallback={<RouteSkeleton subject="workflows" />}>
      <WorkflowLibrary
        workflows={workflows}
        act={act}
        onOpen={(id) => void navigate(paths.workflow(id))}
      />
    </Suspense>
  );
}

function VariablesRoute() {
  return (
    <Suspense fallback={<RouteLoading label="Loading variables…" />}>
      <VariableLibrary />
    </Suspense>
  );
}

function VariableItemRoute() {
  return (
    <Suspense fallback={<RouteLoading label="Loading variable…" />}>
      <VariableRoute />
    </Suspense>
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
    tags: runTagFilter(search.get('tags')),
    onTagsChange: (tags?: Record<string, string>) =>
      setSearch((previous) => {
        const next = new URLSearchParams(previous);
        if (tags && Object.keys(tags).length)
          next.set('tags', JSON.stringify(tags));
        else next.delete('tags');
        next.delete('offset');
        return next;
      }),
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
  if (search.get('view') === 'schedules')
    return (
      <Navigate
        replace
        to={paths.workflowSchedule(
          workflow.id,
          search.get('schedule') ?? undefined,
        )}
      />
    );
  return (
    <Suspense fallback={<RouteSkeleton subject="workflow" />}>
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
        onSectionChange={(section) => {
          if (section === 'schedules') {
            void navigate(paths.workflowSchedule(workflow.id));
            return;
          }
          setSearch((previous) => {
            const next = new URLSearchParams(previous);
            if (section !== 'editor') next.set('view', section);
            else next.delete('view');
            return next;
          });
        }}
        runsView={
          <Suspense fallback={<RouteLoading label="Loading runs…" />}>
            <RunList
              {...page}
              tick={context.tick}
              act={context.act}
              workflows={context.workflows}
              workflowId={workflow.id}
              onOpen={(id, executionId) =>
                void navigate(
                  paths.run(
                    id,
                    workflow.id,
                    page.tab,
                    executionId,
                    page.offset,
                    page.tags,
                  ),
                )
              }
            />
          </Suspense>
        }
      />
    </Suspense>
  );
}

function RunsRoute() {
  const { tick, act, workflows } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const { page } = useRunPage();
  return (
    <Suspense fallback={<RouteLoading label="Loading runs…" />}>
      <RunList
        {...page}
        tick={tick}
        act={act}
        workflows={workflows}
        onOpen={(id, executionId) =>
          void navigate(
            paths.run(
              id,
              undefined,
              page.tab,
              executionId,
              page.offset,
              page.tags,
            ),
          )
        }
      />
    </Suspense>
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
  const tags = runTagFilter(search.get('tags'));
  return (
    <Suspense fallback={<RouteLoading label="Loading run…" />}>
      <RunInspector
        key={runId}
        id={runId!}
        tick={tick}
        act={act}
        onConnect={onConnect}
        initialExecutionId={search.get('execution') ?? undefined}
        onOpen={(id, executionId) =>
          void navigate(
            paths.run(id, workflowId, returnTab, executionId, offset, tags),
          )
        }
        onBack={(status) => {
          const tab =
            returnTab === 'attention'
              ? 'attention'
              : status === 'queued' ||
                  status === 'running' ||
                  status === 'waiting'
                ? 'active'
                : 'history';
          void navigate(
            workflowId
              ? paths.workflowRuns(workflowId, returnTab, offset, tags)
              : paths.runs(tab, tab === returnTab ? offset : 0, tags),
          );
        }}
      />
    </Suspense>
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
      {
        path: 'automations',
        element: (
          <Suspense fallback={<AutomationListSkeleton />}>
            <Automations />
          </Suspense>
        ),
      },
      {
        path: 'automations/new',
        element: (
          <Suspense fallback={<RouteLoading label="Loading automation…" />}>
            <Automations />
          </Suspense>
        ),
      },
      {
        path: 'automations/:automationId',
        element: (
          <Suspense fallback={<RouteLoading label="Loading automation…" />}>
            <Automations />
          </Suspense>
        ),
      },
      {
        path: 'automations/:automationId/edit',
        element: (
          <Suspense fallback={<RouteLoading label="Loading automation…" />}>
            <Automations />
          </Suspense>
        ),
      },
      { path: 'prompts', Component: PromptsRoute },
      { path: 'variables', Component: VariablesRoute },
      { path: 'variables/:variableId', Component: VariableItemRoute },
      { path: 'report', Component: ReportRoute },
      { path: 'settings/harnesses', Component: HarnessesRoute },
      { path: 'settings/diagnostics', Component: DiagnosticsRoute },
      {
        path: 'diagnostics',
        Component: () => <Navigate to="/settings/diagnostics" replace />,
      },
      { path: 'prompts/:promptId', Component: PromptRoute },
      { path: 'workflows/:workflowId', Component: WorkflowRoute },
      { path: 'workflows/:workflowId/report', Component: ReportRoute },
      { path: 'runs', Component: RunsRoute },
      { path: 'runs/:runId', Component: RunRoute },
      { path: '*', Component: NotFound },
    ],
  },
];
