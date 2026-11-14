import {
  Anchor,
  Button,
  EmptyState,
  PageToolbar,
  workspacePage,
} from '../../design-system';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import type { Workflow } from '@interlock/core';
import {
  ListTable,
  ListTableRow,
  ListTableSkeleton,
} from '../../components/ListTable/ListTable';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import { SuiteRowPlaceholder, suiteTable } from './TestsViewSkeleton';
import styles from './Testing.module.css';

/** The workflow's Tests section: saved suites and recent comparisons. */
export function TestsView({ workflow }: { workflow: Workflow }) {
  const query = useQuery(
    trpc.testbench.suites.queryOptions({ workflowId: workflow.id, limit: 100 }),
  );
  const suites = query.data;
  const create = (
    <Button
      component={Link}
      to={paths.testSuiteNew(workflow.id)}
      variant="primary"
      leftSection={<Plus size={14} aria-hidden="true" />}
    >
      New test suite
    </Button>
  );
  return (
    <div className={workspacePage.page}>
      <PageToolbar
        summary={
          suites &&
          (suites.total > suites.items.length
            ? `Showing ${suites.items.length} of ${suites.total} suites`
            : `${suites.total} ${suites.total === 1 ? 'suite' : 'suites'}`)
        }
      >
        {create}
      </PageToolbar>
      <div className={workspacePage.content}>
        <div className={styles.suiteContent}>
          <WorkspaceReadWarning
            inline
            reads={[workspaceRead('test suites', query)]}
          />
          <h2 className={styles.sectionTitle}>Suites</h2>
          {!suites ? (
            !query.error && (
              <ListTableSkeleton {...suiteTable} label="Loading test suites…">
                <SuiteRowPlaceholder />
              </ListTableSkeleton>
            )
          ) : suites.items.length ? (
            <ListTable {...suiteTable} label="Test suites">
              {suites.items.map((suite) => (
                <ListTableRow key={suite.id}>
                  <span className={styles.identity}>
                    <strong>
                      <Anchor
                        component={Link}
                        to={paths.testSuite(workflow.id, suite.id)}
                        underline="hover"
                      >
                        {suite.name}
                      </Anchor>
                    </strong>
                    {suite.description && <small>{suite.description}</small>}
                  </span>
                  <span>{suite.caseCount}</span>
                  <span>{suite.revision}</span>
                  <time dateTime={suite.updatedAt}>
                    {new Date(suite.updatedAt).toLocaleDateString()}
                  </time>
                </ListTableRow>
              ))}
            </ListTable>
          ) : (
            <EmptyState
              title="No test suites yet"
              description="A suite saves workflow inputs, expected outputs and routes, and fixture outcomes. Run its cases as simulations without agents, scripts or network requests."
            />
          )}
          <Comparisons workflowId={workflow.id} />
        </div>
      </div>
    </div>
  );
}

const comparisonTable = {
  columns: [
    { label: 'Comparison', width: '36%' },
    { label: 'Versions', width: '16%' },
    { label: 'Status', width: '16%' },
    { label: 'Samples', width: '14%' },
    { label: 'Started', width: '18%' },
  ],
  minWidth: 620,
} as const;

/** Recent paired live comparisons; each opens its read-only report. */
function Comparisons({ workflowId }: { workflowId: string }) {
  const query = useQuery(
    trpc.testbench.comparisons.queryOptions({ workflowId, limit: 20 }),
  );
  const list = query.data;
  return (
    <section aria-labelledby="test-comparisons">
      <h2 id="test-comparisons" className={styles.sectionTitle}>
        Comparisons
        {list && list.total > list.items.length && (
          <span className={styles.count}>
            Latest {list.items.length} of {list.total}
          </span>
        )}
      </h2>
      <WorkspaceReadWarning
        inline
        reads={[workspaceRead('comparisons', query)]}
      />
      {!list ? (
        !query.error && (
          <ListTableSkeleton {...comparisonTable} label="Loading comparisons…">
            <SuiteRowPlaceholder />
            <span />
          </ListTableSkeleton>
        )
      ) : list.items.length ? (
        <ListTable {...comparisonTable} label="Comparisons">
          {list.items.map((c) => (
            <ListTableRow key={c.id}>
              <span className={styles.identity}>
                <strong>
                  <Anchor
                    component={Link}
                    to={paths.comparison(workflowId, c.id)}
                    underline="hover"
                  >
                    {c.suiteName}
                  </Anchor>
                </strong>
                <small className={styles.mono}>{c.id.slice(0, 8)}</small>
              </span>
              <span>
                v{c.baselineVersion} and v{c.candidateVersion}
              </span>
              <span>
                <StatusBadge status={c.status} />
              </span>
              <span>
                {c.observed} of {c.total}
              </span>
              <time dateTime={c.createdAt}>
                {new Date(c.createdAt).toLocaleDateString()}
              </time>
            </ListTableRow>
          ))}
        </ListTable>
      ) : (
        <p className={styles.hint}>
          No comparisons yet. A comparison runs two published versions on a
          suite&apos;s cases with real agents and actions. Agents preview and
          start one with preview_workflow_comparison and
          start_workflow_comparison.
        </p>
      )}
    </section>
  );
}
