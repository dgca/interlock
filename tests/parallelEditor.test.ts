// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from 'react';
import type { WorkflowDefinition } from '@interlock/core';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UiTestProvider as DesignSystemProvider } from './uiTestProvider';
import { SettingsDialog } from '../packages/ui/src/features/workflows/SettingsDialog';
import { parallelDefinition } from './fixtures/parallel';

// Kept apart from nodeEditorUx.test.ts, which is at its size ceiling.
vi.mock('../packages/ui/src/design-system/Modal/Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => h('div', {}, children),
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const control = (label: string) =>
  Array.from(container.querySelectorAll('label')).find(
    (el) => el.textContent?.replace(/\s*\*$/, '') === label,
  )!.control as HTMLInputElement;
function fill(label: string, value: string) {
  const input = control(label);
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const choose = (label: string) => act(() => control(label).click());
const apply = () =>
  act(() =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === 'Apply changes')!
      .click(),
  );

it('requires 1 to the branch count and removes partial settings for All branches', () => {
  const definition = parallelDefinition({ keys: ['spec', 'code', 'lint'] });
  const onApply = vi.fn();
  act(() =>
    root.render(
      h(
        DesignSystemProvider,
        {},
        h(SettingsDialog, {
          name: 'Test',
          description: '',
          definition,
          node: definition.nodes.find((n) => n.kind === 'parallel')!,
          workflows: [],
          onClose: vi.fn(),
          onApply,
        }),
      ),
    ),
  );
  const group = () =>
    (
      onApply.mock.lastCall![0] as { definition: WorkflowDefinition }
    ).definition.nodes.find((n) => n.kind === 'parallel');
  choose('A number of branches succeed');
  for (const value of ['0', '4']) {
    fill('Branches required', value);
    apply();
    expect(onApply).not.toHaveBeenCalled();
  }
  // Typing 1 keeps the count field open rather than switching to Any.
  fill('Branches required', '1');
  expect(control('Branches required').value).toBe('1');
  choose('Continue while enough branches can succeed');
  apply();
  expect(group()).toMatchObject({ joinAfter: 1, onBranchFailure: 'continue' });
  choose('All branches succeed');
  apply();
  expect(group()).not.toHaveProperty('joinAfter');
  expect(group()).not.toHaveProperty('onBranchFailure');
});
