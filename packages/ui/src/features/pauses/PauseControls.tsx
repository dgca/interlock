import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Textarea,
  Select,
  Alert,
  ActionIcon,
} from '@mantine/core';
import { Pause } from 'lucide-react';
import type { PauseHold } from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import { Modal } from '../../components/Modal/Modal';
import { ModalBody, ModalFooter } from '../../components/Modal/ModalLayout';
import styles from './PauseControls.module.css';

type Target = { workflowId?: string; name?: string; add?: boolean };
const Context = createContext({
  enabled: false,
  revision: 0,
  open: (_target: Target) => {},
  changed: () => {},
});
export function PauseProvider({
  children,
  tick = 0,
}: {
  children: ReactNode;
  tick?: number;
}) {
  const [target, setTarget] = useState<Target>();
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision((n) => n + 1), []);
  return (
    <Context.Provider
      value={{
        enabled: true,
        revision: revision + tick,
        open: setTarget,
        changed,
      }}
    >
      {children}
      {target && (
        <PauseDialog target={target} onClose={() => setTarget(undefined)} />
      )}
    </Context.Provider>
  );
}
function useHolds(workflowId?: string, limit = 1, scope?: 'workflow') {
  const { revision, enabled } = useContext(Context);
  const [data, setData] =
    useState<Awaited<ReturnType<typeof api.pauses.list.query>>>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refresh = () => {
      void api.pauses.list.query({ workflowId, limit, scope }).then(
        (d) => {
          if (active) {
            setData(d);
            setError('');
          }
        },
        (e) => {
          if (active) setError(errorMessage(e));
        },
      );
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [workflowId, limit, scope, revision, enabled]);
  return { data, error };
}
export function LibraryPauseBar() {
  const { open, changed } = useContext(Context);
  const { data, error } = useHolds();
  return (
    <div className={styles.bar} data-paused={!!data?.total || undefined}>
      <div className={styles.summary} role="status">
        <Text size="sm" fw={500}>
          {data?.total
            ? `Library paused · ${data.total} hold${data.total === 1 ? '' : 's'}`
            : 'Library execution'}
        </Text>
        {data?.total ? (
          <Text size="xs" className={styles.preview}>
            {data.items[0]?.reason}
          </Text>
        ) : null}
        {error && (
          <Text size="xs" c="yellow">
            Pause status may be out of date
          </Text>
        )}
      </div>
      <Button
        size="xs"
        variant="default"
        leftSection={<Pause size={14} />}
        disabled={!data && !error}
        onClick={() => (!data ? changed() : open({ add: !data?.total }))}
      >
        {data?.total
          ? 'Review holds'
          : data
            ? 'Pause library'
            : error
              ? 'Retry pause status'
              : 'Loading pause status…'}
      </Button>
    </div>
  );
}
export function WorkflowPauseButton({
  workflowId,
  name,
  compact = false,
}: {
  workflowId: string;
  name: string;
  compact?: boolean;
}) {
  const { open } = useContext(Context);
  const { data, error } = useHolds(workflowId);
  const label = data?.total ? `Pauses · ${data.total}` : 'Pause workflow';
  return compact ? (
    <ActionIcon
      variant="default"
      aria-label={label}
      title={error ? 'Pause status may be out of date' : label}
      disabled={!data}
      onClick={() => open({ workflowId, name, add: !data?.total })}
    >
      <Pause size={16} />
    </ActionIcon>
  ) : (
    <Button
      variant="default"
      size="xs"
      leftSection={<Pause size={14} />}
      disabled={!data}
      title={error ? 'Pause status may be out of date' : undefined}
      onClick={() => open({ workflowId, name, add: !data?.total })}
    >
      {label}
    </Button>
  );
}
export function PauseBanner({
  workflowId,
  name,
  run = false,
}: {
  workflowId: string;
  name?: string;
  run?: boolean;
}) {
  const { open } = useContext(Context);
  const { data, error } = useHolds(
    workflowId,
    20,
    run ? undefined : 'workflow',
  );
  const local = data?.items.filter((h) => h.scope === 'workflow') ?? [];
  if (!data?.total || (!run && !local.length && !error)) return null;
  return (
    <div className={styles.banner} role="status">
      <Text size="sm">
        {run
          ? `${data.total} applicable pause hold${data.total === 1 ? '' : 's'}`
          : `Workflow paused · ${data.total} hold${data.total === 1 ? '' : 's'}`}{' '}
        · {(run ? data.items : local).map((h) => h.reason).join('; ')}
        {error ? ' · Status may be out of date' : ''}
      </Text>
      <Button
        variant="subtle"
        size="xs"
        onClick={() => open({ workflowId, name })}
      >
        Review pause holds
      </Button>
    </div>
  );
}
function PauseDialog({
  target,
  onClose,
}: {
  target: Target;
  onClose: () => void;
}) {
  const { changed, revision } = useContext(Context);
  const [items, setItems] = useState<PauseHold[]>([]),
    [total, setTotal] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(!!target.add),
    [scope, setScope] = useState(target.workflowId ? 'workflow' : 'library'),
    [actor, setActor] = useState(''),
    [reason, setReason] = useState('');
  const [selected, setSelected] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stale, setStale] = useState(''),
    [acknowledgement, setAcknowledgement] = useState('');
  const keep = useRef<HTMLButtonElement>(null),
    body = useRef<HTMLDivElement>(null),
    add = useRef<HTMLButtonElement>(null),
    retryRefresh = useRef<HTMLButtonElement>(null),
    focusAfterMutation = useRef(false);
  const load = useCallback(
    async (offset = 0) => {
      const d = await api.pauses.list.query({
        workflowId: target.workflowId,
        offset,
        limit: 20,
      });
      setItems((old) => (offset ? [...old, ...d.items] : d.items));
      setTotal(d.total);
      setNext(d.nextOffset);
      setLoaded(true);
      setStale('');
      return d;
    },
    [target.workflowId],
  );
  useEffect(() => {
    let active = true;
    void api.pauses.list
      .query({ workflowId: target.workflowId, limit: 20 })
      .then(
        (d) => {
          if (active) {
            setItems(d.items);
            setTotal(d.total);
            setNext(d.nextOffset);
            setLoaded(true);
            setStale('');
          }
        },
        (e) => {
          if (active) setStale(errorMessage(e));
        },
      );
    return () => {
      active = false;
    };
  }, [target.workflowId, revision]);
  useEffect(() => {
    if (selected) keep.current?.focus();
  }, [selected]);
  useEffect(() => {
    if (busy || !focusAfterMutation.current) return;
    focusAfterMutation.current = false;
    requestAnimationFrame(() => {
      const nextButton =
        body.current?.querySelector<HTMLButtonElement>('[data-release]');
      (stale ? retryRefresh.current : (nextButton ?? add.current))?.focus();
    });
  }, [busy, stale]);
  const perform = async (action: () => Promise<unknown>, release = false) => {
    setBusy(true);
    setError('');
    setAcknowledgement('');
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
      void load().catch(() =>
        setStale('Could not refresh holds. Retry before releasing.'),
      );
      setBusy(false);
      return;
    }
    // Acknowledged writes stay completed even when their follow-up read fails.
    if (release) setSelected(undefined);
    else {
      setActor('');
      setReason('');
      setAdding(false);
    }
    setAcknowledgement(release ? 'Hold released.' : 'Pause added.');
    changed();
    focusAfterMutation.current = true;
    try {
      await load();
    } catch (e) {
      setStale(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    focusAfterMutation.current = true;
    try {
      await load();
    } catch (e) {
      setStale(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Pause holds" onClose={onClose} size={700} busy={busy}>
      <ModalBody>
        <div ref={body}>
          <Stack gap="lg">
            <Text size="sm" role="status" aria-live="polite">
              {loaded
                ? `${total} applicable hold${total === 1 ? '' : 's'}`
                : 'Loading holds…'}
            </Text>
            {acknowledgement && (
              <Text size="sm" role="status">
                {acknowledgement}
              </Text>
            )}
            {stale && (
              <Alert color="yellow" title="Pause status may be out of date">
                {stale}
                <Button
                  size="xs"
                  variant="subtle"
                  ref={retryRefresh}
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  Retry refresh
                </Button>
              </Alert>
            )}
            {items.map((h) => (
              <section key={h.id} className={styles.hold}>
                <Group justify="space-between" align="start">
                  <div>
                    <Text fw={600} size="sm">
                      {h.scope === 'library'
                        ? 'Entire library'
                        : (target.name ?? 'Workflow')}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {h.actor} · {new Date(h.createdAt).toLocaleString()}
                    </Text>
                  </div>
                  {selected !== h.id && (
                    <Button
                      data-release
                      size="xs"
                      variant="default"
                      disabled={busy || !!stale}
                      onClick={() => {
                        setSelected(h.id);
                        setError('');
                      }}
                    >
                      Release…
                    </Button>
                  )}
                </Group>
                <Text size="sm" className={styles.reason}>
                  {h.reason}
                </Text>
                <Text size="xs" c="dimmed" className={styles.id}>
                  {h.id}
                </Text>
                {selected === h.id && (
                  <div className={styles.confirm}>
                    <Text size="sm">
                      {total > 1
                        ? `${total - 1} other applicable hold${total === 2 ? ' remains' : 's remain'}. Execution stays paused.`
                        : 'No other applicable holds remain. Execution can resume.'}
                    </Text>
                    <Group mt="sm">
                      <Button
                        ref={keep}
                        size="xs"
                        variant="default"
                        disabled={busy}
                        onClick={() => setSelected(undefined)}
                      >
                        Keep hold
                      </Button>
                      <Button
                        size="xs"
                        color="yellow"
                        loading={busy}
                        disabled={!!stale}
                        onClick={() =>
                          void perform(
                            () => api.pauses.resume.mutate({ id: h.id }),
                            true,
                          )
                        }
                      >
                        Release hold
                      </Button>
                    </Group>
                  </div>
                )}
              </section>
            ))}
            {next !== null && (
              <Button
                variant="default"
                disabled={busy}
                onClick={() =>
                  void load(next).catch((e) => setStale(errorMessage(e)))
                }
              >
                Load more holds
              </Button>
            )}
            {!adding && (
              <Button
                ref={add}
                variant="default"
                disabled={busy || !!stale}
                onClick={() => {
                  setAcknowledgement('');
                  setAdding(true);
                }}
              >
                Add another pause
              </Button>
            )}
            {adding && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform(() =>
                    api.pauses.pause.mutate({
                      target:
                        scope === 'workflow' && target.workflowId
                          ? { scope: 'workflow', workflowId: target.workflowId }
                          : { scope: 'library' },
                      actor,
                      reason,
                    }),
                  );
                }}
              >
                <Stack gap="sm">
                  {target.workflowId ? (
                    <Select
                      label="Scope"
                      value={scope}
                      allowDeselect={false}
                      onChange={(v) => setScope(v ?? 'workflow')}
                      data={[
                        {
                          value: 'workflow',
                          label: `Workflow: ${target.name ?? target.workflowId}`,
                        },
                        { value: 'library', label: 'Entire library' },
                      ]}
                    />
                  ) : (
                    <Text size="sm">Entire library</Text>
                  )}
                  <TextInput
                    label="Actor"
                    required
                    maxLength={200}
                    value={actor}
                    onChange={(e) => setActor(e.currentTarget.value)}
                    disabled={busy}
                  />
                  <Textarea
                    label="Reason"
                    required
                    maxLength={1000}
                    autosize
                    minRows={2}
                    value={reason}
                    onChange={(e) => setReason(e.currentTarget.value)}
                    disabled={busy}
                  />
                  <Group>
                    <Button
                      type="submit"
                      color="yellow"
                      loading={busy}
                      disabled={
                        !actor.trim() || !reason.trim() || !loaded || !!stale
                      }
                    >
                      {scope === 'workflow'
                        ? 'Pause workflow'
                        : 'Pause library'}
                    </Button>
                    <Button
                      variant="subtle"
                      disabled={busy}
                      onClick={() => setAdding(false)}
                    >
                      Cancel
                    </Button>
                  </Group>
                </Stack>
              </form>
            )}
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
          </Stack>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="default" disabled={busy} onClick={onClose}>
          Done
        </Button>
      </ModalFooter>
    </Modal>
  );
}
