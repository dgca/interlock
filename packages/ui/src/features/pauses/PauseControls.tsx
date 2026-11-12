import { ActionIcon, Button, Stack, Text } from '../../design-system';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Pause, Play, RefreshCw } from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import {
  refreshQueries,
  trpc,
  useQuery,
  useQueryClient,
} from '../../lib/query';
import styles from './PauseControls.module.css';

type Holds = Awaited<ReturnType<typeof api.pauses.list.query>>;
type PauseAction = { busy?: boolean; actionError?: string };
const Context = createContext<{
  actions: ReadonlyMap<string, PauseAction>;
  setPaused: (workflowId: string, paused: boolean) => Promise<void>;
} | null>(null);

function holdOptions(workflowId: string) {
  // The editor needs every applicable hold, including legacy instances
  // with multiple pages. Keep the aggregate separate from a single API page.
  const page = trpc.pauses.list.queryKey({ workflowId, offset: 0, limit: 100 });
  return {
    queryKey: [...page, 'all'] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Holds> => {
      const items: Holds['items'] = [];
      let offset: number | null = 0;
      do {
        const next = await api.pauses.list.query(
          { workflowId, offset, limit: 100 },
          { signal },
        );
        items.push(...next.items);
        offset = next.nextOffset ?? null;
      } while (offset !== null);
      return { items, total: items.length, nextOffset: null };
    },
  };
}

export function PauseProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [actions, setActions] = useState<ReadonlyMap<string, PauseAction>>(
    () => new Map(),
  );
  const pending = useRef(new Set<string>());
  const update = useCallback(
    (workflowId: string, patch: Partial<PauseAction>) => {
      setActions((old) => {
        const next = new Map(old);
        const action = { ...old.get(workflowId), ...patch };
        if (action.busy || action.actionError) next.set(workflowId, action);
        else next.delete(workflowId);
        return next;
      });
    },
    [],
  );
  const setPaused = useCallback(
    async (workflowId: string, paused: boolean) => {
      if (pending.current.has(workflowId)) return;
      pending.current.add(workflowId);
      update(workflowId, { busy: true, actionError: '' });
      const options = holdOptions(workflowId);
      const filter = { queryKey: options.queryKey, exact: true };
      const acknowledge = (data: Holds) => {
        void client.cancelQueries(filter);
        client.setQueryData(options.queryKey, data);
      };
      try {
        let current: Holds;
        try {
          // Start a fresh status read before deciding whether to write.
          await client.cancelQueries(filter);
          current = await client.fetchQuery(options);
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
              acknowledge(current);
            }
          } else if (paused && !current.total) {
            const hold = await api.pauses.pause.mutate({
              target: { scope: 'workflow', workflowId },
              actor: 'Interlock UI',
              reason: 'Paused from the workflow editor',
            });
            acknowledge({ items: [hold], total: 1, nextOffset: null });
          }
        } catch (error) {
          update(workflowId, { actionError: errorMessage(error) });
        }
        // Keep acknowledged writes when this read fails; retry only the read.
        await refreshQueries(client, filter);
      } finally {
        pending.current.delete(workflowId);
        update(workflowId, { busy: false });
      }
    },
    [client, update],
  );
  return (
    <Context.Provider value={{ actions, setPaused }}>
      {children}
    </Context.Provider>
  );
}

function useHolds(workflowId: string) {
  const context = useContext(Context);
  const result = useQuery({
    ...holdOptions(workflowId),
    enabled: Boolean(context),
  });
  return {
    context,
    status: {
      ...context?.actions.get(workflowId),
      data: result.data,
      error: result.error ? errorMessage(result.error) : '',
    },
    retry: () => void result.refetch({ cancelRefetch: false }),
  };
}

export function WorkflowPauseButton({
  workflowId,
  compact = false,
}: {
  workflowId: string;
  compact?: boolean;
}) {
  const { context, status, retry } = useHolds(workflowId);
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
      if (status.error) retry();
      else void context?.setPaused(workflowId, !local);
    },
  };
  return compact ? (
    <ActionIcon
      {...props}
      variant="default"
      aria-label={label}
      title={props.title ?? label}
    >
      <Icon size={16} />
    </ActionIcon>
  ) : (
    <Button variant="secondary" {...props} leftSection={<Icon size={14} />}>
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
  const { status, retry } = useHolds(workflowId);
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
        <Button variant="ghost" disabled={status.busy} onClick={retry}>
          Retry pause status
        </Button>
      ) : run ? (
        <WorkflowPauseButton workflowId={workflowId} />
      ) : null}
    </div>
  );
}
