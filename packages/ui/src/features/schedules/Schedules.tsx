import { flushSync } from 'react-dom';
import { useBeforeUnloadWarning } from '../../lib/useBeforeUnloadWarning';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  MultiSelect,
  NumberInput,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import {
  scheduleConfigSchema,
  eventConfigSchema,
  webhookConfigSchema,
  triggerConfig,
  type WebhookConfig,
  type EventConfig,
  type TriggerConfig,
  type ScheduleConfig,
  type ScheduleMutation,
  type Workflow,
} from '@interlock/core';
import { Modal } from '../../components/Modal/Modal';
import { ModalBody, ModalFooter } from '../../components/Modal/ModalLayout';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { api, errorMessage } from '../../lib/api';
import { paths } from '../../routes/paths';
import styles from './Schedules.module.css';

type Inspection = Awaited<ReturnType<typeof api.triggers.inspect.query>>;
type Trigger = Inspection['trigger'];
type Listing = Awaited<ReturnType<typeof api.triggers.list.query>>;
const initialConfig: ScheduleConfig = {
  kind: 'schedule',
  name: '',
  timing: { type: 'interval', intervalMs: 120000 },
  input: {},
  bindings: {},
  overlapPolicy: 'skip',
  missedFirePolicy: 'skip',
  pauseAfterConsecutiveFailures: null,
};
const configOf = (t: Trigger): TriggerConfig => triggerConfig(t);
const timestamp = (at?: string) =>
  at
    ? new Date(at).toLocaleString(undefined, { timeZoneName: 'short' })
    : 'Never';
const cadence = (
  t:
    | { kind: 'schedule'; timing: ScheduleConfig['timing'] }
    | { kind: 'webhook' }
    | { kind: 'event'; events: EventConfig['events'] },
) =>
  t.kind === 'webhook'
    ? 'Webhook'
    : t.kind === 'event'
      ? `On ${t.events.map((event) => event.replaceAll('_', ' ')).join(', ')}`
      : t.timing.type === 'interval'
        ? `Every ${t.timing.intervalMs / 1000} seconds`
        : `${t.timing.expression} · ${t.timing.timeZone}`;
const state = (t: Pick<Trigger, 'autoPaused' | 'enabled'>) =>
  !t.enabled ? 'Disabled' : t.autoPaused ? 'Automatically paused' : 'Enabled';

export function Schedules({
  workflow,
  tick,
  visible,
  onDirty,
  onPending,
}: {
  workflow: Workflow;
  tick: number;
  visible: boolean;
  onPending?: (pending: boolean) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [search, setSearch] = useSearchParams();
  const selected = search.get('schedule');
  const navigate = useNavigate();
  const [listing, setListing] = useState<Listing>();
  const [inspection, setInspection] = useState<Inspection>();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<
    'new' | 'new_webhook' | 'new_event' | Trigger
  >();
  const [confirm, setConfirm] = useState<'enable' | 'disable' | 'delete'>();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [fireOffset, setFireOffset] = useState(0);
  const [listOffset, setListOffset] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const refreshGeneration = useRef(0);
  const focusSelection = useRef(false);
  useEffect(() => {
    setEditing(undefined);
    setConfirm(undefined);
  }, [selected, visible]);
  const select = (id: string) => {
    focusSelection.current = true;
    setFireOffset(0);
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      next.set('schedule', id);
      return next;
    });
  };
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const [list, detail] = await Promise.allSettled([
      api.triggers.list.query({
        workflowId: workflow.id,
        offset: listOffset,
        limit: 20,
      }),
      selected
        ? api.triggers.inspect.query({ id: selected, offset: fireOffset })
        : Promise.resolve(undefined),
    ]);
    if (generation !== refreshGeneration.current) return;
    if (list.status === 'fulfilled') setListing(list.value);
    if (detail.status === 'fulfilled') {
      if (detail.value && detail.value.trigger.workflowId !== workflow.id) {
        setInspection(undefined);
        throw new Error('Trigger belongs to another workflow');
      }
      setInspection(detail.value);
    } else setInspection(undefined);
    if (list.status === 'rejected') throw list.reason;
    if (detail.status === 'rejected') throw detail.reason;
    setError('');
  }, [workflow.id, selected, fireOffset, listOffset]);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    void refresh().catch((e) => {
      if (current) setError(errorMessage(e));
    });
    return () => {
      current = false;
    };
  }, [refresh, tick, visible]);
  const trigger =
    inspection?.trigger.id === selected ? inspection.trigger : undefined;
  useEffect(() => {
    if (trigger && focusSelection.current) {
      focusSelection.current = false;
      if (window.innerWidth < 1100) {
        heading.current?.focus();
        heading.current?.scrollIntoView({ block: 'start' });
      }
    }
  }, [trigger?.id]);
  const mutate = async (request: ScheduleMutation) => {
    if (inFlight.current) return;
    inFlight.current = true;
    onPending?.(true);
    setPending(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.triggers.manage.mutate(request);
      flushSync(() => {
        onDirty(false);
        onPending?.(false);
        setEditing(undefined);
        setConfirm(undefined);
      });
      const kind = 'config' in request ? request.config.kind : trigger?.kind;
      const noun =
        kind === 'webhook'
          ? 'Webhook'
          : kind === 'event'
            ? 'Event trigger'
            : 'Schedule';
      setSuccess(
        request.action === 'delete'
          ? `${noun} deleted. Existing runs remain.`
          : request.action === 'create'
            ? `${noun} created disabled.`
            : `${noun} ${request.action === 'update' ? 'saved' : request.action === 'enable' ? 'enabled' : 'disabled'}.`,
      );
      if (result.trigger) {
        const saved = result.trigger;
        if (request.action === 'create') {
          select(saved.id);
          return;
        }
      } else {
        setInspection(undefined);
        setListing((previous) =>
          previous
            ? {
                ...previous,
                total: Math.max(0, previous.total - 1),
                items: previous.items.filter(
                  (t) => t.id !== ('id' in request ? request.id : undefined),
                ),
              }
            : previous,
        );
        setSearch((previous) => {
          const next = new URLSearchParams(previous);
          next.delete('schedule');
          return next;
        });
        return;
      }
      try {
        await refresh();
      } catch (e) {
        setError(`Change saved. Inspection may be stale. ${errorMessage(e)}`);
      }
    } catch (e) {
      throw e;
    } finally {
      inFlight.current = false;
      onPending?.(false);
      setPending(false);
    }
  };
  return (
    <section className={styles.page} aria-label="Workflow triggers">
      <div className={styles.heading}>
        <h2>
          Triggers
          {listing && (
            <Text span size="sm" c="dimmed">
              {' '}
              {listing.total}
            </Text>
          )}
        </h2>
        <Group>
          <Button
            variant="default"
            leftSection={<Plus size={15} />}
            onClick={() => setEditing('new')}
          >
            Add schedule
          </Button>
          <Button
            leftSection={<Plus size={15} />}
            onClick={() => setEditing('new_webhook')}
          >
            Add webhook
          </Button>
          <Button
            variant="default"
            leftSection={<Plus size={15} />}
            onClick={() => setEditing('new_event')}
          >
            Add event trigger
          </Button>
        </Group>
      </div>
      <Text size="xs" c="dimmed" mb="lg">
        {workflow.latestVersion
          ? `Run-start triggers use the latest published version, currently v${workflow.latestVersion}. Draft edits do not affect active runs.`
          : 'Publish this workflow before enabling a trigger. You can save disabled configurations now.'}
      </Text>
      {success && (
        <Alert mb="md" role="status" color="green">
          {success}
        </Alert>
      )}
      {error && (
        <Alert mb="md" color="red" role="alert">
          {error}
          <Button
            variant="subtle"
            onClick={() =>
              void refresh().catch((e) => setError(errorMessage(e)))
            }
          >
            Retry refresh
          </Button>
        </Alert>
      )}
      {!listing ? (
        !error && <Text role="status">Loading triggers…</Text>
      ) : listing.total === 0 ? (
        <Text size="sm">
          No triggers. Add a schedule, webhook or lifecycle event trigger.
        </Text>
      ) : (
        <div className={styles.grid}>
          <nav className={styles.list} aria-label="Triggers">
            {listing.items.map((t) => (
              <button
                key={t.id}
                className={styles.item}
                aria-current={selected === t.id}
                onClick={() => select(t.id)}
              >
                <Group justify="space-between">
                  <strong>{t.name}</strong>
                  <Badge
                    size="xs"
                    variant="light"
                    color={t.autoPaused ? 'red' : t.enabled ? 'green' : 'gray'}
                  >
                    {state(t)}
                  </Badge>
                </Group>
                <Text size="xs">{cadence(t)}</Text>
                <small>
                  {t.autoPaused
                    ? t.autoPaused.reason
                    : t.kind === 'schedule'
                      ? `Next slot ${timestamp(t.nextFireAt)}`
                      : t.kind === 'webhook'
                        ? `POST /hooks/${t.id}`
                        : t.scope.type === 'library'
                          ? 'Library-wide'
                          : `Source ${t.scope.workflowId}${t.scope.includeChildren ? ' and owned children' : ''}`}
                </small>
              </button>
            ))}
            {listOffset > 0 && (
              <Button
                variant="subtle"
                onClick={() => setListOffset((n) => Math.max(0, n - 20))}
              >
                Previous triggers
              </Button>
            )}
            {listing.nextOffset !== null && (
              <Button
                variant="subtle"
                onClick={() => setListOffset(listing.nextOffset!)}
              >
                More triggers
              </Button>
            )}
          </nav>
          <article className={styles.detail}>
            {!trigger ? (
              <h3 ref={heading} tabIndex={-1}>
                {selected
                  ? error
                    ? 'Trigger unavailable'
                    : 'Loading trigger…'
                  : 'Select a trigger'}
              </h3>
            ) : (
              <>
                <Group justify="space-between" align="flex-start">
                  <div>
                    <h3 ref={heading} tabIndex={-1}>
                      {trigger.name}
                    </h3>
                    <code>{trigger.id}</code>
                  </div>
                  <Button
                    variant="default"
                    leftSection={<Pencil size={14} />}
                    onClick={() => setEditing(trigger)}
                  >
                    Edit {trigger.kind}
                  </Button>
                </Group>
                <Text size="sm" mt="sm">
                  {cadence(trigger)} · {state(trigger)}
                </Text>
                {trigger.autoPaused && (
                  <Alert color="red" mt="md">
                    {trigger.autoPaused.reason}. Review recent outcomes, then
                    re-enable this {trigger.kind}.
                  </Alert>
                )}
                {trigger.enabled && trigger.excessiveLag && (
                  <Alert color="yellow" mt="md">
                    Schedule lag is {Math.floor(trigger.lagMs / 1000)} seconds,
                    above the 60-second threshold. This alert does not disable
                    the schedule.
                  </Alert>
                )}
                {trigger.holdCount > 0 && (
                  <Alert mt="md" color="yellow">
                    {trigger.holdCount} named pause{' '}
                    {trigger.holdCount === 1 ? 'hold blocks' : 'holds block'}{' '}
                    {trigger.kind === 'webhook' &&
                    trigger.action.type === 'input'
                      ? 'acceptance. Pending input submissions remain allowed.'
                      : 'trigger actions.'}{' '}
                    Enabling this {trigger.kind} does not release them.
                    {trigger.holds.map((h) => (
                      <Text size="xs" key={h.id}>
                        {h.actor}: {h.reason} · {h.id}
                      </Text>
                    ))}
                  </Alert>
                )}
                {trigger.kind === 'webhook' ? (
                  <Stack gap="sm" my="lg">
                    <Text size="sm">
                      <code>POST /hooks/{trigger.id}</code>
                    </Text>
                    <Text size="sm">
                      {trigger.deliveryCount} deliveries ·{' '}
                      {trigger.ignoredCount} ignored · {trigger.rejectedCount}{' '}
                      rejected
                    </Text>
                    <Text size="sm">
                      Up to {trigger.maxBodyBytes} bytes ·{' '}
                      {trigger.rateLimit.maxRequests} requests per{' '}
                      {trigger.rateLimit.windowMs / 1000} seconds
                    </Text>
                    <Text size="sm">
                      Secret variable:{' '}
                      <code>{trigger.authentication.secretId}</code>
                    </Text>
                    <Text size="sm">
                      Consecutive failures: {trigger.consecutiveFailures}
                      {trigger.pauseAfterConsecutiveFailures
                        ? ` / ${trigger.pauseAfterConsecutiveFailures} before pause`
                        : ''}
                    </Text>
                    <details className={styles.disclosure}>
                      <summary>Authentication and mappings</summary>
                      <pre>{JSON.stringify(configOf(trigger), null, 2)}</pre>
                    </details>
                  </Stack>
                ) : trigger.kind === 'event' ? (
                  <dl className={styles.policies}>
                    <dt>Source</dt>
                    <dd>
                      {trigger.scope.type === 'library' ? (
                        'Library-wide'
                      ) : (
                        <>
                          <Link to={paths.workflow(trigger.scope.workflowId)}>
                            {trigger.scope.workflowId}
                          </Link>
                          {trigger.scope.includeChildren
                            ? ' and owned children'
                            : ''}
                        </>
                      )}
                    </dd>
                    {trigger.exitNodeId && (
                      <>
                        <dt>Completed Exit</dt>
                        <dd>
                          <code>{trigger.exitNodeId}</code>
                        </dd>
                      </>
                    )}
                    <dt>Before dispatch</dt>
                    <dd>
                      {trigger.waitForQuiescence
                        ? 'Wait for the source tree to stop'
                        : 'Dispatch on transition'}
                    </dd>
                    <dt>Maximum trigger depth</dt>
                    <dd>{trigger.maxTriggerDepth}</dd>
                    <dt>Last dispatch</dt>
                    <dd>{timestamp(trigger.lastFireAt)}</dd>
                    <dt>Consecutive failures</dt>
                    <dd>
                      {trigger.consecutiveFailures}
                      {trigger.pauseAfterConsecutiveFailures
                        ? ` / ${trigger.pauseAfterConsecutiveFailures} before pause`
                        : ' · automatic pause off'}
                    </dd>
                  </dl>
                ) : (
                  <>
                    <dl className={styles.metrics}>
                      <div>
                        <dt>Last fire</dt>
                        <dd>{timestamp(trigger.lastFireAt)}</dd>
                      </div>
                      <div>
                        <dt>Next slot</dt>
                        <dd>
                          {timestamp(trigger.nextFireAt)}
                          {(!trigger.enabled || trigger.autoPaused) && (
                            <Text size="xs" c="dimmed">
                              No starts while{' '}
                              {trigger.autoPaused
                                ? 'automatically paused'
                                : 'disabled'}
                            </Text>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Fire lag</dt>
                        <dd>
                          {trigger.lastLagMs === undefined &&
                          trigger.lagMs === 0
                            ? 'Not measured'
                            : `${Math.floor(trigger.lagMs / 1000)} seconds`}
                        </dd>
                      </div>
                      <div>
                        <dt>Consecutive failures</dt>
                        <dd>
                          {trigger.consecutiveFailures}
                          {trigger.pauseAfterConsecutiveFailures
                            ? ` / ${trigger.pauseAfterConsecutiveFailures} before pause`
                            : ' · automatic pause off'}
                        </dd>
                      </div>
                    </dl>
                    <Text fw={600} size="sm">
                      Policies
                    </Text>
                    <dl className={styles.policies}>
                      <dt>Overlapping runs</dt>
                      <dd>
                        {trigger.overlapPolicy === 'skip'
                          ? 'Skip this fire'
                          : trigger.overlapPolicy === 'queue'
                            ? 'Queue at most one run'
                            : 'Allow another run'}
                      </dd>
                      <dt>Missed fires</dt>
                      <dd>
                        {trigger.missedFirePolicy === 'skip'
                          ? 'Skip to the next slot'
                          : 'Run once, then continue'}
                      </dd>
                    </dl>
                    <details className={styles.disclosure}>
                      <summary>Run input and bindings</summary>
                      <pre>
                        {JSON.stringify(
                          { input: trigger.input, bindings: trigger.bindings },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </>
                )}
                <Group mb="lg">
                  <Button
                    variant={
                      trigger.enabled && !trigger.autoPaused
                        ? 'default'
                        : 'filled'
                    }
                    disabled={!trigger.canEnable && !trigger.enabled}
                    onClick={() =>
                      setConfirm(
                        trigger.enabled && !trigger.autoPaused
                          ? 'disable'
                          : 'enable',
                      )
                    }
                  >
                    {trigger.autoPaused
                      ? `Re-enable ${trigger.kind}`
                      : trigger.enabled
                        ? `Disable ${trigger.kind}`
                        : `Enable ${trigger.kind}`}
                  </Button>
                  {trigger.enabled && trigger.autoPaused && (
                    <Button
                      variant="default"
                      onClick={() => setConfirm('disable')}
                    >
                      Disable {trigger.kind}
                    </Button>
                  )}
                  <Button
                    variant="subtle"
                    color="red"
                    leftSection={<Trash2 size={14} />}
                    onClick={() => setConfirm('delete')}
                  >
                    Delete {trigger.kind}
                  </Button>
                </Group>
                {!trigger.canEnable && (
                  <Text size="xs" c="dimmed" mb="md">
                    Restore the workflow and retain a published version before
                    enabling.
                  </Text>
                )}
                {trigger.kind !== 'schedule' ? (
                  <>
                    <Text fw={600} size="sm">
                      Recent deliveries
                    </Text>
                    <ul className={styles.fires}>
                      {inspection?.deliveries.items.map((d) => (
                        <li className={styles.fire} key={d.id}>
                          <div>
                            <strong>{d.outcome.replaceAll('_', ' ')}</strong>
                            {'receivedAt' in d ? (
                              <>
                                <small>{timestamp(d.receivedAt)}</small>
                                <small>
                                  HTTP {d.status} · {d.code}
                                </small>
                              </>
                            ) : (
                              <>
                                <small>{timestamp(d.occurredAt)}</small>
                                <small>
                                  Event <code>{d.eventId}</code>
                                </small>
                                <Link to={paths.run(d.sourceRunId)}>
                                  Inspect source run
                                </Link>
                                {d.reason && (
                                  <small>{d.reason.replaceAll('_', ' ')}</small>
                                )}
                                {d.error && (
                                  <Text size="xs" c="red">
                                    {d.error}
                                  </Text>
                                )}
                                {d.runStatus && (
                                  <small>Handler {d.runStatus}</small>
                                )}
                              </>
                            )}
                            {d.runId && (
                              <Link to={paths.run(d.runId, workflow.id)}>
                                Inspect run
                              </Link>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {!inspection?.deliveries.total && (
                      <Text size="sm" c="dimmed">
                        No deliveries yet.
                      </Text>
                    )}
                    <Group justify="space-between">
                      {fireOffset > 0 && (
                        <Button
                          variant="subtle"
                          onClick={() =>
                            setFireOffset((n) => Math.max(0, n - 20))
                          }
                        >
                          Newer deliveries
                        </Button>
                      )}
                      {inspection?.deliveries.nextOffset != null && (
                        <Button
                          variant="subtle"
                          onClick={() =>
                            setFireOffset(inspection.deliveries.nextOffset!)
                          }
                        >
                          Older deliveries
                        </Button>
                      )}
                    </Group>
                  </>
                ) : (
                  <>
                    <Text fw={600} size="sm">
                      Recent fires
                    </Text>
                    <Text size="xs" c="dimmed" mt={4}>
                      Started and queued describe admission, not successful
                      completion.
                    </Text>
                    <ul className={styles.fires}>
                      {inspection?.fires.items.map((f) => (
                        <li className={styles.fire} key={f.id}>
                          <div>
                            <strong>{f.outcome.replaceAll('_', ' ')}</strong>
                            <small>Scheduled {timestamp(f.scheduledAt)}</small>
                            <small>
                              Attempted {timestamp(f.firedAt)}
                              {f.admittedAt
                                ? ` · Admitted ${timestamp(f.admittedAt)}`
                                : ''}
                            </small>
                            {f.runStatus && <small>Run {f.runStatus}</small>}
                            {f.error && (
                              <Text size="xs" c="red">
                                {f.error}
                              </Text>
                            )}
                          </div>
                          <div>
                            {f.runId && f.runAvailable ? (
                              <Button
                                variant="subtle"
                                size="xs"
                                onClick={() =>
                                  void navigate(
                                    paths.run(f.runId!, workflow.id),
                                  )
                                }
                              >
                                Inspect run
                              </Button>
                            ) : (
                              <Text size="xs" c="dimmed">
                                {f.runId ? 'Run unavailable' : 'No run'}
                              </Text>
                            )}
                            {f.lagMs !== undefined && (
                              <small>Lag {Math.floor(f.lagMs / 1000)}s</small>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {!inspection?.fires.total && (
                      <Text size="sm" c="dimmed">
                        No fires yet.
                      </Text>
                    )}
                    <Group justify="space-between">
                      {fireOffset > 0 && (
                        <Button
                          variant="subtle"
                          onClick={() =>
                            setFireOffset((n) => Math.max(0, n - 20))
                          }
                        >
                          Newer fires
                        </Button>
                      )}
                      {inspection?.fires.nextOffset !== null &&
                        inspection?.fires.nextOffset !== undefined && (
                          <Button
                            variant="subtle"
                            onClick={() =>
                              setFireOffset(inspection.fires.nextOffset!)
                            }
                          >
                            Older fires
                          </Button>
                        )}
                    </Group>
                  </>
                )}
              </>
            )}
          </article>
        </div>
      )}
      {visible &&
        editing &&
        (editing === 'new_event' ||
        (typeof editing === 'object' && editing.kind === 'event') ? (
          <EventEditor
            key={typeof editing === 'string' ? editing : editing.id}
            initial={
              typeof editing === 'string'
                ? eventConfigSchema.parse({
                    kind: 'event',
                    name: 'Event trigger',
                    events: ['completed'],
                    scope: { type: 'workflow', workflowId: workflow.id },
                  })
                : eventConfigSchema.parse(configOf(editing))
            }
            pending={pending}
            onDirty={onDirty}
            onClose={() => setEditing(undefined)}
            onSave={(config) =>
              mutate(
                typeof editing === 'string'
                  ? { action: 'create', workflowId: workflow.id, config }
                  : {
                      action: 'update',
                      id: editing.id,
                      expectedRevision: editing.revision,
                      config,
                    },
              )
            }
            onReload={
              typeof editing === 'string'
                ? undefined
                : async () => {
                    const current = await api.triggers.inspect.query({
                      id: editing.id,
                    });
                    setEditing(current.trigger);
                    return eventConfigSchema.parse(configOf(current.trigger));
                  }
            }
          />
        ) : editing === 'new_webhook' ||
          (typeof editing === 'object' && editing.kind === 'webhook') ? (
          <WebhookEditor
            key={typeof editing === 'string' ? editing : editing.id}
            initial={
              typeof editing === 'string'
                ? initialWebhook
                : webhookConfigSchema.parse(configOf(editing))
            }
            pending={pending}
            onDirty={onDirty}
            onClose={() => setEditing(undefined)}
            onSave={(config) =>
              mutate(
                typeof editing === 'string'
                  ? { action: 'create', workflowId: workflow.id, config }
                  : {
                      action: 'update',
                      id: editing.id,
                      expectedRevision: editing.revision,
                      config,
                    },
              )
            }
            onReload={
              typeof editing === 'string'
                ? undefined
                : async () => {
                    const current = await api.triggers.inspect.query({
                      id: editing.id,
                    });
                    setEditing(current.trigger);
                    return webhookConfigSchema.parse(configOf(current.trigger));
                  }
            }
          />
        ) : (
          <ScheduleEditor
            key={typeof editing === 'string' ? editing : editing.id}
            initial={
              typeof editing === 'string'
                ? initialConfig
                : scheduleConfigSchema.parse(configOf(editing))
            }
            pending={pending}
            onDirty={onDirty}
            onClose={() => setEditing(undefined)}
            onReload={
              typeof editing === 'string'
                ? undefined
                : async () => {
                    const current = await api.triggers.inspect.query({
                      id: editing.id,
                    });
                    setEditing(current.trigger);
                    return scheduleConfigSchema.parse(
                      configOf(current.trigger),
                    );
                  }
            }
            onSave={(config) =>
              mutate(
                typeof editing === 'string'
                  ? { action: 'create', workflowId: workflow.id, config }
                  : {
                      action: 'update',
                      id: editing.id,
                      expectedRevision: editing.revision,
                      config,
                    },
              )
            }
          />
        ))}
      {visible && confirm && trigger && (
        <Modal
          title={`${confirm === 'enable' && trigger.autoPaused ? 'Re-enable' : confirm[0].toUpperCase() + confirm.slice(1)} ${trigger.kind}`}
          busy={pending}
          onClose={() => {
            setConfirm(undefined);
            setError('');
          }}
        >
          <ModalBody>
            <Text size="sm">{trigger.name}</Text>
            <Text size="xs" c="dimmed">
              {trigger.id}
            </Text>
            <Text size="sm" mt="md">
              {confirm === 'delete'
                ? `Delete this ${trigger.kind} and its ${trigger.kind === 'schedule' ? 'fire' : 'delivery'} history. Existing runs remain.`
                : confirm === 'disable'
                  ? `Stop future ${trigger.kind === 'schedule' ? 'fires' : 'deliveries'}. Existing active and queued runs remain.`
                  : trigger.kind === 'event'
                    ? 'Observe future matching run transitions. Pending deliveries honor named pause holds and quiescence.'
                    : trigger.kind === 'webhook'
                      ? 'Accept authenticated deliveries. Named pause holds still apply.'
                      : `${trigger.missedFirePolicy === 'run_once' ? 'Enabling can immediately attempt the latest missed slot once.' : 'Missed slots are skipped until the next future slot.'} Named pause holds still apply.`}
            </Text>
            {error && (
              <Text role="alert" c="red" mt="md">
                {error}
              </Text>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="default"
              disabled={pending}
              onClick={() => setConfirm(undefined)}
            >
              Cancel
            </Button>
            <Button
              color={confirm === 'delete' ? 'red' : undefined}
              loading={pending}
              onClick={() =>
                void mutate({
                  action: confirm,
                  id: trigger.id,
                  expectedRevision: trigger.revision,
                }).catch((e) => setError(errorMessage(e)))
              }
            >
              {confirm === 'delete'
                ? `Delete ${trigger.kind}`
                : confirm === 'disable'
                  ? `Disable ${trigger.kind}`
                  : trigger.autoPaused
                    ? `Re-enable ${trigger.kind}`
                    : `Enable ${trigger.kind}`}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </section>
  );
}

const eventOptions = [
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'stalled', label: 'Stalled' },
];
function EventEditor({
  initial,
  pending,
  onClose,
  onSave,
  onDirty,
  onReload,
}: {
  initial: EventConfig;
  pending: boolean;
  onClose: () => void;
  onSave: (config: EventConfig) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onReload?: () => Promise<EventConfig>;
}) {
  const [config, setConfig] = useState(initial);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(config) !== JSON.stringify(initial);
  const completedOnly =
    config.events.length === 1 && config.events[0] === 'completed';
  const terminalOnly = config.events.every((event) =>
    ['completed', 'failed', 'cancelled'].includes(event),
  );
  useBeforeUnloadWarning(dirty);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const field = <K extends keyof EventConfig>(
    key: K,
    value: EventConfig[K],
  ) => {
    setConfig((current) => ({
      ...current,
      [key]: value,
      ...(key === 'scope' && (value as EventConfig['scope']).type === 'library'
        ? { exitNodeId: undefined }
        : {}),
    }));
    setIssues({});
    setError('');
  };
  const submit = () => {
    const parsed = eventConfigSchema.safeParse(config);
    if (!parsed.success) {
      setIssues(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join('.'),
            issue.message,
          ]),
        ),
      );
      return;
    }
    void onSave(parsed.data).catch((e) => setError(errorMessage(e)));
  };
  return (
    <Modal
      title="Event trigger configuration"
      size={650}
      height={720}
      busy={pending}
      onClose={onClose}
    >
      <ModalBody>
        <fieldset
          disabled={pending}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <Stack gap="lg">
            <TextInput
              label="Trigger name"
              value={config.name}
              error={issues.name}
              onChange={(e) => field('name', e.target.value)}
            />
            <Select
              label="Source scope"
              allowDeselect={false}
              value={
                config.scope.type === 'library'
                  ? 'library'
                  : config.scope.includeChildren
                    ? 'children'
                    : 'workflow'
              }
              data={[
                { value: 'workflow', label: 'One workflow' },
                { value: 'children', label: 'Workflow and owned children' },
                { value: 'library', label: 'Entire library' },
              ]}
              onChange={(value) =>
                field(
                  'scope',
                  value === 'library'
                    ? { type: 'library' }
                    : {
                        type: 'workflow',
                        workflowId:
                          config.scope.type === 'workflow'
                            ? config.scope.workflowId
                            : '',
                        includeChildren: value === 'children',
                      },
                )
              }
            />
            {config.scope.type === 'workflow' && (
              <TextInput
                label="Source workflow ID"
                value={config.scope.workflowId}
                error={issues['scope.workflowId']}
                onChange={(e) =>
                  field('scope', {
                    type: 'workflow',
                    workflowId: e.target.value,
                    includeChildren:
                      config.scope.type === 'workflow' &&
                      config.scope.includeChildren,
                  })
                }
              />
            )}
            <MultiSelect
              label="Run transitions"
              data={eventOptions}
              value={config.events}
              error={issues.events}
              onChange={(values) => {
                const events = values as EventConfig['events'];
                setConfig((current) => ({
                  ...current,
                  events,
                  waitForQuiescence:
                    events.every((event) =>
                      ['completed', 'failed', 'cancelled'].includes(event),
                    ) && current.waitForQuiescence,
                  exitNodeId:
                    events.length === 1 && events[0] === 'completed'
                      ? current.exitNodeId
                      : undefined,
                }));
                setIssues({});
              }}
            />
            {completedOnly && config.scope.type === 'workflow' && (
              <TextInput
                label="Completed Exit node ID"
                description="Optional. Match completion through this Exit node only."
                value={config.exitNodeId ?? ''}
                error={issues.exitNodeId}
                onChange={(e) =>
                  field('exitNodeId', e.target.value || undefined)
                }
              />
            )}
            <Checkbox
              label="Wait for the source tree to stop"
              description={
                terminalOnly
                  ? 'Includes detached descendants, Scripts and uncertain claims. Reconcile uncertain work before teardown.'
                  : 'Available when all selected transitions are completed, failed or cancelled.'
              }
              checked={config.waitForQuiescence}
              disabled={!terminalOnly}
              onChange={(e) => field('waitForQuiescence', e.target.checked)}
            />
            <NumberInput
              label="Maximum trigger depth"
              description="A trigger already in the causal chain is always suppressed."
              value={config.maxTriggerDepth}
              min={1}
              max={20}
              allowDecimal={false}
              error={issues.maxTriggerDepth}
              onChange={(value) => field('maxTriggerDepth', Number(value))}
            />
            <div>
              <Checkbox
                label="Pause after consecutive failures"
                checked={config.pauseAfterConsecutiveFailures !== null}
                onChange={(e) =>
                  field(
                    'pauseAfterConsecutiveFailures',
                    e.target.checked ? 3 : null,
                  )
                }
              />
              {config.pauseAfterConsecutiveFailures !== null && (
                <NumberInput
                  mt="sm"
                  label="Consecutive failures before pause"
                  min={1}
                  max={10000}
                  allowDecimal={false}
                  value={config.pauseAfterConsecutiveFailures}
                  error={issues.pauseAfterConsecutiveFailures}
                  onChange={(value) =>
                    field('pauseAfterConsecutiveFailures', Number(value))
                  }
                />
              )}
            </div>
          </Stack>
        </fieldset>
        {error && (
          <Alert role="alert" color="red" mt="md">
            {error}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        {onReload && (
          <Button
            variant="subtle"
            disabled={pending}
            onClick={() => {
              if (
                dirty &&
                !window.confirm('Discard event trigger edits and reload?')
              )
                return;
              void onReload()
                .then((current) => {
                  setConfig(current);
                  setIssues({});
                  setError('');
                })
                .catch((e) => setError(errorMessage(e)));
            }}
          >
            Reload current
          </Button>
        )}
        <Button variant="default" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button loading={pending} onClick={submit}>
          Save event trigger
        </Button>
      </ModalFooter>
    </Modal>
  );
}

const initialWebhook: WebhookConfig = webhookConfigSchema.parse({
  kind: 'webhook',
  name: 'Webhook',
  authentication: {
    secretId: 'replace-with-secret-variable-id',
    header: 'x-signature',
    algorithm: 'sha256',
    prefix: 'sha256=',
    parts: [{ source: 'body' }],
  },
  deliveryId: { source: 'body', path: 'deliveryId' },
  timestamp: { source: 'body', path: 'timestamp' },
  action: {
    type: 'start',
    input: {},
    bindings: { event: { source: 'body', path: '' } },
  },
});
function WebhookEditor({
  initial,
  pending,
  onClose,
  onSave,
  onDirty,
  onReload,
}: {
  initial: WebhookConfig;
  pending: boolean;
  onClose: () => void;
  onSave: (config: WebhookConfig) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onReload?: () => Promise<WebhookConfig>;
}) {
  const [config, setConfig] = useState(initial);
  const [valid, setValid] = useState(true);
  const [error, setError] = useState('');
  const [reset, setReset] = useState(0);
  const dirty = !valid || JSON.stringify(config) !== JSON.stringify(initial);
  useBeforeUnloadWarning(dirty);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const validate = (value: unknown) => {
    const parsed = webhookConfigSchema.safeParse(value);
    return parsed.success
      ? undefined
      : parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
  };
  return (
    <Modal
      title="Webhook configuration"
      size={760}
      height={720}
      busy={pending}
      onClose={onClose}
    >
      <ModalBody>
        <Text size="sm" mb="md">
          Select a Secret variable ID for authentication. Sign the exact raw
          body and every referenced header, including delivery ID and timestamp.
          Input delivery submits a pending revision for explicit acceptance.
        </Text>
        <fieldset
          disabled={pending}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <JsonEditor
            key={reset}
            label="Webhook JSON"
            value={config}
            rows={20}
            validate={validate}
            onChange={(value) => setConfig(value)}
            onValidityChange={setValid}
          />
        </fieldset>
        {error && (
          <Alert role="alert" color="red">
            {error}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        {onReload && (
          <Button
            variant="subtle"
            disabled={pending}
            onClick={() => {
              if (dirty && !window.confirm('Discard webhook edits and reload?'))
                return;
              void onReload()
                .then((c) => {
                  setConfig(c);
                  setValid(true);
                  setReset((n) => n + 1);
                  setError('');
                })
                .catch((e) => setError(errorMessage(e)));
            }}
          >
            Reload current
          </Button>
        )}
        <Button variant="default" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          loading={pending}
          disabled={!valid}
          onClick={() => {
            const parsed = webhookConfigSchema.safeParse(config);
            if (!parsed.success) {
              setError(validate(config) ?? 'Invalid configuration');
              return;
            }
            void onSave(parsed.data).catch((e) => setError(errorMessage(e)));
          }}
        >
          Save webhook
        </Button>
      </ModalFooter>
    </Modal>
  );
}

type Section = 'timing' | 'input' | 'policies';
function ScheduleEditor({
  initial,
  pending,
  onClose,
  onSave,
  onDirty,
  onReload,
}: {
  initial: ScheduleConfig;
  pending: boolean;
  onClose: () => void;
  onSave: (config: ScheduleConfig) => Promise<void>;
  onReload?: () => Promise<ScheduleConfig>;
  onDirty: (dirty: boolean) => void;
}) {
  const [config, setConfig] = useState(initial);
  const [section, setSection] = useState<Section>('timing');
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [jsonValid, setJsonValid] = useState(true);
  const [jsonReset, setJsonReset] = useState(0);
  const dirty =
    JSON.stringify(config) !== JSON.stringify(initial) || !jsonValid;
  useBeforeUnloadWarning(dirty);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const [unit, setUnit] = useState('seconds');
  const [upcoming, setUpcoming] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState('');
  const previewKey = JSON.stringify(config.timing);
  useEffect(() => {
    let current = true;
    setUpcoming([]);
    setPreviewError('');
    const timer = setTimeout(() => {
      void api.triggers.preview
        .query({ timing: config.timing })
        .then((p) => {
          if (current) setUpcoming(p.upcoming);
        })
        .catch((e) => {
          if (current) setPreviewError(errorMessage(e));
        });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [previewKey]);
  const field = <K extends keyof ScheduleConfig>(
    key: K,
    value: ScheduleConfig[K],
  ) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setIssues((previous) => {
      const next = { ...previous };
      for (const path of Object.keys(next))
        if (path === key || path.startsWith(`${key}.`)) delete next[path];
      return next;
    });
    setError('');
  };
  const submit = async () => {
    setError('');
    const parsed = scheduleConfigSchema.safeParse(config);
    if (!jsonValid) {
      setSection('input');
      setError('Enter valid JSON before saving.');
      return;
    }
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        errors[issue.path.length ? issue.path.join('.') : 'input'] =
          issue.message;
      setIssues(errors);
      setSection(
        Object.keys(errors).some(
          (path) =>
            path === 'name' || path === 'timing' || path.startsWith('timing.'),
        )
          ? 'timing'
          : errors.input || errors.bindings
            ? 'input'
            : 'policies',
      );
      return;
    }
    setIssues({});
    try {
      await onSave(parsed.data);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal
      title={initial.name ? 'Edit schedule' : 'Add schedule'}
      size={700}
      height={690}
      busy={pending}
      onClose={onClose}
    >
      <ModalBody>
        <fieldset
          disabled={pending}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <nav className={styles.sections} aria-label="Schedule settings">
            {(['timing', 'input', 'policies'] as const).map((s) => (
              <Button
                key={s}
                variant={section === s ? 'light' : 'subtle'}
                aria-current={section === s}
                onClick={() => setSection(s)}
              >
                {s === 'timing'
                  ? 'Timing'
                  : s === 'input'
                    ? 'Run input'
                    : 'Policies'}
                {(s === 'timing' &&
                  (issues.name ||
                    Object.keys(issues).some(
                      (path) => path === 'timing' || path.startsWith('timing.'),
                    ))) ||
                (s === 'input' && (issues.input || issues.bindings)) ||
                (s === 'policies' && issues.pauseAfterConsecutiveFailures)
                  ? ' · Error'
                  : ''}
              </Button>
            ))}
          </nav>
          {section === 'timing' && (
            <Stack gap="md">
              <TextInput
                label="Schedule name"
                value={config.name}
                error={issues.name}
                onChange={(e) => field('name', e.target.value)}
                autoFocus
              />
              <Radio.Group
                label="Timing"
                value={config.timing.type}
                onChange={(type) =>
                  field(
                    'timing',
                    type === 'interval'
                      ? { type: 'interval', intervalMs: 120000 }
                      : {
                          type: 'cron',
                          expression: '*/2 * * * *',
                          timeZone:
                            Intl.DateTimeFormat().resolvedOptions().timeZone,
                        },
                  )
                }
              >
                <Group mt="xs">
                  <Radio value="interval" label="Fixed interval" />
                  <Radio value="cron" label="Cron" />
                </Group>
              </Radio.Group>
              {config.timing.type === 'interval' ? (
                <Group align="flex-start" grow>
                  <NumberInput
                    label="Every"
                    value={
                      config.timing.intervalMs /
                      (unit === 'hours'
                        ? 3600000
                        : unit === 'minutes'
                          ? 60000
                          : 1000)
                    }
                    min={unit === 'seconds' ? 30 : undefined}
                    error={issues['timing.intervalMs'] || issues.timing}
                    onChange={(value) =>
                      field('timing', {
                        type: 'interval',
                        intervalMs:
                          Number(value) *
                          (unit === 'hours'
                            ? 3600000
                            : unit === 'minutes'
                              ? 60000
                              : 1000),
                      })
                    }
                  />
                  <Select
                    label="Unit"
                    value={unit}
                    data={['seconds', 'minutes', 'hours']}
                    onChange={(v) => setUnit(v ?? 'seconds')}
                    allowDeselect={false}
                  />
                </Group>
              ) : (
                <>
                  <TextInput
                    label="Cron expression"
                    description="Exactly five fields: minute hour day month weekday"
                    value={config.timing.expression}
                    error={issues['timing.expression'] || issues.timing}
                    onChange={(e) =>
                      field('timing', {
                        ...(config.timing as Extract<
                          ScheduleConfig['timing'],
                          { type: 'cron' }
                        >),
                        expression: e.target.value,
                      })
                    }
                  />
                  <TextInput
                    label="IANA time zone"
                    error={issues['timing.timeZone']}
                    value={config.timing.timeZone}
                    onChange={(e) =>
                      field('timing', {
                        ...(config.timing as Extract<
                          ScheduleConfig['timing'],
                          { type: 'cron' }
                        >),
                        timeZone: e.target.value,
                      })
                    }
                  />
                </>
              )}
              <Text size="xs" c="dimmed">
                Minimum interval: 30 seconds. Timing changes reset the slot
                anchor.
              </Text>
              <div>
                <Text size="sm" fw={600}>
                  Next three times
                </Text>
                {previewError ? (
                  <Text size="xs" c="red">
                    {previewError}
                  </Text>
                ) : (
                  upcoming.map((at) => (
                    <Text size="xs" key={at}>
                      {config.timing.type === 'cron'
                        ? new Date(at).toLocaleString(undefined, {
                            timeZone: config.timing.timeZone,
                            timeZoneName: 'short',
                          })
                        : timestamp(at)}
                    </Text>
                  ))
                )}
                <Text size="xs" c="dimmed" mt="xs">
                  Server calculation for these timing settings. Runtime
                  inspection shows the persisted next slot.
                </Text>
              </div>
            </Stack>
          )}
          <div hidden={section !== 'input'}>
            <JsonEditor
              key={jsonReset}
              label="JSON input template"
              value={config.input}
              onChange={(input) => field('input', input)}
              onValidityChange={setJsonValid}
            />
            {issues.input && (
              <Text c="red" size="xs">
                {issues.input}
              </Text>
            )}
            <Text size="xs" c="dimmed" mb="md">
              A bound value replaces the template value at its destination path.
              previousRunId is null before this schedule starts a run.
            </Text>
            {(
              ['scheduledAt', 'firedAt', 'triggerId', 'previousRunId'] as const
            ).map((key) => (
              <div key={key} className={styles.binding}>
                <Checkbox
                  label={key}
                  checked={config.bindings[key] !== undefined}
                  onChange={(e) => {
                    const next = { ...config.bindings };
                    if (e.target.checked) next[key] = `schedule.${key}`;
                    else delete next[key];
                    field('bindings', next);
                  }}
                />
                <TextInput
                  aria-label={`${key} destination path`}
                  placeholder="Destination path"
                  disabled={config.bindings[key] === undefined}
                  value={config.bindings[key] ?? ''}
                  onChange={(e) =>
                    field('bindings', {
                      ...config.bindings,
                      [key]: e.target.value,
                    })
                  }
                />
              </div>
            ))}
            {issues.bindings && (
              <Text c="red" size="xs">
                {issues.bindings}
              </Text>
            )}
          </div>
          {section === 'policies' && (
            <Stack gap="xl">
              <Radio.Group
                label="When a previous run is active or queued"
                value={config.overlapPolicy}
                onChange={(v) =>
                  field('overlapPolicy', v as ScheduleConfig['overlapPolicy'])
                }
              >
                <Stack mt="sm">
                  <Radio
                    value="skip"
                    label="Skip this fire"
                    description="Do not add work while any run from this schedule is active or queued."
                  />
                  <Radio
                    value="queue"
                    label="Queue at most one run"
                    description="Wait for prior runs to end, then apply workflow admission limits."
                  />
                  <Radio
                    value="allow"
                    label="Allow another run"
                    description="Workflow admission limits still apply."
                  />
                </Stack>
              </Radio.Group>
              <Radio.Group
                label="Missed fires after downtime or pause"
                value={config.missedFirePolicy}
                onChange={(v) =>
                  field(
                    'missedFirePolicy',
                    v as ScheduleConfig['missedFirePolicy'],
                  )
                }
              >
                <Stack mt="sm">
                  <Radio value="skip" label="Skip to the next slot" />
                  <Radio
                    value="run_once"
                    label="Run once"
                    description="Attempt only the latest missed slot, never a catch-up burst. Enabling can start work immediately."
                  />
                </Stack>
              </Radio.Group>
              <div>
                <Checkbox
                  label="Pause after consecutive failures"
                  checked={config.pauseAfterConsecutiveFailures !== null}
                  onChange={(e) =>
                    field(
                      'pauseAfterConsecutiveFailures',
                      e.target.checked ? 3 : null,
                    )
                  }
                />
                {config.pauseAfterConsecutiveFailures !== null && (
                  <NumberInput
                    mt="sm"
                    label="Consecutive failures before pause"
                    min={1}
                    max={10000}
                    value={config.pauseAfterConsecutiveFailures}
                    error={issues.pauseAfterConsecutiveFailures}
                    onChange={(v) =>
                      field('pauseAfterConsecutiveFailures', Number(v))
                    }
                  />
                )}
                <Text size="xs" c="dimmed" mt="sm">
                  Off by default. A completed scheduled run resets the count.
                  Cancelled runs and skipped fires do not count.
                </Text>
              </div>
            </Stack>
          )}
          {error && (
            <Alert color="red" role="alert" mt="md">
              {error}
              {onReload && error.includes('revision conflict') && (
                <Button
                  variant="subtle"
                  onClick={() =>
                    void onReload()
                      .then((current) => {
                        setConfig(current);
                        setJsonReset((value) => value + 1);
                        setJsonValid(true);
                        setIssues({});
                        setError('');
                      })
                      .catch((e) => setError(errorMessage(e)))
                  }
                >
                  Reload current schedule and discard edits
                </Button>
              )}
            </Alert>
          )}
        </fieldset>
      </ModalBody>
      <ModalFooter>
        <Button variant="default" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button loading={pending} onClick={() => void submit()}>
          {initial.name ? 'Save schedule' : 'Create schedule'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function ScheduleAlerts({
  workflowId,
  tick,
  onCount,
}: {
  workflowId?: string;
  tick: number;
  onCount?: (count: number) => void;
}) {
  const [page, setPage] =
    useState<Awaited<ReturnType<typeof api.triggers.attention.query>>>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void api.triggers.attention
      .query({ workflowId, offset })
      .then((result) => {
        if (current) {
          if (offset > 0 && offset >= result.total) {
            setOffset(Math.max(0, Math.floor((result.total - 1) / 20) * 20));
            return;
          }
          setPage(result);
          setError('');
          onCount?.(result.total);
        }
      })
      .catch((e) => {
        if (current) setError(errorMessage(e));
      });
    return () => {
      current = false;
    };
  }, [workflowId, offset, onCount, tick]);
  if (error)
    return (
      <Text role="alert" c="red">
        Could not load trigger alerts. {error}
      </Text>
    );
  if (!page?.total) return null;
  return (
    <section aria-label="Trigger alerts">
      <Text fw={600} size="sm" mb="sm">
        Trigger alerts · {page.total}
      </Text>
      {page.items.map((item) => (
        <Alert
          key={item.triggerId}
          color={item.kind === 'automatic_pause' ? 'red' : 'yellow'}
          mb="md"
          title={item.name}
        >
          <Text size="sm">{item.reason}</Text>
          <Link to={paths.workflowSchedule(item.workflowId, item.triggerId)}>
            Inspect schedule
          </Link>
        </Alert>
      ))}
      <Group>
        {offset > 0 && (
          <Button
            variant="subtle"
            onClick={() => setOffset((n) => Math.max(0, n - 20))}
          >
            Previous trigger alerts
          </Button>
        )}
        {page.nextOffset !== null && (
          <Button variant="subtle" onClick={() => setOffset(page.nextOffset!)}>
            More trigger alerts
          </Button>
        )}
      </Group>
    </section>
  );
}
