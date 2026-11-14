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
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import { SuiteRowPlaceholder, suiteTable } from './TestsViewSkeleton';
import styles from './Testing.module.css';

/** The workflow's Tests section: saved suites, each opening its results. */
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
        </div>
      </div>
    </div>
  );
}
