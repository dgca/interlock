// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '../packages/ui/node_modules/@mantine/core';
import { expect, it, vi } from 'vitest';
import {
  blankDefinition,
  nodeSchema,
  type WorkflowNode,
} from '@interlock/core';
import { NodeInspector } from '../packages/ui/src/features/workflows/NodeInspector';

it('edits Exit continuation without changing the workflow output contract', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container),
    d = blankDefinition();
  d.inputSchema = {
    type: 'object',
    properties: { cursor: { type: 'number' } },
  };
  d.outputSchema = { type: 'string' };
  let node: WorkflowNode = d.nodes[2];
  const boundary = vi.fn();
  const render = async () =>
    act(async () =>
      root.render(
        h(
          MantineProvider,
          {},
          h(NodeInspector, {
            node,
            workflows: [],
            definition: d,
            onBoundaryChange: boundary,
            onChange: (value) => {
              node = value;
            },
          }),
        ),
      ),
    );
  try {
    await render();
    const toggle = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    await act(async () => toggle.click());
    await render();
    expect(node).toMatchObject({ continueAsNew: { maxRuns: 100 } });
    expect(container.textContent).toContain('Maximum runs in chain');
    expect(container.textContent).toContain(
      'checkpoint must match the workflow input contract',
    );
    expect(container.textContent).toContain('cursor');
    expect(boundary).not.toHaveBeenCalled();
    await act(async () =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await render();
    expect(
      (node as Extract<WorkflowNode, { kind: 'exit' }>).continueAsNew,
    ).toBeUndefined();
    expect(d.outputSchema).toEqual({ type: 'string' });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
