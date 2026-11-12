import {
  Alert,
  Anchor,
  Button,
  Loader,
  Select,
  TextInput,
  PageHeader,
  workspacePage,
} from '../../design-system';

import { WorkspaceReads } from '../../components/WorkspaceReads';
import { ListTable, ListTableRow } from '../../components/ListTable/ListTable';
import { useEffect } from 'react';
import { trpc, useQuery, useRefreshOnTick } from '../../lib/query';
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router';

import {
  ArrowRight,
  CalendarClock,
  Search,
  Timer,
  Workflow as WorkflowIcon,
  Zap,
} from 'lucide-react';
import type { AppContext } from '../../App';
import { PageTabs } from '../../components/PageLayout/PageLayout';
import { automationDraftKey, paths } from '../../routes/paths';
import { errorMessage } from '../../lib/api';
import { AutomationEditor } from './AutomationEditor';
import { AutomationDetail } from './AutomationDetail';
import {
  AutomationListSkeleton,
  AutomationRowsSkeleton,
} from './AutomationListSkeleton';
import {
  automationTable,
  automationStatus,
  eventLabels,
  listHref,
  listQuery,
  outcomeLabel,
  returnHref,
  statusViews,
  timestamp,
  timingLabel,
} from './model';
import classes from './Automations.module.css';

export function Automations() {
  const { workflowsRead } = useOutletContext<AppContext>();
  const { automationId } = useParams();
  const location = useLocation();
  const [search] = useSearchParams();
  const editing = automationId && location.pathname.endsWith('/edit');
  if (automationId && !editing)
    return <AutomationDetail key={automationId} id={automationId} />;

  const creating = location.pathname.endsWith('/new');
  const kind = search.get('type');
  if (creating && kind !== 'schedule' && kind !== 'event')
    return <AutomationType />;

  const editor = editing ? (
    <AutomationEditor key={automationId} id={automationId} />
  ) : creating && (kind === 'schedule' || kind === 'event') ? (
    <AutomationEditor key={automationDraftKey(search)} kind={kind} />
  ) : null;
  return (
    <WorkspaceReads
      reads={[workflowsRead]}
      subject="automations"
      title="Automations"
      loading={
        editor ? (
          <section className={workspacePage.page}>
            <PageHeader title="Automations" />
            <div className={workspacePage.content}>
              <Loader aria-label="Loading automations" />
            </div>
          </section>
        ) : (
          <AutomationListSkeleton />
        )
      }
    >
      {editor ?? <AutomationList />}
    </WorkspaceReads>
  );
}

function AutomationType() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const href = (kind: string) => {
    const next = new URLSearchParams(search);
    next.set('type', kind);
    return `${paths.automationNew}?${next}`;
  };
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title="New automation"
        onBack={() => void navigate(returnHref(search))}
        backLabel="Back to automations"
        actions={
          <Button
            variant="secondary"
            onClick={() => void navigate(returnHref(search))}
          >
            Cancel
          </Button>
        }
      />
      <div className={workspacePage.content}>
        <h2 className={classes.choiceHeading}>
          What should start the workflow?
        </h2>
        <div className={classes.choices}>
          <Link to={href('schedule')} className={classes.choice}>
            <CalendarClock size={24} />
            <div>
              <h2>Schedule</h2>
              <p>Run a workflow on an interval or a cron schedule.</p>
            </div>
            <ArrowRight size={18} />
          </Link>
          <Link to={href('event')} className={classes.choice}>
            <WorkflowIcon size={24} />
            <div>
              <h2>Interlock event</h2>
              <p>
                Run a workflow when another run finishes or needs attention.
              </p>
            </div>
            <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function AutomationList() {
  const { workflows, tick } = useOutletContext<AppContext>();
  const [search, setSearch] = useSearchParams();
  const query = listQuery(search);
  const result = useQuery(
    trpc.triggers.list.queryOptions({ ...query, limit: 20 }),
  );
  useRefreshOnTick(tick, result.refetch, true, result.isFetching);
  const page = result.data;
  const error = result.error ? errorMessage(result.error) : '';
  const loading = result.isFetching;
  useEffect(() => {
    if (page && page.total > 0 && query.offset >= page.total) {
      setSearch(
        new URLSearchParams(
          listHref({
            ...query,
            offset: Math.floor((page.total - 1) / 20) * 20,
          }).split('?')[1],
        ),
        { replace: true },
      );
    }
  }, [page, query.offset, setSearch]);
  const change = (key: string, value?: string) =>
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete('offset');
        return next;
      },
      { replace: key === 'search' },
    );
  const from = search.toString();
  const newSearch = new URLSearchParams();
  if (from) newSearch.set('from', from);
  if (query.workflowId) newSearch.set('workflow', query.workflowId);
  const newHref = paths.automationNew + (newSearch.size ? `?${newSearch}` : '');
  const items = statusViews.map((item) => ({
    ...item,
    count: page?.counts[item.value],
    to: listHref({ ...query, status: item.value, offset: 0 }),
  }));
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title="Automations"
        controls={
          <>
            <Select
              className={classes.workflowFilter}
              aria-label="Filter by workflow"
              searchable
              clearable
              placeholder="All workflows"
              value={query.workflowId ?? null}
              data={workflows.map((w) => ({ value: w.id, label: w.name }))}
              onChange={(value) => change('workflow', value || undefined)}
            />
            <TextInput
              className={classes.toolbarSearch}
              aria-label="Search automations"
              placeholder="Search automations"
              maxLength={200}
              leftSection={<Search size={14} />}
              value={query.search}
              onChange={(event) => change('search', event.currentTarget.value)}
            />
          </>
        }
        actions={
          <Button variant="primary" component={Link} to={newHref}>
            New automation
          </Button>
        }
      />
      <PageTabs label="Automation views" items={items} value={query.status} />
      <div className={workspacePage.content} aria-busy={loading}>
        {error && (
          <Alert
            color="red"
            mb="md"
            title={
              page
                ? 'Automations may be out of date'
                : 'Could not load automations'
            }
          >
            {error}
            <Button variant="ghost" onClick={() => void result.refetch()}>
              Retry loading
            </Button>
          </Alert>
        )}
        {!page ? (
          !error && <AutomationRowsSkeleton />
        ) : page.items.length ? (
          <>
            <ListTable {...automationTable} label="Automations">
              {page.items.map((trigger) => {
                const state = automationStatus(trigger);
                const sourceId =
                  trigger.kind === 'event' && trigger.scope.type === 'workflow'
                    ? trigger.scope.workflowId
                    : undefined;
                const source =
                  trigger.kind === 'event'
                    ? trigger.scope.type === 'library'
                      ? 'Any workflow'
                      : (workflows.find((w) => w.id === sourceId)?.name ??
                        'Missing workflow')
                    : '';
                const condition =
                  trigger.kind === 'schedule'
                    ? timingLabel(trigger)
                    : `${source} · ${trigger.events.map((event) => eventLabels[event].toLowerCase()).join(', ')}`;
                const latest = trigger.lastActivity;
                return (
                  <ListTableRow key={trigger.id}>
                    <span className={classes.identity}>
                      <strong>
                        <Anchor
                          component={Link}
                          to={
                            paths.automation(trigger.id) +
                            (from ? `?from=${encodeURIComponent(from)}` : '')
                          }
                          underline="hover"
                        >
                          {trigger.name}
                        </Anchor>
                      </strong>
                      <span className={classes.condition}>
                        {trigger.kind === 'schedule' ? (
                          <Timer size={14} />
                        ) : (
                          <WorkflowIcon size={14} />
                        )}
                        {condition}
                      </span>
                    </span>
                    <span>{trigger.workflowName}</span>
                    <span className={classes.state} data-state={state}>
                      {state}
                    </span>
                    <span className={classes.activity}>
                      <span>
                        {trigger.autoPaused
                          ? `${trigger.consecutiveFailures} consecutive failures`
                          : latest
                            ? `${outcomeLabel(latest.outcome)} · ${timestamp(latest.at)}`
                            : 'No activity yet'}
                      </span>
                      <small>
                        {!trigger.enabled
                          ? 'Disabled'
                          : trigger.autoPaused
                            ? 'Automatically paused'
                            : trigger.kind === 'schedule'
                              ? `Next: ${timestamp(trigger.nextFireAt, trigger.timing.type === 'cron' ? trigger.timing.timeZone : undefined)}`
                              : 'Listening for events'}
                      </small>
                    </span>
                  </ListTableRow>
                );
              })}
            </ListTable>
            <div className={classes.pagination}>
              <span>
                {page.total} automation{page.total === 1 ? '' : 's'}
              </span>
              {query.offset > 0 && (
                <Button
                  variant="secondary"
                  component={Link}
                  to={listHref({
                    ...query,
                    offset: Math.max(0, query.offset - 20),
                  })}
                >
                  Previous
                </Button>
              )}
              {page.nextOffset !== null && (
                <Button
                  variant="secondary"
                  component={Link}
                  to={listHref({ ...query, offset: page.nextOffset })}
                >
                  Next
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className={classes.empty}>
            <Zap size={28} />
            <h2>
              {query.search || query.status !== 'all' || query.workflowId
                ? 'No matching automations'
                : 'No automations yet'}
            </h2>
            <p>
              {query.search || query.status !== 'all' || query.workflowId
                ? 'Change your filters or create an automation.'
                : 'Start a workflow on a schedule or when an Interlock event occurs.'}
            </p>
            <Button variant="primary" component={Link} to={newHref}>
              New automation
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
