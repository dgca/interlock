import {
  createTRPCClient,
  httpBatchLink,
  httpLink,
  splitLink,
} from '@trpc/client';
import type { AppRouter } from '@interlock/server';
import { largeQueryProcedures } from '@interlock/server/transport';

export function createClient(
  url = 'http://127.0.0.1:4310',
  headers: Record<string, string> = {},
) {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        // Candidate definitions can exceed the HTTP request-line limit.
        condition: (operation) => largeQueryProcedures.includes(operation.path),
        true: httpLink({
          url: `${url}/trpc`,
          headers,
          methodOverride: 'POST',
          fetch: async (input, init) => {
            const response = await fetch(input, init);
            // Body-limit responses arrive before tRPC and are plain text.
            if (response.status === 413) throw new Error(await response.text());
            return response;
          },
        }),
        false: splitLink({
          // Long waits need independent abort and response timing.
          condition: (operation) => operation.path === 'runs.wait',
          true: httpLink({ url: `${url}/trpc`, headers }),
          false: httpBatchLink({ url: `${url}/trpc`, headers }),
        }),
      }),
    ],
  });
}

export { TRPCClientError } from '@trpc/client';
export type { AppRouter } from '@interlock/server';
