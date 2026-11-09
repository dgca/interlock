import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ActionIcon, Button, Stack, Text } from '@mantine/core';
import { Pause, Play, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import styles from './PauseControls.module.css';

type Holds = Awaited<ReturnType<typeof api.pauses.list.query>>;
type PauseStatus = {
  data?: Holds;
  busy?: boolean;
  error?: string;
  actionError?: string;
};
const Context = createContext<{
  tick: number;
  statuses: Record<string, PauseStatus>;
  refresh: (workflowId: string) => void;
  setPaused: (workflowId: string, paused: boolean) => Promise<void>;
} | null>(null);

export function PauseProvider({
  children,
  tick = 0,
}: {
  children: ReactNode;
  tick?: number;
}) {
  const [statuses, setStatuses] = useState<Record<string, PauseStatus>>({});
  const requests = useRef(new Map<string, Promise<Holds>>());
  const pending = useRef(new Set<string>());
  const update = useCallback(
    (workflowId: string, patch: Partial<PauseStatus>) => {
      setStatuses((old) => ({
        ...old,
        [workflowId]: { ...old[workflowId], ...patch },
      }));
    },
    [],
  );
  const load = useCallback(
    (workflowId: string): Promise<Holds> => {
      const existing = requests.current.get(workflowId);
      if (existing) return existing;
      const request = (async () => {
        const items: Holds['items'] = [];
        let offset: number | null = 0;
        do {
          const page = await api.pauses.list.query({
            workflowId,
            offset,
            limit: 100,
          });
          items.push(...page.items);
          offset = page.nextOffset ?? null;
        } while (offset !== null);
        return { items, total: items.length, nextOffset: null };
      })()
        .then(
          (data) => {
            update(workflowId, { data, error: '' });
            return data;
          },
          (error) => {
            update(workflowId, { error: errorMessage(error) });
            throw error;
          },
        )
        .finally(() => requests.current.delete(workflowId));
      requests.current.set(workflowId, request);
      return request;
    },
    [update],
  );
  const refresh = useCallback(
    (workflowId: string) => {
      if (!pending.current.has(workflowId))
        void load(workflowId).catch(() => {});
    },
    [load],
  );
  const setPaused = useCallback(
    async (workflowId: string, paused: boolean) => {
      if (pending.current.has(workflowId)) return;
      pending.current.add(workflowId);
      update(workflowId, { busy: true, actionError: '' });
      try {
        // Finish older reads, then inspect current holds before changing them.
        await requests.current.get(workflowId)?.catch(() => {});
        let current: Holds;
        try {
          current = await load(workflowId);
        } catch {
          return;
        }
        const local = current.items.filter((hold) => hold.scope === 'workflow');
        try {
          if (!paused && local.length) {
            for (const hold of local) {
              await api.pauses.resume.mutate({ id: hold.id });
              current = {
                items: current.items.filter((item) => item.id !== hold.id),
                total: current.total - 1,
                nextOffset: null,
              };
              update(workflowId, { data: current });
            }
          } else if (paused && !current.total) {
            const hold = await api.pauses.pause.mutate({
              target: { scope: 'workflow', workflowId },
              actor: 'Interlock UI',
              reason: 'Paused from the workflow editor',
            });
            update(workflowId, {
              data: { items: [hold], total: 1, nextOffset: null },
            });
          }
        } catch (error) {
          update(workflowId, { actionError: errorMessage(error) });
        }
        // Keep acknowledged writes when this read fails; retry only the read.
        await load(workflowId).catch(() => {});
      } finally {
        pending.current.delete(workflowId);
        update(workflowId, { busy: false });
      }
    },
    [load, update],
  );
  return (
    <Context.Provider value={{ tick, statuses, refresh, setPaused }}>
      {children}
    </Context.Provider>
  );
}

function useHolds(workflowId: string) {
  const context = useContext(Context);
  const refresh = context?.refresh;
  const tick = context?.tick;
  useEffect(() => {
    refresh?.(workflowId);
  }, [workflowId, tick, refresh]);
  return { context, status: context?.statuses[workflowId] };
}

export function WorkflowPauseButton({
  workflowId,
  compact = false,
}: {
  workflowId: string;
  compact?: boolean;
}) {
  const { context, status } = useHolds(workflowId);
  const local = status?.data?.items.some((hold) => hold.scope === 'workflow');
  const libraryOnly = !!status?.data?.total && !local;
  const label = status?.error
    ? 'Retry pause status'
    : local
      ? 'Resume workflow'
      : libraryOnly
        ? 'Paused by library'
        : 'Pause workflow';
  const Icon = status?.error ? RefreshCw : local ? Play : Pause;
  const props = {
    variant: 'default',
    disabled:
      !context ||
      status?.busy ||
      (!status?.data && !status?.error) ||
      (libraryOnly && !status?.error),
    title: libraryOnly
      ? 'Release library pauses through the CLI or MCP'
      : undefined,
    loading: status?.busy,
    onClick: () => {
      if (status?.error) context?.refresh(workflowId);
      else void context?.setPaused(workflowId, !local);
    },
  };
  return compact ? (
    <ActionIcon {...props} aria-label={label} title={props.title ?? label}>
      <Icon size={16} />
    </ActionIcon>
  ) : (
    <Button {...props} size="xs" leftSection={<Icon size={14} />}>
      {label}
    </Button>
  );
}

export function PauseBanner({
  workflowId,
  run = false,
}: {
  workflowId: string;
  run?: boolean;
}) {
  const { context, status } = useHolds(workflowId);
  if (!status?.data?.total && !status?.error && !status?.actionError)
    return null;
  const library = status.data?.items.some((hold) => hold.scope === 'library');
  const reasons = [...new Set(status.data?.items.map((hold) => hold.reason))]
    .filter((reason) => reason !== 'Paused from the workflow editor')
    .slice(0, 3)
    .join('; ');
  return (
    <div className={styles.banner} role="status">
      <Stack gap={4} className={styles.summary}>
        {!!status.data?.total && (
          <Text size="sm">Workflow paused{reasons ? ` · ${reasons}` : ''}</Text>
        )}
        {library && (
          <Text size="xs">
            A library pause applies. Inspect it with{' '}
            <code>interlock pause-holds</code> and release its exact ID through
            the CLI or MCP.
          </Text>
        )}
        {status.error && (
          <Text size="sm" role="alert">
            Pause status may be out of date: {status.error}
          </Text>
        )}
        {status.actionError && (
          <Text size="sm" role="alert">
            {status.actionError}
          </Text>
        )}
      </Stack>
      {status.error ? (
        <Button
          variant="subtle"
          size="xs"
          disabled={status.busy}
          onClick={() => context?.refresh(workflowId)}
        >
          Retry pause status
        </Button>
      ) : run ? (
        <WorkflowPauseButton workflowId={workflowId} />
      ) : null}
    </div>
  );
}
