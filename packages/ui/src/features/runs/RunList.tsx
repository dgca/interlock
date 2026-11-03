import { attentionText, type RunTab } from './runAttention';
import { Button, Group, Tabs } from '@mantine/core';
import { useState } from 'react';
import { HistoryCleanupDialog } from './HistoryCleanupDialog';
import type { Action } from '../../lib/useActionFeedback';
import type { Run, RunAttention } from '@interlock/core';
import { ArrowUpRight, Activity } from 'lucide-react';
import layout from '../../components/PageLayout/PageLayout.module.css';
import { Badge } from '../../components/Badge/Badge';
import { ComparisonContext } from './ComparisonContext';
export function RunList({
  runs,
  attention = [],
  onOpen,
  tab,
  onTabChange,
  workflowId,
  act,
  workflows,
}: {
  runs: Run[];
  attention?: RunAttention[];
  tab: RunTab;
  onTabChange: (tab: RunTab) => void;
  onOpen: (id: string, executionId?: string) => void;
  workflowId?: string;
  act?: Action;
  workflows?: { id: string; name: string }[];
}) {
  const [cleanup, setCleanup] = useState(false);
  const roots = runs.filter((r) =>
    workflowId
      ? r.workflowId === workflowId && !r.batchNodeId
      : !r.parentRunId || r.parentMode === 'detached',
  );
  const active = roots.filter((run) =>
    ['running', 'waiting'].includes(run.status),
  );
  const history = roots.filter(
    (run) => !['running', 'waiting'].includes(run.status),
  );
  const attentionById = new Map(attention.map((entry) => [entry.runId, entry]));
  const needsAttention = roots.filter((run) => attentionById.has(run.id));
  const visible =
    tab === 'active' ? active : tab === 'attention' ? needsAttention : history;
  return (
    <div className={layout.page}>
      {!workflowId && (
        <header className={layout.header}>
          <div>
            <h1>Runs</h1>
          </div>
        </header>
      )}
      <Tabs
        value={tab}
        onChange={(value) =>
          onTabChange(
            value === 'history' || value === 'attention' ? value : 'active',
          )
        }
      >
        <Tabs.List className="run-tabs">
          <Tabs.Tab value="active">Active {active.length}</Tabs.Tab>
          <Tabs.Tab value="attention">
            Needs attention {needsAttention.length}
          </Tabs.Tab>
          <Tabs.Tab value="history">History {history.length}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value={tab} pt="md">
          {tab === 'history' && act && (
            <Group justify="flex-end" mb="md">
              <Button variant="light" onClick={() => setCleanup(true)}>
                Clean up history
              </Button>
            </Group>
          )}
          {visible.length ? (
            <div className="run-table">
              <div className="run-row table-heading">
                <span>Workflow</span>
                <span>Status</span>
                <span>Started</span>
                <span>Steps</span>
                <span />
              </div>
              {visible.map((r) => (
                <button
                  className="run-row"
                  key={r.id}
                  onClick={() => {
                    const entry = attentionById.get(r.id);
                    if (entry)
                      onOpen(entry.target.runId, entry.target.executionId);
                    else onOpen(r.id);
                  }}
                >
                  <span>
                    <strong>{r.workflowName}</strong>
                    <small>
                      v{r.version} · {r.id.slice(0, 8)}
                    </small>
                    <ComparisonContext comparison={r.comparison} />
                    {r.parentMode === 'detached' && (
                      <small>
                        Started independently · from{' '}
                        {runs.find((parent) => parent.id === r.parentRunId)
                          ?.workflowName ?? r.parentRunId?.slice(0, 8)}
                      </small>
                    )}
                  </span>
                  <span className="run-status">
                    <Badge status={r.status} />
                    {attentionById.has(r.id) && (
                      <small className="run-attention">
                        {attentionText(attentionById.get(r.id)!)}
                      </small>
                    )}
                  </span>
                  <span>{new Date(r.createdAt).toLocaleString()}</span>
                  <span>{r.executions.length}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">
              <Activity size={28} />
              <h2>
                {tab === 'active'
                  ? 'No active runs.'
                  : tab === 'attention'
                    ? 'No runs need your attention.'
                    : 'No history yet.'}
              </h2>
              <p>
                {tab === 'active'
                  ? workflowId
                    ? 'Choose Run above to start a published version of this workflow.'
                    : 'Open a published workflow and choose Run to start.'
                  : tab === 'attention'
                    ? 'Approval requests, questions, and recovery checks appear here.'
                    : 'Completed, failed, and cancelled runs appear here.'}
              </p>
            </div>
          )}
        </Tabs.Panel>
      </Tabs>
      {cleanup && act && (
        <HistoryCleanupDialog
          workflowId={workflowId}
          workflows={
            workflows
              ? workflows.map((workflow) => ({
                  value: workflow.id,
                  label: workflow.name,
                }))
              : [
                  ...new Map(
                    runs.map((run) => [
                      run.workflowId,
                      { value: run.workflowId, label: run.workflowName },
                    ]),
                  ).values(),
                ]
          }
          act={act}
          onClose={() => setCleanup(false)}
        />
      )}
    </div>
  );
}
