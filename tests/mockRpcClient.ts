import { createTRPCClient } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from '@interlock/client';

/** Exercise the real client and query options while keeping RPC handlers local. */
export function mockRpcClient<T extends object>(handlers: T): T {
  const client = createTRPCClient<AppRouter>({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            let active = true;
            const deliver = async () => {
              try {
                const procedure = op.path
                  .split('.')
                  .reduce<any>((current, key) => current?.[key], handlers);
                const method = op.type === 'mutation' ? 'mutate' : 'query';
                if (typeof procedure?.[method] !== 'function')
                  throw new Error(`Unmocked RPC ${op.type}: ${op.path}`);
                const data = await (op.input === undefined
                  ? procedure[method]()
                  : procedure[method](op.input));
                if (active) {
                  observer.next({ result: { data } });
                  observer.complete();
                }
              } catch (error) {
                if (active) observer.error(error as any);
              }
            };
            void deliver();
            return () => {
              active = false;
            };
          }),
    ],
  });
  return client as unknown as T;
}
