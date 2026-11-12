import {
  QueryClient,
  QueryClientProvider,
  replaceEqualDeep,
  type QueryFilters,
} from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { AppRouter } from '@interlock/client';
import type { ReactNode } from 'react';
import { api } from './api';

export {
  useQuery,
  useQueryClient,
  notifyManager,
  type QueryClient,
} from '@tanstack/react-query';

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

/** Refresh page reads after engine events or mutations, retaining cached data. */
export async function refreshQueries(
  client: QueryClient,
  scope: QueryFilters = {},
) {
  const filter: QueryFilters = {
    ...scope,
    predicate: (query) =>
      query.meta?.engineRefresh !== false && (scope.predicate?.(query) ?? true),
  };
  const pending = client
    .getQueryCache()
    .findAll({ ...filter, type: 'active', fetchStatus: 'fetching' });
  const options = { cancelRefetch: false };
  const refreshing = client.invalidateQueries(filter, options);
  await Promise.all([
    refreshing,
    ...pending.map(async (query) => {
      const exact = {
        predicate: (entry: typeof query) => entry === query && entry.isActive(),
      };
      // Join and follow this read without waiting for unrelated queries.
      await client.refetchQueries(exact, options);
      await client.refetchQueries(exact, options);
    }),
  ]);
}
