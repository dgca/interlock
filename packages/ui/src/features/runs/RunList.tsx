import {
  Alert,
  Button,
  Group,
  SegmentedControl,
  Tabs,
  Text,
  PageHeader,
  PageTabList,
  PageToolbar,
  workspacePage,
} from '../../design-system';

import { ListTable, ListTableRow } from '../../components/ListTable/ListTable';
import { runColumns, runViews, type RunMode } from './runListConfig';
import { AutomationAlerts } from '../automations/AutomationAlerts';

import { RunBoardSkeleton, RunRowsSkeleton } from './RunListSkeleton';
import classes from './RunList.module.css';
import { attentionText, waitReasonText, type RunTab } from './runAttention';
import { runProjectionText } from './runProjectionText';

import { useEffect, useId, useRef, useState } from 'react';
import { HistoryCleanupDialog } from './HistoryCleanupDialog';
import { RetentionSettingsDialog } from './RetentionSettings';
import type { Action } from '../../lib/useActionFeedback';
import { ChevronRight, Activity } from 'lucide-react';
import { ComparisonContext } from './ComparisonContext';
import { api, errorMessage } from '../../lib/api';
import { RunListBoard, type BoardPreview } from './RunListBoard';
import { RunTags } from './RunTags';
import { RunTagFilter, AppliedRunTagFilters } from './RunTagFilter';

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
  tags,
  onTagsChange,
  mode,
  onModeChange,
}: {
  mode?: RunMode;
  onModeChange?: (mode: RunMode) => void;
  tick: number;
  offset: number;
  onOffsetChange: (offset: number) => void;
  tab: RunTab;
  onTabChange: (tab: RunTab) => void;
  onOpen: (id: string, executionId?: string) => void;
  workflowId?: string;
  act?: Action;
  workflows: { id: string; name: string }[];
  tags?: Record<string, string>;
  onTagsChange?: (tags?: Record<string, string>) => void;
}) {
  const tagFilterId = useId();
  const [localTags, setLocalTags] = useState(tags);
  const selectedTags = onTagsChange ? tags : localTags;
  const tagsKey = JSON.stringify(selectedTags ?? {});
  const changeTags = (next?: Record<string, string>) => {
    if (onTagsChange) onTagsChange(next);
    else {
      setLocalTags(next);
      onOffsetChange(0);
    }
  };
  const clearFilters = () => changeTags(undefined);
  const [localMode, setLocalMode] = useState<RunMode>('list');
  const selectedMode = mode ?? localMode;
  const changeMode = (next: RunMode) => {
    if (onModeChange) onModeChange(next);
    else setLocalMode(next);
  };
  const showListTab = (next: RunTab) => {
    // Route callbacks update mode, tab and offset together in one history entry.
    setLocalMode('list');
    onTabChange(next);
  };
  const queryTab = selectedMode === 'overview' ? 'active' : tab;
  const queryOffset = selectedMode === 'overview' ? 0 : offset;
  const [previewReload, setPreviewReload] = useState(0);
  const [previewSnapshot, setPreviewSnapshot] = useState<{
    key: string;
    data: BoardPreview;
  }>();
  const previewKey = JSON.stringify({ workflowId, tagsKey });
  const refreshPreview = useRef<() => void>(undefined);
  useEffect(() => {
    if (selectedMode !== 'overview') return;
    let current = true;
    let inFlight = false;
    let queued = false;
    const load = async () => {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      do {
        queued = false;
        const [attention, completed] = await Promise.allSettled([
          api.runs.summaries.query({
            tab: 'attention',
            workflowId,
            tags: selectedTags,
            offset: 0,
            limit: 6,
          }),
          api.runs.summaries.query({
            tab: 'history',
            status: 'completed',
            workflowId,
            tags: selectedTags,
            offset: 0,
            limit: 6,
          }),
        ]);
        if (current)
          setPreviewSnapshot({
            key: previewKey,
            data: {
              ...(attention.status === 'fulfilled'
                ? { attention: attention.value }
                : { attentionError: errorMessage(attention.reason) }),
              ...(completed.status === 'fulfilled'
                ? { completed: completed.value }
                : { completedError: errorMessage(completed.reason) }),
            },
          });
      } while (current && queued);
      inFlight = false;
    };
    refreshPreview.current = () => void load();
    return () => {
      current = false;
      refreshPreview.current = undefined;
    };
  }, [selectedMode, previewKey]);
  useEffect(
    () => refreshPreview.current?.(),
    [selectedMode, previewKey, tick, previewReload],
  );
  const [cleanup, setCleanup] = useState(false);
  const [retention, setRetention] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    tab: RunTab;
    workflowId?: string;
    tagsKey: string;
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
            tab: queryTab,
            workflowId,
            tags: selectedTags,
            offset: queryOffset,
            limit: pageSize,
          });
          if (current) {
            setSnapshot({ tab: queryTab, workflowId, tagsKey, page });
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
  }, [queryTab, workflowId, queryOffset, tagsKey]);
  useEffect(
    () => refresh.current?.(),
    [queryTab, workflowId, queryOffset, tagsKey, tick],
  );
  const scoped =
    snapshot?.workflowId === workflowId && snapshot?.tagsKey === tagsKey
      ? snapshot
      : undefined;
  const lastPage = scoped?.tab === queryTab ? scoped.page : undefined;
  const page = lastPage?.offset === queryOffset ? lastPage : undefined;
  const counts = scoped?.page.counts;
  const historyActions =
    selectedMode === 'list' && tab === 'history' && act ? (
      <>
        <Button variant="secondary" onClick={() => setRetention(true)}>
          Retention settings
        </Button>
        <Button variant="secondary" onClick={() => setCleanup(true)}>
          Clean up history
        </Button>
      </>
    ) : null;
  const controls = (
    <>
      <SegmentedControl
        aria-label="Run presentation"
        value={selectedMode}
        onChange={(value) =>
          changeMode(value === 'overview' ? 'overview' : 'list')
        }
        data={[
          { value: 'list', label: 'List' },
          { value: 'overview', label: 'Overview' },
        ]}
      />
      <RunTagFilter
        key={workflowId ?? 'library'}
        filterId={tagFilterId}
        value={selectedTags}
        onChange={changeTags}
      />
    </>
  );
  const tabItems = runViews.map((view) => ({
    ...view,
    count: counts
      ? counts[view.value] +
        (view.value === 'attention'
          ? (scoped?.page.scheduleAttentionCount ?? 0)
          : 0)
      : undefined,
  }));
  const content = (
    <>
      {selectedMode === 'list' && tab === 'attention' && (
        <AutomationAlerts
          key={workflowId === undefined ? 'library' : `workflow:${workflowId}`}
          tick={tick}
          workflowId={workflowId}
        />
      )}
      {error && (
        <Alert
          color="red"
          mb="md"
          title={page ? 'Runs may be out of date' : 'Could not load runs'}
        >
          {error}
          <Button variant="ghost" onClick={() => refresh.current?.()}>
            Retry
          </Button>
        </Alert>
      )}
      {!page ? (
        !error &&
        (selectedMode === 'overview' ? (
          <RunBoardSkeleton />
        ) : (
          <RunRowsSkeleton />
        ))
      ) : selectedMode === 'overview' ? (
        <RunListBoard
          page={page}
          preview={
            previewSnapshot?.key === previewKey
              ? previewSnapshot.data
              : undefined
          }
          onOpen={onOpen}
          onTabChange={showListTab}
          retry={() => setPreviewReload((value) => value + 1)}
          onClearFilters={
            Object.keys(selectedTags ?? {}).length ? clearFilters : undefined
          }
        />
      ) : page.items.length ? (
        <ListTable columns={runColumns}>
          {page.items.map((r) => {
            const started = new Date(r.createdAt);
            return (
              <ListTableRow
                className={`run-row ${classes.row}`}
                key={r.id}
                onClick={() => {
                  const entry = r.attention;
                  if (entry)
                    onOpen(entry.target.runId, entry.target.executionId);
                  else onOpen(r.id);
                }}
              >
                <span className={classes.identity}>
                  <strong>{r.workflowName}</strong>
                  <small>
                    v{r.version} · {r.id.slice(0, 8)}
                  </small>
                  <ComparisonContext comparison={r.comparison} />
                  <RunTags tags={r.tags} compact />
                  {r.parentMode === 'detached' && (
                    <small>
                      Started independently · from{' '}
                      {r.parentWorkflowName ?? r.parentRunId?.slice(0, 8)}
                    </small>
                  )}
                </span>
                <span className={classes.status}>
                  <span className={classes.state} data-status={r.status}>
                    {r.status}
                  </span>
                  {r.actor ? (
                    <small className={classes.reason}>
                      {runProjectionText(
                        r,
                        r.waiting?.kind === 'human_request' && r.attention
                          ? attentionText(r.attention)
                          : undefined,
                      )}
                    </small>
                  ) : r.waitReason && !r.attention ? (
                    <small className={classes.reason}>
                      {waitReasonText[r.waitReason]}
                    </small>
                  ) : null}
                  {r.attention &&
                    (!r.actor || r.waiting?.kind !== 'human_request') && (
                      <small className={classes.attention}>
                        {attentionText(r.attention)}
                      </small>
                    )}
                </span>
                <span className={classes.started}>
                  <time dateTime={r.createdAt}>
                    {started.toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </time>
                  <small>
                    {started.toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      timeZoneName: 'short',
                    })}
                  </small>
                </span>
                <span className={classes.steps}>{r.executionCount}</span>
                <ChevronRight size={16} />
              </ListTableRow>
            );
          })}
        </ListTable>
      ) : offset > 0 ? (
        <Text role="status">No runs on this page.</Text>
      ) : tab === 'attention' && page.scheduleAttentionCount > 0 ? null : (
        <div className={classes.empty}>
          <Activity size={28} />
          <h2>
            {Object.keys(selectedTags ?? {}).length
              ? 'No runs match these tags.'
              : tab === 'active'
                ? 'No active runs.'
                : tab === 'attention'
                  ? 'No runs need your attention.'
                  : 'No history yet.'}
          </h2>
          <p>
            {Object.keys(selectedTags ?? {}).length
              ? 'Change or clear the tag filters to see other runs.'
              : tab === 'active'
                ? workflowId
                  ? 'Choose Run above to start a published version of this workflow.'
                  : 'Open a published workflow and choose Run to start.'
                : tab === 'attention'
                  ? 'Approval requests, questions, and recovery checks appear here.'
                  : 'Completed, failed, and cancelled runs appear here.'}
          </p>
        </div>
      )}
      {selectedMode === 'list' &&
        (offset > 0 || (counts?.[tab] ?? 0) > pageSize) && (
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
                variant="ghost"
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
                variant="ghost"
                aria-disabled={page?.nextOffset == null}
                data-disabled={page?.nextOffset == null || undefined}
                onClick={() => {
                  if (page?.nextOffset != null) onOffsetChange(page.nextOffset);
                }}
              >
                Next
              </Button>
            </Group>
          </Group>
        )}
    </>
  );
  return (
    <section className={workspacePage.page}>
      {!workflowId && (
        <PageHeader title="Runs" controls={controls} actions={historyActions} />
      )}
      {selectedMode === 'list' ? (
        <Tabs
          unstyled
          className={classes.sections}
          value={tab}
          onChange={(value) =>
            onTabChange(
              value === 'history' || value === 'attention' ? value : 'active',
            )
          }
        >
          <PageTabList
            label="Run views"
            items={tabItems}
            toolbar={
              workflowId ? (
                <>
                  {controls}
                  {historyActions}
                </>
              ) : undefined
            }
          />
          <AppliedRunTagFilters
            filterId={tagFilterId}
            value={selectedTags}
            onChange={changeTags}
          />
          <Tabs.Panel value={tab} className={workspacePage.content}>
            {content}
          </Tabs.Panel>
        </Tabs>
      ) : (
        <div className={classes.sections}>
          {workflowId && <PageToolbar>{controls}</PageToolbar>}
          <AppliedRunTagFilters
            filterId={tagFilterId}
            value={selectedTags}
            onChange={changeTags}
          />
          <div className={workspacePage.content}>{content}</div>
        </div>
      )}
      {retention && (
        <RetentionSettingsDialog
          key={workflowId ?? 'library'}
          workflowId={workflowId}
          onClose={() => setRetention(false)}
        />
      )}
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
    </section>
  );
}
