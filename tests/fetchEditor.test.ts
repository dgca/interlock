// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { nodeSchema, type FetchNode } from '@interlock/core';
import { FetchEditor } from '../packages/ui/src/features/workflows/FetchEditor';
let root: Root, container: HTMLDivElement, latest: FetchNode;
function Harness() {
  const [node, setNode] = useState(latest);
  return h(FetchEditor, {
    node,
    onChange: (n) => {
      latest = n;
      setNode(n);
    },
  });
}
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  latest = nodeSchema.parse({
    id: 'fetch',
    label: 'Fetch',
    kind: 'fetch',
    method: 'POST',
    url: 'https://example.com/items/{{input.id}}',
    body: {
      kind: 'fields',
      fields: [
        { name: 'count', value: { kind: 'input', path: 'count' } },
        { name: 'literal', value: { kind: 'fixed', value: '{{input.id}}' } },
      ],
    },
  }) as FetchNode;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () => root.render(h(MantineProvider, {}, h(Harness))));
}
async function input(label: string, value: string) {
  const el = Array.from(container.querySelectorAll('textarea,input')).find(
    (e) =>
      e.getAttribute('aria-label') === label ||
      container.querySelector(`label[for="${e.id}"]`)?.textContent === label,
  ) as HTMLInputElement | HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value',
    )!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('previews typed bindings without sending a request or saving sample data', async () => {
  const network = vi.spyOn(globalThis, 'fetch');
  await render();
  expect(container.textContent).toContain('Input is missing "id"');
  await input('Sample input JSON', '{"id":"a/b","count":3}');
  const preview = JSON.parse(
    (
      container.querySelector(
        'textarea[aria-label="Resolved request"]',
      ) as HTMLTextAreaElement
    ).value,
  );
  expect(preview.url).toBe('https://example.com/items/a%2Fb');
  expect(preview.body).toEqual({ count: 3, literal: '{{input.id}}' });
  expect(network).not.toHaveBeenCalled();
  expect(latest).not.toHaveProperty('sample');
});
it('disables request bodies for GET and keeps preview errors out of form validity', async () => {
  await render();
  const select = Array.from(container.querySelectorAll('select')).find(
    (el) =>
      container.querySelector(`label[for="${el.id}"]`)?.textContent ===
      'Method',
  )!;
  await act(async () => {
    select.value = 'GET';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(latest.body).toEqual({ kind: 'none' });
  await input('Sample input JSON', '{');
  expect(container.querySelector(':invalid')).toBeNull();
});
it('authors distinct fixed and input query bindings', async () => {
  await render();
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'Add query parameter')!
      .click(),
  );
  await input('Query parameter name 1', 'search');
  await act(async () => {
    const source = container.querySelector(
      '[aria-label="Query parameter value source 1"]',
    )!;
    source.querySelector<HTMLInputElement>('input[value="input"]')!.click();
  });
  await input('Query parameter input field 1', 'term');
  expect(latest.query).toEqual([
    { name: 'search', value: { kind: 'input', path: 'term' } },
  ]);
});
