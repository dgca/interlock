import { lazy, Suspense, type ReactNode } from 'react';
import { Link, useParams, type RouteObject } from 'react-router';
import { WorkspaceReads, workspaceRead } from '../../components/WorkspaceReads';
import { errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import { SuitePageSkeleton } from './TestsViewSkeleton';

const SuiteView = lazy(() =>
  import('./SuiteView').then((m) => ({ default: m.SuiteView })),
);
const SuiteEditor = lazy(() =>
  import('./SuiteEditor').then((m) => ({ default: m.SuiteEditor })),
);

function Missing({ title, workflowId }: { title: string; workflowId: string }) {
  return (
    <div className="content-page">
      <h1>{title}</h1>
      <Link to={paths.workflowTests(workflowId)}>Back to tests</Link>
    </div>
  );
}

/** Loads the workflow, and the suite when the URL names one, before rendering. */
function SuitePage({
  render,
}: {
  render: (
    workflow: NonNullable<ReturnType<typeof useWorkflow>['data']>,
    suite?: NonNullable<ReturnType<typeof useSuite>['data']>,
  ) => ReactNode;
}) {
  const { workflowId, suiteId } = useParams();
  const workflowQuery = useWorkflow(workflowId!);
  const suiteQuery = useSuite(suiteId);
  const workflow = workflowQuery.data;
  const suite = suiteQuery.data;
  const reads = [
    workspaceRead('workflow', workflowQuery),
    ...(suiteId ? [workspaceRead('test suite', suiteQuery)] : []),
  ];
  if (
    (suiteQuery.error &&
      errorMessage(suiteQuery.error) === 'Test suite not found') ||
    (suite && suite.workflowId !== workflowId)
  )
    return <Missing title="Test suite not found" workflowId={workflowId!} />;
  if (!workflow || (suiteId && !suite))
    return (
      <WorkspaceReads
        reads={reads}
        subject={suiteId ? 'test suite' : 'workflow'}
        loading={<SuitePageSkeleton />}
      >
        {null}
      </WorkspaceReads>
    );
  return (
    <Suspense fallback={<SuitePageSkeleton />}>
      {render(workflow, suite)}
    </Suspense>
  );
}

function useWorkflow(id: string) {
  return useQuery(trpc.workflows.get.queryOptions({ id }));
}

function useSuite(id?: string) {
  return useQuery(
    trpc.testbench.suite.queryOptions(
      { id: id ?? '' },
      { enabled: Boolean(id) },
    ),
  );
}

export const testRoutes: RouteObject[] = [
  {
    path: 'workflows/:workflowId/tests/new',
    element: (
      <SuitePage render={(workflow) => <SuiteEditor workflow={workflow} />} />
    ),
  },
  {
    path: 'workflows/:workflowId/tests/:suiteId',
    element: (
      <SuitePage
        render={(workflow, suite) => (
          <SuiteView key={suite!.id} workflow={workflow} suite={suite!} />
        )}
      />
    ),
  },
  {
    path: 'workflows/:workflowId/tests/:suiteId/edit',
    element: (
      <SuitePage
        render={(workflow, suite) => (
          <SuiteEditor key={suite!.id} workflow={workflow} suite={suite} />
        )}
      />
    ),
  },
];
