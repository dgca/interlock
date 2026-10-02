import {
  createTRPCClient,
  httpBatchLink,
  httpLink,
  splitLink,
} from '@trpc/client';
import type { AppRouter } from '@interlock/server';
export function createClient(url = 'http://127.0.0.1:4310') {
  return createTRPCClient<AppRouter>({
    // Long waits need their own request so abort and response timing remain independent.
    links: [
      splitLink({
        condition: (operation) => operation.path === 'runs.wait',
        true: httpLink({ url: `${url}/trpc` }),
        false: httpBatchLink({ url: `${url}/trpc` }),
      }),
    ],
  });
}
