import { Tabs } from '@mantine/core';
import type { Run } from '@interlock/core';
import { ArrowUpRight, Activity } from 'lucide-react';
import layout from '../../components/PageLayout/PageLayout.module.css';
import { Badge } from '../../components/Badge/Badge';
export function RunList({
  runs,
  onOpen,
  tab,
  onTabChange,
  workflowId,
}: {
  runs: Run[];
  tab: 'active' | 'history';
  onTabChange: (tab: 'active' | 'history') => void;
  onOpen: (id: string) => void;
  workflowId?: string;
}) {
  const roots = runs.filter((r) =>
    workflowId ? r.workflowId === workflowId && !r.batchNodeId : !r.parentRunId,
  );
  const active = roots.filter((run) =>
    ['running', 'waiting'].includes(run.status),
  );
  const history = roots.filter(
    (run) => !['running', 'waiting'].includes(run.status),
  );
  const visible = tab === 'active' ? active : history;
  return (
    <div className={layout.page}>
      {!workflowId && (
        <header className={layout.header}>
          <div>
            <h1>Runs</h1>
            <p>Follow ongoing work and inspect past results.</p>
          </div>
        </header>
      )}
      <Tabs
        value={tab}
        onChange={(value) =>
          onTabChange(value === 'history' ? 'history' : 'active')
        }
      >
        <Tabs.List>
          <Tabs.Tab value="active">Active {active.length}</Tabs.Tab>
          <Tabs.Tab value="history">History {history.length}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value={tab} pt="md">
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
                  onClick={() => onOpen(r.id)}
                >
                  <span>
                    <strong>{r.workflowName}</strong>
                    <small>
                      v{r.version} · {r.id.slice(0, 8)}
                    </small>
                  </span>
                  <Badge status={r.status} />
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
                {tab === 'active' ? 'No active runs.' : 'No history yet.'}
              </h2>
              <p>
                {tab === 'active'
                  ? workflowId
                    ? 'Choose Run above to start a published version of this workflow.'
                    : 'Open a published workflow and choose Run to start.'
                  : 'Completed, failed, and cancelled runs appear here.'}
              </p>
            </div>
          )}
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
