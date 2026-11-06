import { attentionText, type RunTab } from './runAttention';
import { Button, Group, Tabs, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { HistoryCleanupDialog } from './HistoryCleanupDialog';
import type { Action } from '../../lib/useActionFeedback';
import { ArrowUpRight, Activity } from 'lucide-react';
import layout from '../../components/PageLayout/PageLayout.module.css';
import { Badge } from '../../components/Badge/Badge';
import { ComparisonContext } from './ComparisonContext';
import { api, errorMessage } from '../../lib/api';

type Page = Awaited<ReturnType<typeof api.runs.summaries.query>>;
const pageSize = 100;

export function RunList({
  tick,
  offset,
  onOffsetChange,
  onOpen,
  tab,
  onTabChange,
  workflowId,
  act,
  workflows,
}: {
  tick: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  tab: RunTab;
  onTabChange: (tab: RunTab) => void;
  onOpen: (id: string, executionId?: string) => void;
  workflowId?: string;
  act?: Action;
  workflows: { id: string; name: string }[];
}) {
  const [cleanup, setCleanup] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    tab: RunTab;
    workflowId?: string;
    page: Page;
  }>();
  const [error, setError] = useState('');
  const refresh = useRef<() => void>(undefined);
  useEffect(() => {
    let current = true;
    let inFlight = false;
    let queued = false;
    setError('');
    const load = async () => {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      do {
        queued = false;
        try {
          const page = await api.runs.summaries.query({
            tab,
            workflowId,
            offset,
            limit: pageSize,
          });
          if (current) {
            setSnapshot({ tab, workflowId, page });
            setError('');
          }
        } catch (error) {
          if (current) setError(errorMessage(error));
        }
      } while (current && queued);
      inFlight = false;
    };
    refresh.current = () => void load();
    return () => {
      current = false;
      refresh.current = undefined;
    };
  }, [tab, workflowId, offset]);
  useEffect(() => refresh.current?.(), [tab, workflowId, offset, tick]);
  const scoped = snapshot?.workflowId === workflowId ? snapshot : undefined;
  const lastPage = scoped?.tab === tab ? scoped.page : undefined;
  const page = lastPage?.offset === offset ? lastPage : undefined;
  const counts = scoped?.page.counts;
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
          <Tabs.Tab value="active">
            Active{counts && ` ${counts.active}`}
          </Tabs.Tab>
          <Tabs.Tab value="attention">
            Needs attention{counts && ` ${counts.attention}`}
          </Tabs.Tab>
          <Tabs.Tab value="history">
            History{counts && ` ${counts.history}`}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value={tab} pt="md">
          {tab === 'history' && act && (
            <Group justify="flex-end" mb="md">
              <Button variant="light" onClick={() => setCleanup(true)}>
                Clean up history
              </Button>
            </Group>
          )}
          {error && (
            <Group>
              <Text role="alert">Could not load runs. {error}</Text>
              <Button variant="subtle" onClick={() => refresh.current?.()}>
                Retry
              </Button>
            </Group>
          )}
          {!page ? (
            !error && <Text role="status">Loading runs…</Text>
          ) : page.items.length ? (
            <div className="run-table">
              <div className="run-row table-heading">
                <span>Workflow</span>
                <span>Status</span>
                <span>Started</span>
                <span>Steps</span>
                <span />
              </div>
              {page.items.map((r) => (
                <button
                  className="run-row"
                  key={r.id}
                  onClick={() => {
                    const entry = r.attention;
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
                        {r.parentWorkflowName ?? r.parentRunId?.slice(0, 8)}
                      </small>
                    )}
                  </span>
                  <span className="run-status">
                    <Badge status={r.status} />
                    {r.attention && (
                      <small className="run-attention">
                        {attentionText(r.attention)}
                      </small>
                    )}
                  </span>
                  <span>{new Date(r.createdAt).toLocaleString()}</span>
                  <span>{r.executionCount}</span>
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          ) : offset > 0 ? (
            <Text role="status">No runs on this page.</Text>
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
          {(offset > 0 || (counts?.[tab] ?? 0) > pageSize) && (
            <Group
              justify="space-between"
              mt="md"
              role="navigation"
              aria-label="Run pages"
            >
              <Text size="sm" c="dimmed" aria-live="polite">
                {page &&
                  page.items.length > 0 &&
                  `${offset + 1} to ${offset + page.items.length} of ${page.total}`}
              </Text>
              <Group gap="xs">
                <Button
                  variant="subtle"
                  aria-disabled={offset === 0}
                  data-disabled={offset === 0 || undefined}
                  onClick={() => {
                    if (offset === 0) return;
                    onOffsetChange(
                      page?.items.length === 0
                        ? 0
                        : Math.max(0, offset - pageSize),
                    );
                  }}
                >
                  Previous
                </Button>
                <Button
                  variant="subtle"
                  aria-disabled={page?.nextOffset == null}
                  data-disabled={page?.nextOffset == null || undefined}
                  onClick={() => {
                    if (page?.nextOffset != null)
                      onOffsetChange(page.nextOffset);
                  }}
                >
                  Next
                </Button>
              </Group>
            </Group>
          )}
        </Tabs.Panel>
      </Tabs>
      {cleanup && act && (
        <HistoryCleanupDialog
          workflowId={workflowId}
          workflows={workflows.map((workflow) => ({
            value: workflow.id,
            label: workflow.name,
          }))}
          act={act}
          onClose={() => setCleanup(false)}
        />
      )}
    </div>
  );
}
