// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '../packages/ui/src/design-system';
import { WorkflowCard } from '../packages/ui/src/components/WorkflowCards/WorkflowCards';

let root: Root, container: HTMLDivElement, overflow: number;
let fonts: EventTarget & { ready: Promise<void> };
let finishFonts: () => void;
const observers = new Set<ParagraphObserver>();
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

class ParagraphObserver {
  element?: Element;
  constructor(private callback: ResizeObserverCallback) {
    observers.add(this);
  }
  observe(element: Element) {
    this.element = element;
  }
  unobserve() {}
  disconnect() {
    observers.delete(this);
  }
  notify() {
    this.callback([], this);
  }
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal('ResizeObserver', ParagraphObserver);
  overflow = 0;
  Object.defineProperty(HTMLParagraphElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 84,
  });
  Object.defineProperty(HTMLParagraphElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => 84 + overflow,
  });
  fonts = Object.assign(new EventTarget(), {
    ready: new Promise<void>((resolve) => {
      finishFonts = resolve;
    }),
  });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(HTMLParagraphElement.prototype, 'clientHeight');
  Reflect.deleteProperty(HTMLParagraphElement.prototype, 'scrollHeight');
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  vi.unstubAllGlobals();
});

const openWorkflow = vi.fn();
async function render(description?: string, disabled = false) {
  await act(async () =>
    root.render(
      h(
        DesignSystemProvider,
        { env: 'test' },
        h(
          MemoryRouter,
          {},
          h(WorkflowCard, {
            name: 'Mission briefing',
            description,
            metadata: '3 nodes',
            onOpen: openWorkflow,
            disabled,
          }),
        ),
      ),
    ),
  );
}
const disclosure = () =>
  container.querySelector<HTMLButtonElement>('button[aria-controls]');
async function resize() {
  await act(async () => {
    for (const observer of observers)
      if (observer.element instanceof HTMLParagraphElement) observer.notify();
  });
}
it('offers Show More only for rendered overflow, updating after resize, fonts, and text changes', async () => {
  await render();
  expect(disclosure()).toBeNull();
  await render('Fits in four lines.');
  expect(disclosure()).toBeNull();
  overflow = 21;
  await resize();
  expect(disclosure()?.textContent).toBe('Show More');
  overflow = 0;
  await resize();
  expect(disclosure()).toBeNull();
  overflow = 21;
  await act(async () => finishFonts());
  expect(disclosure()).not.toBeNull();
  overflow = 0;
  await act(async () => fonts.dispatchEvent(new Event('loadingdone')));
  expect(disclosure()).toBeNull();
  overflow = 21;
  await resize();
  overflow = 0;
  await render('A shorter replacement.');
  expect(disclosure()).toBeNull();
});

it('expands and collapses complete plain text without navigating or opening a dialog', async () => {
  openWorkflow.mockClear();
  overflow = 21;
  const description = 'First paragraph.\n\n<script>preserved as text</script>';
  await render(description);
  const trigger = disclosure()!;
  const paragraph = container.querySelector('p')!;
  expect(trigger.tagName).toBe('BUTTON');
  expect(trigger.type).toBe('button');
  expect(trigger.getAttribute('aria-controls')).toBe(paragraph.id);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.focus();
  await act(async () => trigger.click());
  expect(disclosure()).toBe(trigger);
  expect(trigger.textContent).toBe('Show Less');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(paragraph.dataset.expanded).toBe('true');
  expect(paragraph.textContent).toBe(description);
  expect(container.querySelector('script')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(openWorkflow).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  await resize();
  expect(trigger.textContent).toBe('Show Less');
  await act(async () => trigger.click());
  expect(disclosure()).toBe(trigger);
  expect(trigger.textContent).toBe('Show More');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(paragraph.dataset.expanded).toBeUndefined();
  expect(document.activeElement).toBe(trigger);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Open Mission briefing"]',
      )!
      .click(),
  );
  expect(openWorkflow).toHaveBeenCalledOnce();
});

it('keeps Show Less available after resizing and preserves focus if collapsed content now fits', async () => {
  overflow = 21;
  await render('A description that currently overflows.');
  const trigger = disclosure()!;
  trigger.focus();
  await act(async () => trigger.click());
  overflow = 0;
  await resize();
  expect(disclosure()).toBe(trigger);
  expect(trigger.textContent).toBe('Show Less');
  await act(async () => trigger.click());
  expect(disclosure()).toBeNull();
  expect(document.activeElement).toBe(
    container.querySelector('button[aria-label="Open Mission briefing"]'),
  );
});

it('returns focus to the heading when a fitting description collapses on a guarded child card', async () => {
  openWorkflow.mockClear();
  overflow = 21;
  await render('A description that currently overflows.', true);
  const trigger = disclosure()!;
  trigger.focus();
  await act(async () => trigger.click());
  overflow = 0;
  await resize();
  await act(async () => trigger.click());
  expect(disclosure()).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('h2'));
  expect(
    container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Mission briefing"]',
    )?.disabled,
  ).toBe(true);
  expect(openWorkflow).not.toHaveBeenCalled();
});
