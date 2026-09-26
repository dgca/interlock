// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  activeInputToken,
  completeInputToken,
  FetchUrlInput,
  urlInputPaths,
} from '../packages/ui/src/features/workflows/FetchUrlInput';

const schema = {
  type: 'object',
  properties: {
    extra: {},
    customer: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        active: { type: 'boolean' },
      },
    },
    items: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'integer' } } },
    },
    invalid: { type: 'object' },
  },
};

it('offers nested scalar paths and leaves unknown paths available as free text', () => {
  expect(urlInputPaths(schema)).toEqual([
    'customer.id',
    'customer.active',
    'items.0.id',
    'extra',
  ]);
  const url = 'https://example.com/{{input.missing}}';
  expect(activeInputToken(url, url.indexOf('missing') + 7)?.query).toBe(
    'missing',
  );
});

it('completes only the token at the cursor', () => {
  const url = 'https://example.com/{{input.first}}/{{input.cus}}?x=1';
  const token = activeInputToken(url, url.indexOf('cus') + 3)!;
  expect(completeInputToken(url, token, 'customer.id')).toEqual({
    value: 'https://example.com/{{input.first}}/{{input.customer.id}}?x=1',
    cursor: url.indexOf('cus') + 'customer.id'.length + 2,
  });
  expect(activeInputToken(url, url.indexOf('?x'))).toBeNull();
  const partial = 'https://example.com/{{input.cus/path';
  expect(
    completeInputToken(
      partial,
      activeInputToken(partial, partial.indexOf('cus') + 3)!,
      'customer.id',
    ).value,
  ).toBe('https://example.com/{{input.customer.id}}/path');
});

let root: Root;
let container: HTMLDivElement;
let latest: string;
const scrollIntoView = HTMLElement.prototype.scrollIntoView;

function Harness() {
  const [value, setValue] = useState(latest);
  return h(FetchUrlInput, {
    value,
    schema,
    suggestionSource: 'Expected format',
    onChange: (next) => {
      latest = next;
      setValue(next);
    },
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  latest = 'https://example.com/{{input.first}}/{{input.cus}}?x=1';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (scrollIntoView) HTMLElement.prototype.scrollIntoView = scrollIntoView;
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('inserts a suggestion without replacing the URL and leaves the caret after the token', async () => {
  await act(async () => root.render(h(MantineProvider, {}, h(Harness))));
  expect(latest).toBe('https://example.com/{{input.first}}/{{input.cus}}?x=1');
  const input = container.querySelector<HTMLInputElement>('input')!;
  const cursor = latest.indexOf('cus') + 3;
  await act(async () => {
    input.focus();
    input.setSelectionRange(cursor, cursor);
    input.click();
  });
  expect(container.textContent).toContain('Fields from expected format');
  const option = Array.from(
    container.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((element) => element.textContent === 'customer.id')!;
  await act(async () => option.click());
  expect(latest).toBe(
    'https://example.com/{{input.first}}/{{input.customer.id}}?x=1',
  );
  expect(input.selectionStart).toBe(latest.indexOf('}}?x') + 2);
  expect(document.activeElement).toBe(input);

  await act(async () => {
    const withinPath = latest.indexOf('customer.id') + 11;
    input.setSelectionRange(withinPath, withinPath);
    input.click();
  });
  const sameOption = Array.from(
    container.querySelectorAll<HTMLElement>('[role="option"]'),
  ).find((element) => element.textContent === 'customer.id')!;
  await act(async () => sameOption.click());
  expect(input.selectionStart).toBe(latest.indexOf('}}?x') + 2);
  expect(document.activeElement).toBe(input);

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, 'https://example.com/{{input.notDeclared}}');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(latest).toBe('https://example.com/{{input.notDeclared}}');
});
