import {
  QueryClient,
  QueryClientProvider,
  replaceEqualDeep,
} from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '@interlock/client';
import { useEffect, useRef, type ReactNode } from 'react';
import { api } from './api';

export { useQuery, useQueryClient, notifyManager } from '@tanstack/react-query';

// Preserve literal metadata keys such as __proto__ while sorting object keys.
// Assigning sorted keys to {} would silently drop those filters from the hash.
function hashQueryKey(key: readonly unknown[]) {
  return JSON.stringify(key, (_key, value) => {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null)
    )
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((name) => [name, value[name]]),
      );
    return value;
  });
}

function containsLiteralPrototypeKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const pending = [value];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, '__proto__')) return true;
    for (const child of Object.values(current))
      if (child && typeof child === 'object') pending.push(child);
  }
  return false;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        gcTime: 10 * 60 * 1000,
        retry: false,
        queryKeyHashFn: hashQueryKey,
        // Default structural sharing assigns keys into {}, which would lose
        // literal __proto__ fields in supported tags or arbitrary JSON values.
        structuralSharing: (previous, next) =>
          containsLiteralPrototypeKey(next)
            ? next
            : replaceEqualDeep(previous, next),
        // App owns visibility, stream health, and fallback polling together.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: api,
  queryClient,
});

export function QueryProvider({
  children,
  client = queryClient,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type Refetch = (options?: { cancelRefetch?: boolean }) => Promise<unknown>;

/** Bridge existing engine ticks without discarding events during a pending read. */
export function useRefreshOnTick(
  tick: number,
  refetch: Refetch,
  enabled = true,
  isFetching = false,
) {
  const previous = useRef(tick);
  const latest = useRef(refetch);
  latest.current = refetch;
  const latestEnabled = useRef(enabled);
  latestEnabled.current = enabled;
  const state = useRef({ active: true, pending: false, queued: false });
  useEffect(() => {
    state.current.active = true;
    return () => {
      state.current.active = false;
      state.current.queued = false;
    };
  }, []);
  useEffect(() => {
    if (previous.current === tick) return;
    previous.current = tick;
    if (!enabled) {
      state.current.queued = false;
      return;
    }
    if (state.current.pending) {
      state.current.queued = true;
      return;
    }
    state.current.pending = true;
    void (async () => {
      try {
        let followPendingRead = isFetching;
        do {
          state.current.queued = false;
          await latest.current({ cancelRefetch: false });
          if (followPendingRead) {
            state.current.queued = true;
            followPendingRead = false;
          }
        } while (
          state.current.active &&
          latestEnabled.current &&
          state.current.queued
        );
      } catch {
        // Query state owns read failures; event callbacks must not reject.
      } finally {
        state.current.pending = false;
      }
    })();
  }, [tick, enabled]);
}

/** Refresh page reads after engine events or mutations, retaining cached data. */
export async function refreshQueries(client: QueryClient) {
  const pending = new Set(
    client
      .getQueryCache()
      .getAll()
      .filter(
        (query) =>
          query.meta?.engineRefresh !== false &&
          query.isActive() &&
          query.state.fetchStatus === 'fetching',
      ),
  );
  await client.invalidateQueries(
    { predicate: (query) => query.meta?.engineRefresh !== false },
    { cancelRefetch: false },
  );
  // A pending read may have captured state before the event.
  if (pending.size)
    await client.refetchQueries(
      { predicate: (query) => pending.has(query) && query.isActive() },
      { cancelRefetch: false },
    );
}
