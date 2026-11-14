import {
  ActionError,
  Button,
  LoadingSkeleton,
  NativeSelect,
  PageHeader,
  Placeholder,
  Stack,
  Text,
  workspacePage,
} from '../../design-system';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Pencil, Play } from 'lucide-react';
import type { TestSuite, Workflow } from '@interlock/core';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import { CaseResult, type SuiteResults } from './CaseResult';
import { useSuiteRun } from './useSuiteRun';
import styles from './Testing.module.css';

/** Routes no case exercised, when every result ran the same version. */
function suiteCoverage(results: SuiteResults) {
  const runs = results.cases.flatMap((c) =>
    c.simulation?.coverage
      ? [{ version: c.simulation.version, coverage: c.simulation.coverage }]
      : [],
  );
  if (!runs.length || runs.some((r) => r.version !== runs[0].version)) return;
  const untested = new Map(
    runs[0].coverage.untested.map((edge) => [edge.edgeId, edge]),
  );
  for (const { coverage } of runs.slice(1)) {
    const ids = new Set(coverage.untested.map((edge) => edge.edgeId));
    for (const id of untested.keys()) if (!ids.has(id)) untested.delete(id);
  }
  const total = runs[0].coverage.totalEdges;
  return {
    version: runs[0].version,
    total,
    covered: total - untested.size,
    untested: [...untested.values()],
  };
}

const states = ['passed', 'failed', 'unsupported', 'cancelled', 'interrupted'];

export function SuiteView({
  workflow,
  suite,
}: {
  workflow: Workflow;
  suite: TestSuite;
}) {
  const navigate = useNavigate();
  // Simulations emit no engine events. Read on open, after each case this
  // page runs, and every second while a result shown is still running.
  const resultsQuery = useQuery({
    ...trpc.testbench.suiteSimulations.queryOptions({ id: suite.id }),
    meta: { engineRefresh: false },
    refetchInterval: (query) =>
      query.state.data?.cases.some((c) => c.simulation?.state === 'running')
        ? 1000
        : false,
  });
  const versionsQuery = useQuery(
    trpc.workflows.versions.queryOptions({ id: workflow.id }),
  );
  const versions = (versionsQuery.data ?? [])
    .map((v) => v.version)
    .sort((a, b) => b - a);
  const [chosen, setChosen] = useState<number>();
  const version = chosen ?? versions[0];
  const { progress, run, running } = useSuiteRun(
    () => void resultsQuery.refetch(),
  );
  const results = resultsQuery.data;
  const byCase = new Map(results?.cases.map((c) => [c.caseId, c.simulation]));
  const counts = states
    .map((state) => ({
      state,
      count: suite.cases.filter((c) => byCase.get(c.id)?.state === state)
        .length,
    }))
    .filter((c) => c.count);
  const notRun = suite.cases.filter((c) => !byCase.get(c.id)).length;
  const coverage = results && suiteCoverage(results);
  const earlier = results?.cases.some(
    (c) => c.simulation && c.simulation.suiteRevision !== suite.revision,
  );
  const unpublished = versionsQuery.data && !versions.length;
  const runningCase =
    running && progress?.caseId
      ? suite.cases.find((c) => c.id === progress.caseId)
      : undefined;
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title={suite.name}
        subtitle={`${workflow.name} · Revision ${suite.revision} · ${suite.cases.length} ${suite.cases.length === 1 ? 'case' : 'cases'}`}
        onBack={() => void navigate(paths.workflowTests(workflow.id))}
        backLabel="Back to tests"
        controls={
          versions.length > 0 && (
            <NativeSelect
              aria-label="Published version"
              disabled={running}
              value={version}
              data={versions.map((v) => ({
                value: String(v),
                label: `Version ${v}`,
              }))}
              onChange={(e) => setChosen(Number(e.currentTarget.value))}
            />
          )
        }
        actions={
          <>
            <Button
              component={Link}
              to={paths.testSuiteEdit(workflow.id, suite.id)}
              disabled={running}
              leftSection={<Pencil size={16} aria-hidden="true" />}
            >
              Edit suite
            </Button>
            <Button
              variant="primary"
              disabled={running || !version}
              leftSection={<Play size={16} aria-hidden="true" />}
              onClick={() => version && void run(suite, version)}
            >
              Run all cases
            </Button>
          </>
        }
      />
      <div className={workspacePage.content}>
        <div className={styles.suiteContent}>
          <WorkspaceReadWarning
            inline
            reads={[
              workspaceRead('simulation results', resultsQuery),
              workspaceRead('published versions', versionsQuery),
            ]}
          />
          {suite.description && (
            <p className={styles.description}>{suite.description}</p>
          )}
          {unpublished && (
            <Text size="sm" className={styles.hint}>
              Publish this workflow to run its cases. Simulations run a
              published version with each case&apos;s fixtures, without agents,
              scripts or network requests.
            </Text>
          )}
          <div role="status" className={styles.runStatus}>
            {runningCase
              ? `Running case ${progress!.done + 1} of ${progress!.total}: ${runningCase.name}`
              : progress && !progress.error
                ? `Ran ${progress.total} ${progress.total === 1 ? 'case' : 'cases'} on version ${version}.`
                : ''}
          </div>
          <ActionError message={progress?.error ?? ''} />
          {results ? (
            <>
              <dl className={styles.summary}>
                {counts.map(({ state, count }) => (
                  <div key={state}>
                    <dt>{state[0].toUpperCase() + state.slice(1)}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
                {notRun > 0 && (
                  <div>
                    <dt>Not run</dt>
                    <dd>{notRun}</dd>
                  </div>
                )}
                {coverage && (
                  <div>
                    <dt>Suite route coverage, version {coverage.version}</dt>
                    <dd>
                      {coverage.covered} of {coverage.total} routes
                    </dd>
                  </div>
                )}
              </dl>
              {earlier && (
                <p className={styles.hint}>
                  Some results are from earlier suite revisions; run the cases
                  again to check revision {suite.revision}.
                </p>
              )}
              {coverage && coverage.untested.length > 0 && (
                <details className={styles.untested}>
                  <summary>
                    Routes no case takes ({coverage.untested.length})
                  </summary>
                  <ul>
                    {coverage.untested.map((edge) => (
                      <li key={edge.edgeId}>
                        <code>
                          {edge.source}
                          {edge.port ? `.${edge.port}` : ''} → {edge.target}
                        </code>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <ul className={styles.results} aria-label="Cases">
                {suite.cases.map((c) => (
                  <CaseResult
                    key={c.id}
                    name={c.name}
                    caseId={c.id}
                    simulation={byCase.get(c.id) ?? null}
                    suiteRevision={suite.revision}
                    running={runningCase?.id === c.id}
                  />
                ))}
              </ul>
            </>
          ) : (
            !resultsQuery.error && <SuiteResultsSkeleton />
          )}
        </div>
      </div>
    </section>
  );
}

function SuiteResultsSkeleton() {
  return (
    <LoadingSkeleton label="Loading simulation results…">
      <Stack gap="md">
        <Placeholder h={20} w="40%" />
        {[1, 2, 3].map((row) => (
          <Placeholder key={row} h={112} radius="md" />
        ))}
      </Stack>
    </LoadingSkeleton>
  );
}
