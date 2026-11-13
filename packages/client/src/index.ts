import {
  createTRPCClient,
  httpBatchLink,
  httpLink,
  splitLink,
} from '@trpc/client';
import type { AppRouter } from '@interlock/server';
import { largeQueryProcedures } from '@interlock/server/transport';

/** Pass `token` to authenticate when the engine requires its API token. */
export function createClient(
  url = 'http://127.0.0.1:4310',
  {
    token,
    headers: extraHeaders = {},
  }: { token?: string; headers?: Record<string, string> } = {},
) {
  const headers = {
    ...extraHeaders,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  // Body-limit and token rejections arrive before tRPC and are not tRPC responses.
  const fetchChecked: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (response.status === 413) throw new Error(await response.text());
    if (response.status === 401) {
      const body = await response.text();
      let message = body;
      try {
        message = (JSON.parse(body) as { error?: string }).error ?? body;
      } catch {
        // Keep the plain-text body.
      }
      throw new Error(message);
    }
    return response;
  };
  const link = { url: `${url}/trpc`, headers, fetch: fetchChecked };
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        // Candidate definitions can exceed the HTTP request-line limit.
        condition: (operation) => largeQueryProcedures.includes(operation.path),
        true: httpLink({ ...link, methodOverride: 'POST' }),
        false: splitLink({
          // Long waits need independent abort and response timing.
          condition: (operation) => operation.path === 'runs.wait',
          true: httpLink(link),
          false: httpBatchLink(link),
        }),
      }),
    ],
  });
}

export { TRPCClientError } from '@trpc/client';
export type { AppRouter } from '@interlock/server';
