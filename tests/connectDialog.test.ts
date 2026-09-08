// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectDialog } from '../packages/ui/src/components/ConnectDialog/ConnectDialog';

const query = vi.hoisted(() => vi.fn());
vi.mock('../packages/ui/src/lib/api', () => ({
  api: { connection: { query } },
  errorMessage: (error: Error) => error.message,
}));
vi.mock('../packages/ui/src/components/Modal/Modal', () => ({
  Modal: ({ children }: any) => h('div', {}, children),
}));
let root: Root, container: HTMLDivElement;
const url = 'http://127.0.0.1:4400/mcp';
const writeText = vi.fn().mockResolvedValue(undefined);
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  query.mockResolvedValue({
    mcpUrl: url,
    engineUrl: 'http://127.0.0.1:4400',
    command: 'interlock',
    args: ['mcp'],
    env: { INTERLOCK_URL: 'http://127.0.0.1:4400' },
    development: false,
    fallback: { command: '/node', args: ['/installed/interlock.js', 'mcp'] },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(h(MantineProvider, {}, h(ConnectDialog, { onClose: vi.fn() }))),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
const click = async (text: string) =>
  act(async () => {
    [...container.querySelectorAll('button')]
      .find((button) => button.textContent === text)!
      .click();
  });
const snippet = () => container.querySelector('pre')!.textContent!;
it('defaults to the running HTTP URL and copies each client configuration', async () => {
  expect(snippet()).toBe(`[mcp_servers.interlock]\nurl = "${url}"`);
  await click('Copy configuration');
  expect(writeText).toHaveBeenLastCalledWith(snippet());
  await click('Claude');
  expect(snippet()).toBe(
    `claude mcp add --transport http --scope user interlock '${url}'`,
  );
  await click('Copy command');
  expect(writeText).toHaveBeenLastCalledWith(snippet());
  await click('OpenCode');
  expect(JSON.parse(snippet()).mcp.interlock).toEqual({
    type: 'remote',
    url,
    enabled: true,
    oauth: false,
  });
  await click('Other');
  expect(snippet()).toBe(url);
  await click('Copy endpoint URL');
  expect(writeText).toHaveBeenLastCalledWith(url);
});
it('retains stdio configuration and absolute paths without changing HTTP configuration', async () => {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  expect(snippet()).toContain('command = "interlock"');
  expect(snippet()).toContain('INTERLOCK_URL = "http://127.0.0.1:4400"');
  await act(async () =>
    container
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]
      .click(),
  );
  expect(snippet()).toContain('command = "/node"');
  await click('Claude');
  const desktop = JSON.parse(container.querySelectorAll('pre')[1].textContent!);
  expect(desktop.mcpServers.interlock).toMatchObject({
    command: '/node',
    args: ['/installed/interlock.js', 'mcp'],
  });
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  await click('Codex');
  expect(snippet()).toBe(`[mcp_servers.interlock]\nurl = "${url}"`);
});
