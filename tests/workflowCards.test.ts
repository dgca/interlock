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
async function render(description?: string) {
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
          }),
        ),
      ),
    ),
  );
}
const readMore = () =>
  container.querySelector<HTMLButtonElement>(
    'button[aria-label="Read more about Mission briefing"]',
  );
async function resize() {
  await act(async () => {
    for (const observer of observers)
      if (observer.element instanceof HTMLParagraphElement) observer.notify();
  });
}
async function frame() {
  await act(
    async () =>
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      ),
  );
}
async function close() {
  await act(async () =>
    document
      .querySelector('[aria-label="Close dialog"]')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
  );
  await frame();
}

it('offers Read more only for rendered overflow, updating after resize, fonts, and text changes', async () => {
  await render();
  expect(readMore()).toBeNull();
  await render('Fits in four lines.');
  expect(readMore()).toBeNull();
  overflow = 21;
  await resize();
  expect(readMore()?.textContent).toBe('Read more');
  overflow = 0;
  await resize();
  expect(readMore()).toBeNull();
  overflow = 21;
  await act(async () => finishFonts());
  expect(readMore()).not.toBeNull();
  overflow = 0;
  await act(async () => fonts.dispatchEvent(new Event('loadingdone')));
  expect(readMore()).toBeNull();
  overflow = 21;
  await resize();
  overflow = 0;
  await render('A shorter replacement.');
  expect(readMore()).toBeNull();
});

it('opens the complete plain text separately from workflow navigation and returns focus on Escape', async () => {
  openWorkflow.mockClear();
  overflow = 21;
  const description = 'First paragraph.\n\n<script>preserved as text</script>';
  await render(description);
  const trigger = readMore()!;
  trigger.focus();
  await act(async () => trigger.click());
  await frame();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain(description);
  expect(dialog.querySelector('script')).toBeNull();
  expect(openWorkflow).not.toHaveBeenCalled();
  await close();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
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

it('returns focus to workflow navigation if a resize removes Read more while the dialog is open', async () => {
  overflow = 21;
  await render('A description that currently overflows.');
  readMore()!.focus();
  await act(async () => readMore()!.click());
  await frame();
  overflow = 0;
  await resize();
  expect(readMore()).toBeNull();
  await close();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(
    container.querySelector('button[aria-label="Open Mission briefing"]'),
  );
});
