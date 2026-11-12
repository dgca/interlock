import {
  Alert,
  Button,
  Group,
  Switch,
  Modal,
  ModalBody,
  ModalFooter,
  LoadingSkeleton,
  PageHeader,
  workspacePage,
  ActionError,
} from '../../design-system';

import { useEffect, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from 'react-router';

import { Trash2 } from 'lucide-react';
import type { AppContext } from '../../App';
import { PageTabs } from '../../components/PageLayout/PageLayout';

import { api, errorMessage } from '../../lib/api';
import {
  trpc,
  useQuery,
  useQueryClient,
  useRefreshOnTick,
} from '../../lib/query';
import { paths, runOffset } from '../../routes/paths';
import {
  automationStatus,
  eventLabels,
  itemHref,
  outcomeLabel,
  returnHref,
  timestamp,
  timingLabel,
  type Inspection,
} from './model';
import classes from './Automations.module.css';

export function AutomationDetail({ id }: { id: string }) {
  const { tick } = useOutletContext<AppContext>();
  const navigate = useNavigate();
  const location = useLocation();
  const saved = location.state?.savedAutomation;
  const acknowledgedName: string | undefined =
    saved?.id === id ? saved.name : undefined;
  const [search] = useSearchParams();
  const view = search.get('view') === 'settings' ? 'settings' : 'activity';
  const offset = runOffset(search.get('offset'));
  const queryClient = useQueryClient();
  const inspectionOptions = trpc.triggers.inspect.queryOptions({
    id,
    offset,
    limit: 20,
  });
  const inspection = useQuery(inspectionOptions);
  useRefreshOnTick(tick, inspection.refetch, true, inspection.isFetching);
  const data = inspection.data;
  const error = inspection.error ? errorMessage(inspection.error) : '';
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<'disable' | 'delete'>();
  const inFlight = useRef(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const enabledTrigger = useRef<HTMLInputElement>(null);
  const resumeTrigger = useRef<HTMLButtonElement>(null);
  const returnFocusAfterResume = useRef(false);
  useEffect(() => {
    if (!data) return;
    const history =
      data.trigger.kind === 'schedule' ? data.fires : data.deliveries;
    if (offset > 0 && offset >= history.total) {
      const nextSearch = new URLSearchParams(search);
      nextSearch.delete('offset');
      navigate(`${paths.automation(id)}?${nextSearch}`, { replace: true });
    }
  }, [data, id, offset, navigate, search]);
  const trigger = data?.trigger;
  useEffect(() => {
    if (!trigger?.autoPaused && returnFocusAfterResume.current) {
      returnFocusAfterResume.current = false;
      if (document.activeElement === document.body)
        enabledTrigger.current?.focus();
    }
  }, [trigger?.autoPaused]);
  const perform = async (action: 'enable' | 'disable' | 'delete') => {
    if (!trigger || inFlight.current) return;
    const resumingWithFocus =
      action === 'enable' && document.activeElement === resumeTrigger.current;
    inFlight.current = true;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const result = await api.triggers.manage.mutate({
        action,
        id,
        expectedRevision: trigger.revision,
      });
      setConfirmation(undefined);
      if (!result.trigger) {
        queryClient.removeQueries({
          ...trpc.triggers.inspect.pathFilter(),
          predicate: (query) =>
            (query.state.data as Inspection | undefined)?.trigger.id === id,
        });
        void queryClient.invalidateQueries(trpc.triggers.pathFilter());
        void navigate(returnHref(search));
        return;
      }
      const saved = result.trigger;
      if (resumingWithFocus && !saved.autoPaused)
        returnFocusAfterResume.current = true;
      // Acknowledged writes win over any read that started before the save.
      await queryClient.cancelQueries(trpc.triggers.inspect.pathFilter());
      queryClient.setQueriesData<Inspection>(
        trpc.triggers.inspect.pathFilter(),
        (previous) =>
          previous?.trigger.id === id &&
          previous.trigger.revision <= saved.revision
            ? ({
                ...previous,
                trigger: { ...previous.trigger, ...saved },
              } as Inspection)
            : previous,
      );
      setNotice(
        action === 'enable'
          ? ''
          : 'Automation disabled. Existing runs continue.',
      );
      void queryClient.invalidateQueries(trpc.triggers.pathFilter(), {
        cancelRefetch: false,
      });
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const detailHref = (nextView: string, nextOffset = 0) => {
    const next = new URLSearchParams(search);
    if (nextView === 'settings') next.set('view', nextView);
    else next.delete('view');
    if (nextOffset) next.set('offset', String(nextOffset));
    else next.delete('offset');
    return paths.automation(id) + (next.size ? `?${next}` : '');
  };
  const history = trigger?.kind === 'schedule' ? data?.fires : data?.deliveries;
  return (
    <section className={workspacePage.page}>
      <PageHeader
        title={trigger?.name ?? acknowledgedName ?? 'Automation'}
        status={
          trigger
            ? [
                trigger.enabled && trigger.autoPaused
                  ? 'Auto-paused'
                  : undefined,
                trigger.kind === 'schedule' ? timingLabel(trigger) : undefined,
                trigger.workflowName,
              ]
                .filter(Boolean)
                .join(' · ')
            : acknowledgedName
              ? 'Saved'
              : undefined
        }
        onBack={() => void navigate(returnHref(search))}
        backLabel="Back to automations"
        busy={busy}
        actions={
          trigger && (
            <>
              <Button
                component={Link}
                to={itemHref(id, search, true)}
                variant="secondary"
                disabled={busy || !!error}
              >
                Edit
              </Button>
              <Button
                variant="secondary"
                ref={deleteTrigger}
                aria-label="Delete automation"
                leftSection={<Trash2 size={16} aria-hidden="true" />}
                disabled={busy || !!error}
                onClick={() => {
                  setActionError('');
                  setConfirmation('delete');
                }}
              >
                Delete
              </Button>
              <div className={classes.enabledControl}>
                <Switch
                  ref={enabledTrigger}
                  label="Enabled"
                  labelPosition="left"
                  size="md"
                  checked={trigger.enabled}
                  disabled={
                    busy || !!error || (!trigger.enabled && !trigger.canEnable)
                  }
                  onChange={(event) => {
                    if (event.currentTarget.checked) void perform('enable');
                    else {
                      setActionError('');
                      setConfirmation('disable');
                    }
                  }}
                />
              </div>
            </>
          )
        }
      />
      <PageTabs
        label="Automation sections"
        value={view}
        items={[
          { value: 'activity', label: 'Activity', to: detailHref('activity') },
          { value: 'settings', label: 'Settings', to: detailHref('settings') },
        ]}
      />
      <div className={workspacePage.content}>
        {notice && (
          <Alert role="status" color="blue" mb="md">
            {notice}
          </Alert>
        )}
        {error && (
          <Alert
            color="red"
            mb="md"
            title={
              data || acknowledgedName
                ? 'Could not refresh automation'
                : 'Could not load automation'
            }
          >
            {error}
            <Button variant="ghost" onClick={() => void inspection.refetch()}>
              Reload automation
            </Button>
          </Alert>
        )}
        {!confirmation && <ActionError message={actionError} />}
        {!trigger ? (
          !error && <LoadingSkeleton label="Loading automation…" />
        ) : (
          <>
            {!trigger.canEnable && (
              <Alert color="yellow" mb="md">
                Publish and restore the target workflow before enabling this
                automation.{' '}
                <Link to={paths.workflow(trigger.workflowId)}>
                  Open workflow
                </Link>
              </Alert>
            )}
            {trigger.autoPaused && (
              <Alert color="yellow" mb="md">
                {trigger.autoPaused.reason} · Review recent activity before
                resuming.
                {trigger.enabled && (
                  <Group mt="sm">
                    <Button
                      ref={resumeTrigger}
                      variant="secondary"
                      disabled={busy || !trigger.canEnable || !!error}
                      loading={busy && !confirmation}
                      onClick={() => void perform('enable')}
                    >
                      Resume automation
                    </Button>
                  </Group>
                )}
              </Alert>
            )}
            {trigger.holdCount > 0 && (
              <Alert color="yellow" mb="md">
                Execution is blocked by {trigger.holdCount} pause hold
                {trigger.holdCount === 1 ? '' : 's'}. Enabling this automation
                leaves those holds in place.
                {trigger.holds.map((hold) => (
                  <p key={hold.id} className={classes.hint}>
                    {hold.actor}: {hold.reason}
                  </p>
                ))}
                <Link to={paths.workflow(trigger.workflowId)}>
                  Open workflow
                </Link>
              </Alert>
            )}
            {trigger.enabled && trigger.excessiveLag && (
              <Alert color="yellow" mb="md">
                Scheduled work is {Math.floor(trigger.lagMs / 1000)} seconds
                late. Inspect its activity and admission blockers.
              </Alert>
            )}
            {view === 'settings' ? (
              <Settings data={data!} />
            ) : (
              <>
                <dl className={classes.summary}>
                  <div>
                    <dt>
                      {trigger.kind === 'schedule'
                        ? 'Next scheduled run'
                        : 'Event listener'}
                    </dt>
                    <dd>
                      {!trigger.enabled
                        ? 'Disabled'
                        : trigger.autoPaused
                          ? 'Automatically paused'
                          : trigger.kind === 'schedule'
                            ? timestamp(
                                trigger.nextFireAt,
                                trigger.timing.type === 'cron'
                                  ? trigger.timing.timeZone
                                  : undefined,
                              )
                            : trigger.holdCount
                              ? 'Waiting for pause release'
                              : 'Enabled'}
                    </dd>
                  </div>
                  <div>
                    <dt>Last occurrence</dt>
                    <dd>
                      {trigger.lastActivity
                        ? timestamp(trigger.lastActivity.at)
                        : trigger.lastFireAt
                          ? timestamp(trigger.lastFireAt)
                          : 'No activity yet'}
                    </dd>
                  </div>
                </dl>
                {history?.items.length ? (
                  <>
                    <div className={classes.activityTable}>
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">
                              {trigger.kind === 'schedule'
                                ? 'Scheduled'
                                : 'Received'}
                            </th>
                            <th scope="col">Outcome</th>
                            <th scope="col">Details</th>
                            <th scope="col">Run</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.items.map((entry) => (
                            <tr key={entry.id}>
                              <td>
                                {timestamp(
                                  'scheduledAt' in entry
                                    ? entry.scheduledAt
                                    : entry.occurredAt,
                                  trigger.kind === 'schedule' &&
                                    trigger.timing.type === 'cron'
                                    ? trigger.timing.timeZone
                                    : undefined,
                                )}
                              </td>
                              <td>{outcomeLabel(entry.outcome)}</td>
                              <td>
                                {'error' in entry && entry.error
                                  ? entry.error
                                  : 'reason' in entry && entry.reason
                                    ? outcomeLabel(entry.reason)
                                    : entry.outcome === 'skipped_overlap'
                                      ? 'A previous run is still in progress.'
                                      : entry.outcome === 'skipped_missed'
                                        ? 'The scheduled time was missed.'
                                        : entry.outcome === 'pending_quiescence'
                                          ? 'Source work has not stopped.'
                                          : entry.outcome === 'pending_pause'
                                            ? 'Waiting for pause release.'
                                            : entry.outcome === 'failed'
                                              ? 'The occurrence failed.'
                                              : 'runStatus' in entry &&
                                                  entry.runStatus
                                                ? `Run ${entry.runStatus}.`
                                                : 'Run accepted.'}
                                {'sourceRunId' in entry && (
                                  <div>
                                    <Link to={paths.run(entry.sourceRunId)}>
                                      View source run
                                    </Link>
                                  </div>
                                )}
                              </td>
                              <td>
                                {entry.runId ? (
                                  'runAvailable' in entry &&
                                  !entry.runAvailable ? (
                                    'Run history unavailable'
                                  ) : (
                                    <Link to={paths.run(entry.runId)}>
                                      View run
                                    </Link>
                                  )
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className={classes.pagination}>
                      <span>
                        {history.total} occurrence
                        {history.total === 1 ? '' : 's'}
                      </span>
                      {offset > 0 && (
                        <Button
                          component={Link}
                          variant="secondary"
                          to={detailHref('activity', Math.max(0, offset - 20))}
                        >
                          Previous
                        </Button>
                      )}
                      {history.nextOffset !== null && (
                        <Button
                          component={Link}
                          variant="secondary"
                          to={detailHref('activity', history.nextOffset)}
                        >
                          Next
                        </Button>
                      )}
                    </div>
                    <p className={classes.activityNote}>
                      Started and queued describe admission. Open a run to
                      inspect its progress and result.
                    </p>
                  </>
                ) : (
                  <div className={classes.emptyActivity}>
                    <h2>No activity yet</h2>
                    <p>
                      {trigger.kind === 'schedule'
                        ? 'Scheduled occurrences and their outcomes will appear here.'
                        : 'Matching events and their outcomes will appear here.'}
                    </p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      {confirmation && (
        <Modal
          title={`${confirmation === 'delete' ? 'Delete' : 'Disable'} automation?`}
          busy={busy}
          onClose={() => setConfirmation(undefined)}
          returnFocusTo={() =>
            confirmation === 'disable'
              ? (enabledTrigger.current ?? deleteTrigger.current)
              : deleteTrigger.current
          }
        >
          <ModalBody>
            <p>
              {confirmation === 'delete'
                ? 'Delete this automation and its activity history. Existing runs remain.'
                : 'Stop future starts from this automation. Existing active and queued runs continue.'}
            </p>
            <ActionError message={actionError} />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirmation(undefined)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              color={confirmation === 'delete' ? 'red' : undefined}
              loading={busy}
              onClick={() => void perform(confirmation)}
            >
              {busy
                ? confirmation === 'delete'
                  ? 'Deleting…'
                  : 'Disabling…'
                : confirmation === 'delete'
                  ? 'Delete automation'
                  : 'Disable automation'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}

function Settings({ data }: { data: Inspection }) {
  const trigger = data.trigger;
  return (
    <div className={`${workspacePage.card} ${classes.settings}`}>
      <dl>
        <dt>Workflow</dt>
        <dd>
          <Link to={paths.workflow(trigger.workflowId)}>
            {trigger.workflowName}
          </Link>
        </dd>
        <dt>Published version</dt>
        <dd>
          {trigger.publishedVersion
            ? `Latest published · currently v${trigger.publishedVersion}`
            : 'Not published'}
        </dd>
        <dt>Status</dt>
        <dd>{automationStatus(trigger)}</dd>
        {trigger.kind === 'schedule' ? (
          <>
            <dt>When</dt>
            <dd>{timingLabel(trigger)}</dd>
            <dt>Overlapping runs</dt>
            <dd>
              {
                {
                  skip: 'Skip this occurrence',
                  queue: 'Queue one run',
                  allow: 'Allow overlap',
                }[trigger.overlapPolicy]
              }
            </dd>
            <dt>Workflow inputs</dt>
            <dd>
              <pre>{JSON.stringify(trigger.input, null, 2)}</pre>
            </dd>
            {Object.values(trigger.bindings).some(Boolean) && (
              <>
                <dt>Schedule metadata bindings</dt>
                <dd>
                  <pre>{JSON.stringify(trigger.bindings, null, 2)}</pre>
                </dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>Watch runs from</dt>
            <dd>
              {trigger.scope.type === 'library' ? (
                'Any workflow'
              ) : (
                <Link to={paths.workflow(trigger.scope.workflowId)}>
                  Source workflow
                </Link>
              )}
            </dd>
            <dt>Events</dt>
            <dd>
              {trigger.events.map((event) => eventLabels[event]).join(', ')}
            </dd>
            <dt>Wait for source work to stop</dt>
            <dd>{trigger.waitForQuiescence ? 'Yes' : 'No'}</dd>
            <dt>Workflow input</dt>
            <dd>
              Compact source event, run identity, stage, and available error
              details.
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
