import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@interlock/server';
export function createClient(url = 'http://127.0.0.1:4310') {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${url}/trpc` })],
  });
}
