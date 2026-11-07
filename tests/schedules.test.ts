// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  blankDefinition,
  scheduleConfigSchema,
  type Workflow,
} from '@interlock/core';
import { Schedules } from '../packages/ui/src/features/schedules/Schedules';
import { RunList } from '../packages/ui/src/features/runs/RunList';
const rpc = vi.hoisted(() => ({
  list: vi.fn(),
  inspect: vi.fn(),
  preview: vi.fn(),
  manage: vi.fn(),
  attention: vi.fn(),
  summaries: vi.fn(),
}));
vi.mock('../packages/ui/src/lib/api', () => ({
  api: {
    triggers: {
      list: { query: rpc.list },
      inspect: { query: rpc.inspect },
      preview: { query: rpc.preview },
      manage: { mutate: rpc.manage },
      attention: { query: rpc.attention },
    },
    runs: { summaries: { query: rpc.summaries } },
  },
  errorMessage: (error: Error) => error.message,
}));
const dirty = vi.fn();
let root: Root, container: HTMLDivElement;
const workflow: Workflow = {
  id: 'w',
  name: 'Schedules',
  description: '',
  ownerWorkflowId: null,
  draft: blankDefinition(),
  draftRevision: 1,
  latestVersion: 1,
  archived: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
function trigger() {
  return {
    ...scheduleConfigSchema.parse({
      name: 'Heartbeat',
      timing: {
        type: 'cron',
        expression: '0 9 * * 1-5',
        timeZone: 'America/Denver',
      },
      input: { literal: 'same JSON' },
    }),
    id: 't',
    workflowId: 'w',
    revision: 1,
    enabled: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    anchorAt: '2026-01-01T00:00:00Z',
    nextFireAt: '2026-01-02T16:00:00Z',
    consecutiveFailures: 0,
    lagMs: 0,
    lagThresholdMs: 60000,
    excessiveLag: false,
    holds: [],
    holdCount: 0,
    workflowName: 'Schedules',
    publishedVersion: 1,
    canEnable: true,
  };
}
const detail = (t = trigger()) => ({
  trigger: t,
  upcoming: [],
  fires: { items: [], total: 0, nextOffset: null },
});
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
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
  rpc.list.mockResolvedValue({
    items: [trigger()],
    total: 1,
    nextOffset: null,
  });
  rpc.inspect.mockResolvedValue(detail());
  rpc.preview.mockResolvedValue({ upcoming: [] });
  rpc.manage.mockResolvedValue({ applied: true, trigger: trigger() });
  rpc.attention.mockResolvedValue({ items: [], total: 0, nextOffset: null });
  rpc.summaries.mockResolvedValue({
    items: [],
    counts: { active: 0, attention: 0, history: 0 },
    scheduleAttentionCount: 24,
    offset: 0,
    total: 0,
    nextOffset: null,
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
async function renderSchedules(visible = true) {
  await act(async () =>
    root.render(
      h(
        MantineProvider,
        {},
        h(
          MemoryRouter,
          { initialEntries: ['/workflows/w?view=schedules&schedule=t'] },
          h(Schedules, { workflow, tick: 0, visible, onDirty: dirty }),
        ),
      ),
    ),
  );
}
function button(name: string) {
  const found = [
    ...document.querySelectorAll<HTMLButtonElement>('button'),
  ].find((b) => b.textContent?.trim() === name);
  expect(found, name).toBeTruthy();
  return found!;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
function input(label: string) {
  const l = [...document.querySelectorAll('label')].find(
    (el) => el.textContent === label,
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

it('UI236-R5 explains the duration minimum beside a fractional-minute interval and allows correction', async () => {
  await renderSchedules();
  await click('Edit schedule');
  await act(async () =>
    document.querySelector<HTMLInputElement>('input[value=interval]')!.click(),
  );
  await act(async () => input('Unit').click());
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role=option]')]
      .find((el) => el.textContent === 'minutes')!
      .click(),
  );
  await fill(input('Every'), '0.1');
  // 0.1 minutes is six seconds.
  await click('Save schedule');
  const every = input('Every');
  expect(every.getAttribute('aria-invalid')).toBe('true');
  expect(
    document.getElementById(every.getAttribute('aria-describedby')!)
      ?.textContent,
  ).toBe('Use an interval of at least 30 seconds.');
  expect(rpc.manage).not.toHaveBeenCalled();
  await fill(every, '0.5');
  await click('Save schedule');
  expect(rpc.manage).toHaveBeenCalledWith(
    expect.objectContaining({
      config: expect.objectContaining({
        timing: { type: 'interval', intervalMs: 30000 },
      }),
    }),
  );
});
it('UI236-R2 associates invalid zone feedback with the zone field while keeping valid cron clear', async () => {
  await renderSchedules();
  await click('Edit schedule');
  await fill(input('IANA time zone'), 'Mars/Olympus');
  await click('Save schedule');
  expect(input('IANA time zone').getAttribute('aria-invalid')).toBe('true');
  expect(input('Cron expression').getAttribute('aria-invalid')).not.toBe(
    'true',
  );
  expect(
    document.getElementById(
      input('IANA time zone').getAttribute('aria-describedby')!,
    )?.textContent,
  ).toContain('Mars/Olympus');
  expect(rpc.manage).not.toHaveBeenCalled();
});
it('UI236-R3 explicit conflict reload resets invalid raw JSON even when server JSON is unchanged', async () => {
  await renderSchedules();
  await click('Edit schedule');
  await fill(input('Schedule name'), 'Local edit');
  rpc.manage.mockRejectedValueOnce(
    new Error('Schedule revision conflict; reload current schedule'),
  );
  await click('Save schedule');
  await click('Run input');
  const editor = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="JSON input template"]',
  )!;
  await fill(editor, '{invalid');
  expect(editor.getAttribute('aria-invalid')).toBe('true');
  rpc.inspect.mockResolvedValue(
    detail({ ...trigger(), name: 'Remote winner', revision: 2 }),
  );
  await click('Reload current schedule and discard edits');
  const reloaded = document.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="JSON input template"]',
  )!;
  expect(reloaded.value).toBe(JSON.stringify(trigger().input, null, 2));
  expect(reloaded.getAttribute('aria-invalid')).not.toBe('true');
  await click('Save schedule');
  expect(rpc.manage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedRevision: 2,
      config: expect.objectContaining({ input: trigger().input }),
    }),
  );
});
it('UI236-R4 leaving a kept-mounted schedule view dismisses its draft and reopening starts from persisted values', async () => {
  await renderSchedules();
  await click('Edit schedule');
  await fill(input('Schedule name'), 'Discard me');
  await renderSchedules(false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await renderSchedules(true);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click('Edit schedule');
  expect(input('Schedule name').value).toBe('Heartbeat');
});
it('UI236-R1 retains attention offset across unrelated run ticks and clamps after the last page disappears', async () => {
  rpc.attention.mockImplementation(async ({ offset }: { offset: number }) => ({
    items: Array.from({ length: offset ? 4 : 20 }, (_, i) => ({
      triggerId: `t-${offset + i}`,
      workflowId: 'w',
      name: `Alert ${offset + i}`,
      reason: 'Failure',
      kind: 'automatic_pause',
      lagMs: 0,
    })),
    total: 24,
    nextOffset: offset ? null : 20,
  }));
  const render = async (tick: number) =>
    act(async () =>
      root.render(
        h(
          MantineProvider,
          {},
          h(
            MemoryRouter,
            {},
            h(RunList, {
              tick,
              offset: 0,
              onOffsetChange: vi.fn(),
              tab: 'attention',
              onTabChange: vi.fn(),
              onOpen: vi.fn(),
              workflows: [],
            }),
          ),
        ),
      ),
    );
  await render(0);
  await click('More schedule alerts');
  expect(document.body.textContent).toContain('Alert 23');
  await render(1);
  expect(document.body.textContent).toContain('Alert 23');
  expect(button('Previous schedule alerts')).toBeTruthy();
  expect(rpc.attention).toHaveBeenLastCalledWith(
    expect.objectContaining({ offset: 20 }),
  );
  rpc.attention.mockResolvedValue({ items: [], total: 2, nextOffset: null });
  await render(2);
  expect(rpc.attention).toHaveBeenLastCalledWith(
    expect.objectContaining({ offset: 0 }),
  );
});
