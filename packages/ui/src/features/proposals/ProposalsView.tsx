import {
  Anchor,
  Button,
  EmptyState,
  PageToolbar,
  SegmentedControl,
  workspacePage,
} from '../../design-system';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus, Settings2 } from 'lucide-react';
import type { Workflow } from '@interlock/core';
import {
  ListTable,
  ListTableRow,
  ListTableSkeleton,
} from '../../components/ListTable/ListTable';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import type { api } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import type { Action } from '../../lib/useActionFeedback';
import { paths } from '../../routes/paths';
import { ProposalSettingsDialog } from './ProposalSettingsDialog';
import { ProposalCreateDialog } from './ProposalCreateDialog';
import { ProposalView } from './ProposalView';
import { ProposalRowPlaceholder, proposalTable } from './ProposalsSkeleton';
import styles from './Proposals.module.css';

type Item = Awaited<
  ReturnType<typeof api.proposals.list.query>
>['items'][number];

function simulationSummary(simulation: Item['simulation']) {
  if (!simulation) return 'Not simulated';
  if (simulation.state === 'running') return 'Simulating…';
  if (simulation.state === 'unavailable') return 'Not available';
  return simulation.failing
    ? `${simulation.failing} of ${simulation.total} cases fail`
    : `${simulation.total} cases pass`;
}

const filters = [
  { value: 'open', label: 'Open' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
] as const;
type Filter = (typeof filters)[number]['value'];

/** The workflow's Proposals section: the review queue, or one proposal. */
export function ProposalsView({
  workflow,
  act,
}: {
  workflow: Workflow;
  act: Action;
}) {
  const [search] = useSearchParams();
  const proposalId = search.get('proposal');
  const [status, setStatus] = useState<Filter>('open');
  const [configuring, setConfiguring] = useState(false);
  const [creating, setCreating] = useState(false);
  const settings = useQuery(
    trpc.proposals.settings.queryOptions({ workflowId: workflow.id }),
  );
  const query = useQuery(
    trpc.proposals.list.queryOptions(
      { workflowId: workflow.id, status, limit: 100 },
      { enabled: !proposalId },
    ),
  );
  const list = query.data;
  const agents = settings.data?.agents;
  return (
    <div className={workspacePage.page}>
      <PageToolbar
        summary={
          agents === undefined
            ? undefined
            : agents
              ? 'Agents may propose changes'
              : 'Agent proposals are off'
        }
      >
        {!proposalId && (
          <SegmentedControl
            aria-label="Proposal status"
            value={status}
            onChange={setStatus}
            data={[...filters]}
          />
        )}
        <Button
          leftSection={<Settings2 size={14} aria-hidden="true" />}
          disabled={!settings.data}
          onClick={() => setConfiguring(true)}
        >
          Proposal settings
        </Button>
        <Button
          variant="primary"
          leftSection={<Plus size={14} aria-hidden="true" />}
          onClick={() => setCreating(true)}
        >
          New proposal
        </Button>
      </PageToolbar>
      <div className={workspacePage.content}>
        {proposalId ? (
          <ProposalView
            key={proposalId}
            workflow={workflow}
            proposalId={proposalId}
            act={act}
          />
        ) : (
          <div className={styles.content}>
            <WorkspaceReadWarning
              inline
              reads={[
                workspaceRead('proposals', query),
                workspaceRead('proposal settings', settings),
              ]}
            />
            {!list ? (
              !query.error && (
                <ListTableSkeleton
                  {...proposalTable}
                  label="Loading proposals…"
                >
                  <ProposalRowPlaceholder />
                </ListTableSkeleton>
              )
            ) : list.items.length ? (
              <ListTable {...proposalTable} label="Proposals">
                {list.items.map((item) => (
                  <ListTableRow key={item.id}>
                    <span className={styles.identity}>
                      <strong>
                        <Anchor
                          component={Link}
                          to={paths.workflowProposals(workflow.id, item.id)}
                          underline="hover"
                        >
                          {item.title}
                        </Anchor>
                      </strong>
                      <small>{item.rationale}</small>
                    </span>
                    <span className={styles.secondary}>
                      {item.author.kind === 'agent' ? 'Agent' : 'Person'}
                    </span>
                    <span className={styles.identity}>
                      <span>
                        <StatusBadge status={item.status} />
                      </span>
                      {item.stale && <small>Draft changed</small>}
                    </span>
                    <span className={styles.secondary}>
                      {simulationSummary(item.simulation)}
                    </span>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleDateString()}
                    </time>
                  </ListTableRow>
                ))}
              </ListTable>
            ) : (
              <EmptyState
                title={
                  status === 'open'
                    ? 'No open proposals'
                    : `No ${status} proposals`
                }
                description={
                  status !== 'open'
                    ? undefined
                    : agents
                      ? 'Agents propose changes with propose_workflow_change. Each proposal waits here for review; approving it edits the draft and never publishes.'
                      : 'Turn on agent proposals in Proposal settings to let agents suggest changes to this workflow for your review.'
                }
              />
            )}
          </div>
        )}
      </div>
      {creating && (
        <ProposalCreateDialog
          workflowId={workflow.id}
          act={act}
          onClose={() => setCreating(false)}
        />
      )}
      {configuring && settings.data && (
        <ProposalSettingsDialog
          workflowId={workflow.id}
          settings={{
            agents: settings.data.agents,
            ...(settings.data.nodeKinds
              ? { nodeKinds: settings.data.nodeKinds }
              : {}),
            ...(settings.data.fields ? { fields: settings.data.fields } : {}),
            ...(settings.data.otherWorkflows ? { otherWorkflows: true } : {}),
            ...(settings.data.workflowSettings
              ? { workflowSettings: true }
              : {}),
          }}
          act={act}
          onClose={() => setConfiguring(false)}
        />
      )}
    </div>
  );
}
