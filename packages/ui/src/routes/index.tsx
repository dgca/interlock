import { Center, Loader } from '../design-system';

import {
  runTab as parseRunTab,
  type RunTab,
} from '../features/runs/runAttention';
import {
  Link,
  Navigate,
  useNavigate,
  useLocation,
  useOutletContext,
  useParams,
  useSearchParams,
  type RouteObject,
} from 'react-router';
import { App, type AppContext } from '../App';
import { paths, runOffset, runTagFilter, runReturnLocation } from './paths';
import { runMode, type RunMode } from '../features/runs/runListConfig';
import { flushSync } from 'react-dom';
import { lazy, Suspense } from 'react';

import { WorkspaceReads, workspaceRead } from '../components/WorkspaceReads';
import { workflowCatalogEntry } from '@interlock/core';
import { errorMessage } from '../lib/api';
import { trpc, useQuery } from '../lib/query';
import { RouteSkeleton } from './RouteSkeleton';

import { RunListSkeleton } from '../features/runs/RunListSkeleton';
import { BoardLibrarySkeleton } from '../features/boards/BoardSkeleton';
import { PromptEditorSkeleton } from '../features/prompts/PromptSkeleton';
import {
  VariableEditorSkeleton,
  VariableLibrarySkeleton,
} from '../features/variables/VariableListSkeleton';
import { HarnessLibrarySkeleton } from '../features/executors/HarnessListSkeleton';
import { AutomationListSkeleton } from '../features/automations/AutomationListSkeleton';
import { ReportPageSkeleton } from '../features/report/ReportSkeleton';
import { DiagnosticsPageSkeleton } from '../features/diagnostics/DiagnosticsSkeleton';

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
const BoardLibrary = lazy(() =>
  import('../features/boards/Boards').then((m) => ({
    default: m.BoardLibrary,
  })),
);
const WorkflowBoard = lazy(() =>
  import('../features/boards/Boards').then((m) => ({
    default: m.WorkflowBoardRoute,
  })),
);
const BoardSettings = lazy(() =>
  import('../features/boards/BoardSettings').then((m) => ({
    default: m.BoardSettingsRoute,
  })),
);
const RequestRoute = lazy(() =>
  import('../features/boards/RequestView').then((m) => ({
    default: m.GlobalRequestRoute,
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

function LegacyHarnessesRoute() {
  const location = useLocation();
  return (
    <Navigate
      replace
      to={`${paths.harnesses}${location.search}${location.hash}`}
    />
  );
}

const IntegrationEditor = lazy(() =>
  import('../features/executors/IntegrationEditor').then((m) => ({
    default: m.IntegrationEditorRoute,
  })),
);

function IntegrationEditorRoute() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <IntegrationEditor />
    </Suspense>
  );
}

function HarnessesRoute() {
  const { onDirty } = useOutletContext<AppContext>();
  return (
    <Suspense fallback={<HarnessLibrarySkeleton />}>
      <Harnesses onDirty={onDirty} />
    </Suspense>
  );
}

function DiagnosticsRoute() {
  return (
    <Suspense fallback={<DiagnosticsPageSkeleton />}>
      <Diagnostics />
    </Suspense>
  );
}

function ReportRoute() {
  const { workflowId } = useParams<{ workflowId?: string }>();
  const navigate = useNavigate();
  return (
    <Suspense fallback={<ReportPageSkeleton />}>
      <WorkflowReportView
        key={workflowId ?? 'library'}
        workflowId={workflowId}
        onBack={
          workflowId
            ? () => void navigate(paths.workflow(workflowId))
            : undefined
        }
      />
    </Suspense>
  );
}

function PromptsRoute() {
  const query = useQuery(trpc.prompts.catalog.queryOptions());
  const promptsRead = workspaceRead('prompts', query);
  return (
    <WorkspaceReads
      reads={[promptsRead]}
      subject="prompts"
      title="Prompts"
      loading={<RouteSkeleton subject="prompts" />}
    >
      <Suspense fallback={<RouteSkeleton subject="prompts" />}>
        <PromptLibrary prompts={query.data ?? []} />
      </Suspense>
    </WorkspaceReads>
  );
}

function NewPromptRoute() {
  const { act } = useOutletContext<AppContext>();
  return (
    <Suspense fallback={<PromptEditorSkeleton creating />}>
      <PromptEditor act={act} />
    </Suspense>
  );
}

function PromptRoute() {
  const { promptId } = useParams<{ promptId: string }>();
  const { act } = useOutletContext<AppContext>();
  const read = useQuery(trpc.prompts.get.queryOptions({ id: promptId! }));
  const retry = () => void read.refetch({ cancelRefetch: false });
  const prompt = read.data;
  if (!prompt) {
    const error = read.error ? errorMessage(read.error) : '';
    if (error === `Saved prompt ${promptId} does not exist`)
      return <NotFound title="Prompt not found" />;
    return (
      <WorkspaceReads
        reads={[
          {
            resource: 'prompts',
            ready: false,
            error,
            fetching: read.isFetching,
            retry,
          },
        ]}
        subject="prompt"
        loading={<RouteSkeleton subject="prompt" />}
      >
        {null}
      </WorkspaceReads>
    );
  }
  return (
    <Suspense fallback={<RouteSkeleton subject="prompt" />}>
      <PromptEditor
        key={prompt.id}
        prompt={prompt}
        usage={read.dataUpdatedAt ? prompt.usage : undefined}
        readError={Boolean(read.error)}
        retryRead={retry}
        act={act}
      />
    </Suspense>
  );
}

function LibraryRoute() {
  const { act, onSaved } = useOutletContext<AppContext>();
  const catalog = useQuery(trpc.workflows.catalog.queryOptions());
  const workflowsRead = workspaceRead('workflows', catalog);
  const navigate = useNavigate();
  return (
    <WorkspaceReads
      reads={[workflowsRead]}
      subject="workflows"
      title="Workflows"
      loading={<RouteSkeleton subject="workflows" />}
    >
      <Suspense fallback={<RouteSkeleton subject="workflows" />}>
        <WorkflowLibrary
          workflows={catalog.data ?? []}
          onSaved={onSaved}
          act={act}
          onOpen={(id) => void navigate(paths.workflow(id))}
        />
      </Suspense>
    </WorkspaceReads>
  );
}

function VariablesRoute() {
  return (
    <Suspense fallback={<VariableLibrarySkeleton />}>
      <VariableLibrary />
    </Suspense>
  );
}

function VariableItemRoute() {
  const { variableId } = useParams();
  return (
    <Suspense
      fallback={<VariableEditorSkeleton creating={variableId === 'new'} />}
    >
      <VariableRoute />
    </Suspense>
  );
}

function useRunPage() {
  const [search, setSearch] = useSearchParams();
  const page = {
    tab: parseRunTab(search.get('tab')),
    mode: runMode(search.get('mode')),
    onModeChange: (mode: RunMode) =>
      setSearch((previous) => {
        const next = new URLSearchParams(previous);
        if (mode === 'overview') next.set('mode', mode);
        else next.delete('mode');
        return next;
      }),
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
        next.delete('mode');
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
  const read = useQuery(trpc.workflows.get.queryOptions({ id: workflowId! }));
  const workflow = read.data;
  const workflowRead = workspaceRead('workflow', read);
  const view = search.get('view');
  const redirectToSchedules = view === 'schedules';
  const section =
    view === 'runs'
      ? 'runs'
      : view === 'children' && !workflow?.ownerWorkflowId
        ? 'children'
        : 'editor';
  const catalog = useQuery(
    trpc.workflows.catalog.queryOptions(undefined, {
      enabled: Boolean(workflow) && !redirectToSchedules && section !== 'runs',
    }),
  );
  const ownerId = workflow?.ownerWorkflowId ?? undefined;
  const owner = useQuery(
    trpc.workflows.get.queryOptions(
      { id: ownerId ?? '' },
      {
        enabled: Boolean(ownerId) && !redirectToSchedules,
      },
    ),
  );
  if (!workflow && workflowRead.error === 'Workflow not found')
    return <NotFound title="Workflow not found" />;
  if (!workflow)
    return (
      <WorkspaceReads
        reads={[workflowRead]}
        subject="workflow"
        loading={<RouteSkeleton subject="workflow" />}
      >
        {null}
      </WorkspaceReads>
    );
  if (redirectToSchedules)
    return (
      <Navigate
        replace
        to={paths.workflowSchedule(
          workflow.id,
          search.get('schedule') ?? undefined,
        )}
      />
    );
  const editor = (
    <Suspense fallback={<RouteSkeleton subject="workflow" />}>
      <WorkflowEditor
        key={workflow.id}
        workflow={workflow}
        workflows={catalog.data ?? [workflowCatalogEntry(workflow)]}
        workflowsRead={workspaceRead('workflow choices', catalog)}
        owner={owner.data}
        ownerRead={
          ownerId ? workspaceRead('parent workflow', owner) : undefined
        }
        act={context.act}
        onDirty={context.onDirty}
        onSaved={context.onSaved}
        onPublicationChecked={context.onPublicationChecked}
        onRun={context.onRun}
        onBack={() =>
          void navigate(
            workflow.ownerWorkflowId
              ? paths.workflow(workflow.ownerWorkflowId)
              : paths.workflows,
          )
        }
        onOpenWorkflow={(id) => void navigate(paths.workflow(id))}
        onReport={() => void navigate(paths.workflowReport(workflow.id))}
        onDeleted={() => {
          flushSync(() => context.onDirty(false));
          void navigate(
            workflow.ownerWorkflowId
              ? paths.workflow(workflow.ownerWorkflowId)
              : paths.workflows,
          );
        }}
        section={section}
        onSectionChange={(section) => {
          setSearch((previous) => {
            const next = new URLSearchParams(previous);
            if (section !== 'editor') next.set('view', section);
            else next.delete('view');
            return next;
          });
        }}
        runsView={
          <Suspense fallback={<RunListSkeleton embedded />}>
            <RunList
              {...page}
              act={context.act}
              workflowId={workflow.id}
              workflowName={workflow.name}
            />
          </Suspense>
        }
      />
    </Suspense>
  );
  return (
    <WorkspaceReads
      reads={[workflowRead]}
      subject="workflow"
      loading={<RouteSkeleton subject="workflow" />}
    >
      {editor}
    </WorkspaceReads>
  );
}

function RunsRoute() {
  const { act } = useOutletContext<AppContext>();
  const { page } = useRunPage();
  return (
    <Suspense fallback={<RunListSkeleton />}>
      <RunList {...page} act={act} />
    </Suspense>
  );
}

function runReturnParams(search: URLSearchParams) {
  return {
    workflowId: search.get('workflow') || undefined,
    tab: search.has('tab') ? parseRunTab(search.get('tab')) : undefined,
    mode: search.has('mode') ? runMode(search.get('mode')) : undefined,
    offset: runOffset(search.get('offset')),
    tags: runTagFilter(search.get('tags')),
  };
}

function runsReturnPath(
  { workflowId, tab, mode, offset, tags }: ReturnType<typeof runReturnParams>,
  fallbackTab: RunTab = 'active',
) {
  const scopedTab = tab ?? 'active';
  if (workflowId)
    return paths.workflowRuns(workflowId, scopedTab, offset, tags, mode);
  const globalTab = tab ?? (mode ? 'active' : fallbackTab);
  return paths.runs(
    globalTab,
    globalTab === scopedTab ? offset : 0,
    tags,
    mode,
  );
}

function RunRoute() {
  const { runId } = useParams();
  const { act, onConnect } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const explicitReturn = runReturnLocation(search.get('returnTo'));
  const historyReturn = location.state?.returnLabel as string | undefined;
  const returnLabel = historyReturn ?? explicitReturn?.label;
  const returnParams = runReturnParams(search);
  const runPath = (
    id: string,
    executionId?: string,
    returnTo = explicitReturn?.path,
  ) =>
    paths.run(id, {
      ...(returnTo ? {} : returnParams),
      executionId,
      returnTo,
    });
  // Keep the source collection when coming back from a request. Each nested
  // return path is validated and shorter than the URL that contains it.
  const requestOrigin = (() => {
    if (explicitReturn?.label !== 'Back to request')
      return explicitReturn?.path;
    let original: ReturnType<typeof runReturnLocation> = explicitReturn;
    while (original) {
      if (
        original.label === 'Back to runs' ||
        original.label === 'Back to board'
      )
        return original.path;
      const url = new URL(original.path, 'https://interlock.invalid');
      if (url.pathname.startsWith('/boards/')) {
        url.searchParams.delete('request');
        return url.pathname + url.search + url.hash;
      }
      const nested = runReturnLocation(url.searchParams.get('returnTo'));
      if (!nested && original.label === 'Back to run') {
        const params = runReturnParams(url.searchParams);
        if (Object.values(params).some(Boolean)) return runsReturnPath(params);
      }
      original = nested;
    }
    return '';
  })();
  return (
    <Suspense fallback={<RouteLoading label="Loading run…" />}>
      <RunInspector
        key={runId}
        id={runId!}
        act={act}
        onConnect={onConnect}
        initialExecutionId={search.get('execution') ?? undefined}
        returnLabel={returnLabel}
        requestHref={(target, executionId) =>
          paths.request(target, runPath(runId!, executionId, requestOrigin))
        }
        onOpen={async (id, executionId, source) => {
          if (source)
            await navigate(runPath(runId!, source.executionId), {
              replace: true,
              state: location.state,
              preventScrollReset: true,
            });
          await navigate(
            runPath(
              id,
              executionId,
              source ? runPath(runId!, source.executionId) : undefined,
            ),
            {
              state: source
                ? { returnLabel: `Back to ${source.label}` }
                : undefined,
            },
          );
        }}
        onBack={(status) => {
          if (historyReturn) {
            void navigate(-1);
            return;
          }
          if (explicitReturn) {
            void navigate(explicitReturn.path);
            return;
          }
          const fallbackTab =
            status === 'queued' || status === 'running' || status === 'waiting'
              ? 'active'
              : 'history';
          void navigate(runsReturnPath(returnParams, fallbackTab));
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
      { path: 'prompts/-/new', Component: NewPromptRoute },
      { path: 'variables', Component: VariablesRoute },
      { path: 'variables/:variableId', Component: VariableItemRoute },
      { path: 'report', Component: ReportRoute },
      { path: 'settings/ai', Component: HarnessesRoute },
      {
        path: 'settings/ai/integrations/-/new',
        Component: IntegrationEditorRoute,
      },
      {
        path: 'settings/ai/integrations/:integrationId',
        Component: IntegrationEditorRoute,
      },
      { path: 'settings/harnesses', Component: LegacyHarnessesRoute },
      { path: 'settings/diagnostics', Component: DiagnosticsRoute },
      {
        path: 'diagnostics',
        Component: () => <Navigate to="/settings/diagnostics" replace />,
      },
      { path: 'prompts/:promptId', Component: PromptRoute },
      { path: 'workflows/:workflowId', Component: WorkflowRoute },
      { path: 'workflows/:workflowId/report', Component: ReportRoute },
      { path: 'runs', Component: RunsRoute },
      {
        path: 'runs/request',
        element: (
          <Suspense fallback={<RouteLoading />}>
            <RequestRoute />
          </Suspense>
        ),
      },
      { path: 'runs/:runId', Component: RunRoute },
      {
        path: 'boards',
        element: (
          <Suspense fallback={<BoardLibrarySkeleton />}>
            <BoardLibrary />
          </Suspense>
        ),
      },
      {
        path: 'boards/new',
        element: (
          <Suspense fallback={<RouteLoading />}>
            <BoardSettings />
          </Suspense>
        ),
      },
      {
        path: 'boards/:boardId',
        element: (
          <Suspense fallback={<RouteLoading />}>
            <WorkflowBoard />
          </Suspense>
        ),
      },
      {
        path: 'boards/:boardId/settings',
        element: (
          <Suspense fallback={<RouteLoading />}>
            <BoardSettings />
          </Suspense>
        ),
      },
      { path: '*', Component: NotFound },
    ],
  },
];
