// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  scheduleConfigSchema,
  eventConfigSchema,
  type Workflow,
} from '@interlock/core';
import { Automations } from '../packages/ui/src/features/automations/Automations';
const rpc = vi.hoisted(() => ({
  list: vi.fn(),
  inspect: vi.fn(),
  preview: vi.fn(),
  manage: vi.fn(),
  versions: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    triggers: {
      list: { query: rpc.list },
      inspect: { query: rpc.inspect },
      preview: { query: rpc.preview },
      manage: { mutate: rpc.manage },
    },
    workflows: { versions: { query: rpc.versions } },
  },
  errorMessage: (e: Error) => e.message,
}));
const definition = {
  ...blankDefinition(),
  inputSchema: {
    type: 'object',
    properties: {
      repository: {
        type: 'string',
        title: 'Repository',
        default: 'dgca/interlock',
      },
      attempts: { type: 'integer', title: 'Attempts', default: 2 },
      options: { type: 'object', default: {} },
    },
    required: ['repository', 'attempts'],
  },
};
const workflow: Workflow = {
  id: 'w',
  name: 'Repository review',
  description: '',
  draft: definition,
  draftRevision: 1,
  latestVersion: 1,
  archived: false,
  ownerWorkflowId: null,
  createdAt: '2026-11-08T12:00:00Z',
  updatedAt: '2026-11-08T12:00:00Z',
};
const trigger = () => ({
  ...scheduleConfigSchema.parse({
    name: 'Daily review',
    timing: { type: 'interval', intervalMs: 300000 },
    input: { repository: 'dgca/interlock', attempts: 2, options: {} },
  }),
  id: 't',
  workflowId: 'w',
  revision: 4,
  enabled: false,
  anchorAt: workflow.createdAt,
  nextFireAt: '2026-11-09T12:00:00Z',
  createdAt: workflow.createdAt,
  updatedAt: workflow.createdAt,
  consecutiveFailures: 0,
  workflowName: workflow.name,
  canEnable: true,
  holds: [],
  holdCount: 0,
  publishedVersion: 1,
});
const inspection = (t = trigger()) => ({
  trigger: t,
  upcoming: [],
  fires: { items: [], total: 0, nextOffset: null },
  deliveries: { items: [], total: 0, nextOffset: null },
  endpoint: null,
});
let root: Root, container: HTMLDivElement;
function Layout() {
  const location = useLocation();
  return h(
    'div',
    {},
    h('output', { 'data-location': true }, location.pathname + location.search),
    h(Outlet, {
      context: {
        loaded: true,
        workflows: [workflow],
        tick: 0,
        onScheduleDirty: vi.fn(),
        onSchedulePending: vi.fn(),
      },
    }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  rpc.versions.mockResolvedValue([{ workflowId: 'w', version: 1, definition }]);
  rpc.preview.mockResolvedValue({ upcoming: [] });
  rpc.inspect.mockResolvedValue(inspection());
  rpc.manage.mockResolvedValue({ applied: true, trigger: trigger() });
  rpc.list.mockResolvedValue({
    items: [{ ...trigger(), lastActivity: null, actionType: 'workflow' }],
    total: 1,
    nextOffset: null,
    counts: { all: 1, enabled: 0, disabled: 1, attention: 0 },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(path = '/automations/new?type=schedule&workflow=w') {
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(
          MemoryRouter,
          { initialEntries: [path] },
          h(
            Routes,
            {},
            h(
              Route,
              { element: h(Layout) },
              ...[
                '/automations',
                '/automations/new',
                '/automations/:automationId',
                '/automations/:automationId/edit',
              ].map((path) =>
                h(Route, { key: path, path, element: h(Automations) }),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
function button(label: string) {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(b, label).toBeTruthy();
  return b!;
}
function field(label: string) {
  const l = [...document.querySelectorAll<HTMLLabelElement>('label')].find(
    (l) => l.textContent?.replace(/\s*\*$/, '').trim() === label,
  );
  expect(l, label).toBeTruthy();
  return document.getElementById(l!.htmlFor) as HTMLInputElement;
}
async function fill(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
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
async function submit() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

it('saves exact input keys and typed values, defaults disabled, and opens ordinary detail', async () => {
  await render();
  await fill(field('Name'), 'Morning review');
  await fill(field('Attempts'), '3');
  expect(field('Enable when created').checked).toBe(false);
  await submit();
  expect(rpc.manage).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'create',
      workflowId: 'w',
      enabled: false,
      config: expect.objectContaining({
        input: { repository: 'dgca/interlock', attempts: 3, options: {} },
        missedFirePolicy: 'skip',
      }),
    }),
  );
  expect(document.querySelector('[data-location]')?.textContent).toBe(
    '/automations/t',
  );
  expect(document.body.textContent).not.toContain('Review before enabling');
});
it('uses the enabled CTA and prevents duplicate submissions while a write is pending', async () => {
  await render();
  await fill(field('Name'), 'Morning review');
  await act(async () => field('Enable when created').click());
  expect(button('Create and enable')).toBeTruthy();
  let finish!: (value: any) => void;
  rpc.manage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await submit();
  await submit();
  expect(rpc.manage).toHaveBeenCalledTimes(1);
  expect(rpc.manage.mock.calls[0][0].enabled).toBe(true);
  expect(button('Cancel').disabled).toBe(true);
  await act(async () =>
    finish({ applied: true, trigger: { ...trigger(), enabled: true } }),
  );
  expect(document.querySelector('[data-location]')?.textContent).toBe(
    '/automations/t',
  );
});
it('retains edits and activation after failed immediate enablement', async () => {
  rpc.manage.mockRejectedValueOnce(
    new Error('Publish this workflow before enabling its trigger'),
  );
  await render();
  await fill(field('Name'), 'Keep this name');
  await act(async () => field('Enable when created').click());
  await submit();
  expect(field('Name').value).toBe('Keep this name');
  expect(field('Enable when created').checked).toBe(true);
  expect(document.body.textContent).toContain('Publish this workflow');
  expect(document.querySelector('[data-location]')?.textContent).toContain(
    '/automations/new',
  );
});
it('does not submit stale JSON when a complex input is invalid', async () => {
  await render();
  await fill(field('Name'), 'Invalid JSON');
  await fill(
    document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label=options]',
    )!,
    '{invalid',
  );
  await submit();
  expect(rpc.manage).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Enter valid workflow inputs.');
});
it('keeps interval and cron drafts when switching timing modes', async () => {
  await render();
  await fill(field('Run every'), '17');
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[value=cron]')!.click(),
  );
  await fill(field('Cron expression'), '0 6 * * *');
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[value=interval]')!.click(),
  );
  expect(field('Run every').value).toBe('17');
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[value=cron]')!.click(),
  );
  expect(field('Cron expression').value).toBe('0 6 * * *');
});
it('applies URL filters and preserves the list destination through detail navigation', async () => {
  await render('/automations?workflow=w&status=disabled&search=review');
  expect(rpc.list).toHaveBeenCalledWith({
    workflowId: 'w',
    status: 'disabled',
    search: 'review',
    offset: 0,
    limit: 20,
  });
  const link = [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
    (a) => a.textContent?.includes('Daily review'),
  )!;
  await act(async () => link.click());
  const back = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Back to automations"]',
  )!;
  await act(async () => back.click());
  expect(document.querySelector('[data-location]')?.textContent).toBe(
    '/automations?workflow=w&status=disabled&search=review',
  );
});
it('preserves advanced configuration and rejects revision conflicts without discarding edits', async () => {
  const saved = {
    ...trigger(),
    missedFirePolicy: 'run_once',
    pauseAfterConsecutiveFailures: 3,
    tags: { repo: 'dgca/interlock' },
    bindings: { triggerId: 'options.triggerId' },
  };
  rpc.inspect.mockResolvedValue(inspection(saved as any));
  rpc.manage.mockRejectedValueOnce(
    new Error('Trigger revision conflict; retain edits and reload'),
  );
  await render('/automations/t/edit');
  await fill(field('Name'), 'Local edit');
  await submit();
  expect(rpc.manage).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'update',
      id: 't',
      expectedRevision: 4,
      config: expect.objectContaining({
        name: 'Local edit',
        missedFirePolicy: 'run_once',
        pauseAfterConsecutiveFailures: 3,
        tags: { repo: 'dgca/interlock' },
        bindings: { triggerId: 'options.triggerId' },
      }),
    }),
  );
  expect(field('Name').value).toBe('Local edit');
  expect(document.body.textContent).toContain('Trigger revision conflict');
});
it('shows load failure with retry rather than an editable blank configuration', async () => {
  rpc.inspect.mockRejectedValueOnce(new Error('Connection lost'));
  await render('/automations/t/edit');
  expect(document.body.textContent).toContain('Connection lost');
  expect(document.querySelector('form')).toBeNull();
  expect(button('Save changes').disabled).toBe(true);
  await act(async () => button('Retry loading').click());
  expect(field('Name').value).toBe('Daily review');
});

it('keeps the editor usable when an incomplete timezone has existing preview times', async () => {
  rpc.preview.mockResolvedValue({ upcoming: ['2026-11-09T16:00:00Z'] });
  await render();
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[value=cron]')!.click(),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 275));
  });
  await fill(field('Timezone'), 'Mars/Olympus');
  await fill(field('Name'), 'Invalid zone');
  await submit();
  expect(rpc.manage).not.toHaveBeenCalled();
  expect(field('Timezone').getAttribute('aria-invalid')).toBe('true');
  expect(field('Cron expression').getAttribute('aria-invalid')).not.toBe(
    'true',
  );
});
it('retains a successful enable acknowledgment when its follow-up read fails', async () => {
  await render('/automations/t');
  rpc.manage.mockResolvedValueOnce({
    applied: true,
    trigger: { ...trigger(), enabled: true, revision: 5 },
  });
  rpc.inspect.mockRejectedValueOnce(new Error('Read failed after write'));
  await act(async () => button('Enable automation').click());
  expect(document.body.textContent).toContain('Automation enabled.');
  expect(document.body.textContent).toContain('Read failed after write');
  expect(button('Disable').disabled).toBe(true);
  expect(rpc.manage).toHaveBeenCalledTimes(1);
  await act(async () => button('Reload automation').click());
  expect(rpc.manage).toHaveBeenCalledTimes(1);
});

it('creates an event handler with a watched source distinct from the target', async () => {
  await render('/automations/new?type=event&workflow=w');
  await fill(field('Name'), 'Build failure handler');
  await act(async () => field('Watch runs from').click());
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role=option]')]
      .find((el) => el.textContent === 'Any workflow')!
      .click(),
  );
  await submit();
  expect(rpc.manage).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'create',
      workflowId: 'w',
      enabled: false,
      config: expect.objectContaining({
        kind: 'event',
        events: ['failed'],
        scope: { type: 'library' },
        action: { type: 'workflow' },
      }),
    }),
  );
});
it('clears an incompatible Exit filter when switching to a library event source', async () => {
  const event = {
    ...trigger(),
    ...eventConfigSchema.parse({
      kind: 'event',
      name: 'Cleanup',
      events: ['completed'],
      scope: { type: 'workflow', workflowId: 'w' },
      exitNodeId: 'exit',
      waitForQuiescence: true,
    }),
  };
  rpc.inspect.mockResolvedValue(inspection(event as any));
  await render('/automations/t/edit');
  await act(async () => field('Watch runs from').click());
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role=option]')]
      .find((el) => el.textContent === 'Any workflow')!
      .click(),
  );
  await submit();
  expect(rpc.manage).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'update',
      config: expect.objectContaining({
        scope: { type: 'library' },
        waitForQuiescence: true,
      }),
    }),
  );
  expect(rpc.manage.mock.calls[0][0].config.exitNodeId).toBeUndefined();
});
it('validates unbound input fields even when other fields use schedule metadata', async () => {
  rpc.inspect.mockResolvedValue(
    inspection({
      ...trigger(),
      bindings: { triggerId: 'options.triggerId' },
    } as any),
  );
  await render('/automations/t/edit');
  await fill(field('Attempts'), '');
  await submit();
  expect(rpc.manage).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Workflow inputs');
});

it('accepts an empty required string when the workflow contract allows it', async () => {
  await render();
  await fill(field('Name'), 'Empty string is a value');
  await fill(field('Repository'), '');
  expect(document.querySelector('form')!.checkValidity()).toBe(true);
  await submit();
  expect(rpc.manage).toHaveBeenCalledWith(
    expect.objectContaining({
      config: expect.objectContaining({
        input: expect.objectContaining({ repository: '' }),
      }),
    }),
  );
});

it('keeps list context visible while loading without showing a false empty state', async () => {
  let finish!: (value: unknown) => void;
  rpc.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render('/automations?status=disabled&search=review');
  expect(document.querySelector('h1')?.textContent).toBe('Automations');
  expect(
    document.querySelector(
      'nav[aria-label="Automation views"] a[aria-current=page]',
    )?.textContent,
  ).toBe('Disabled');
  expect(document.querySelector('[role=status]')?.textContent).toBe(
    'Loading automations…',
  );
  expect(document.body.textContent).not.toContain('No automations yet');
  expect(document.body.textContent).not.toContain('No matching automations');
  await act(async () =>
    finish({
      items: [],
      total: 0,
      nextOffset: null,
      counts: { all: 0, enabled: 0, disabled: 0, attention: 0 },
    }),
  );
  expect(document.body.textContent).toContain('No matching automations');
  expect(document.body.textContent).not.toContain('Loading automations…');
});
