// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import {
  createQueryClient,
  QueryProvider,
  refreshQueries,
  useQuery,
  notifyManager,
} from '../packages/ui/src/lib/query';

notifyManager.setScheduler(queueMicrotask);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

it('shows exact cached data on remount, retains it on refresh failure, and isolates other keys', async () => {
  const client = createQueryClient();
  let fail = false;
  const read = async () => {
    if (fail) throw new Error('Offline');
    return 'saved data';
  };
  function Page({ scope }: { scope: string }) {
    const result = useQuery({ queryKey: ['page', scope], queryFn: read });
    return h('div', {}, result.data ?? 'skeleton', result.error?.message);
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (child: ReturnType<typeof h> | null) =>
    root.render(h(QueryProvider, { client, children: child }));
  try {
    await act(async () => render(h(Page, { scope: 'one' })));
    expect(container.textContent).toBe('saved data');
    await act(async () => render(null));
    fail = true;
    await act(async () => {
      render(h(Page, { scope: 'one' }));
    });
    expect(container.textContent).toBe('saved dataOffline');
    await act(async () => render(h(Page, { scope: 'two' })));
    expect(container.textContent).toBe('skeletonOffline');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});

it('keeps literal __proto__ tag filters distinct from an empty tag scope', async () => {
  const client = createQueryClient();
  const tags = JSON.parse('{"__proto__":"literal"}');
  try {
    client.setQueryData(['runs', { tags }], 'filtered');
    client.setQueryData(['runs', { tags: {} }], 'unfiltered');
    expect(client.getQueryData(['runs', { tags }])).toBe('filtered');
    expect(client.getQueryData(['runs', { tags: {} }])).toBe('unfiltered');
  } finally {
    client.clear();
  }
});

it('preserves literal metadata keys when replacing an existing cached response', () => {
  const client = createQueryClient();
  try {
    client.setQueryData(['metadata'], {
      tags: JSON.parse('{"__proto__":"first"}'),
    });
    client.setQueryData(['metadata'], {
      tags: JSON.parse('{"__proto__":"second"}'),
    });
    const result = client.getQueryData<{ tags: Record<string, string> }>([
      'metadata',
    ])!;
    expect(Object.hasOwn(result.tags, '__proto__')).toBe(true);
    expect(result.tags['__proto__']).toBe('second');
  } finally {
    client.clear();
  }
});

it('follows a pending inspector read independently of an unrelated read and skips diagnostics', async () => {
  const client = createQueryClient();
  let resolve!: (data: string) => void;
  let resolveUnrelated!: () => void;
  let reads = 0;
  let diagnostics = 0;
  let unrelatedReads = 0;
  function Page() {
    const result = useQuery({
      queryKey: ['runs', 'inspect', 'current-run'],
      queryFn: () => {
        reads++;
        return reads === 1
          ? new Promise<string>((done) => {
              resolve = done;
            })
          : Promise.resolve('after event');
      },
    });
    useQuery({
      queryKey: ['unrelated'],
      queryFn: () =>
        ++unrelatedReads === 1
          ? new Promise<string>((done) => {
              resolveUnrelated = () => done('other page data');
            })
          : Promise.resolve('current unrelated data'),
    });
    useQuery({
      queryKey: ['diagnostics'],
      queryFn: async () => {
        diagnostics++;
        return 'checked';
      },
      meta: { engineRefresh: false },
    });
    return h('div', {}, result.data ?? 'skeleton');
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(h(QueryProvider, { client, children: h(Page) })),
    );
    expect(container.textContent).toBe('skeleton');
    let refreshing!: Promise<void>;
    await act(async () => {
      refreshing = refreshQueries(client);
      resolve('before event');
    });
    expect(reads).toBe(2);
    expect(container.textContent).toBe('after event');
    expect(diagnostics).toBe(1);
    expect(client.getQueryState(['unrelated'])?.fetchStatus).toBe('fetching');
    await act(async () => {
      resolveUnrelated();
      await refreshing;
    });
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});
