// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const implementation =
  '../packages/ui/src/design-system/CodeEditor/HighlightedEditor';
type Editor =
  typeof import('../packages/ui/src/design-system/CodeEditor/CodeEditor').CodeEditor;
type EditorModule =
  typeof import('../packages/ui/src/design-system/CodeEditor/HighlightedEditor');
let CodeEditor: Editor;
let container: HTMLDivElement;
let root: Root;
let resolveEditor: (module: EditorModule) => void;
let rejectEditor: (error: Error) => void;

beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetModules();
  vi.doMock(
    implementation,
    () =>
      new Promise<EditorModule>((resolve, reject) => {
        resolveEditor = resolve;
        rejectEditor = reject;
      }),
  );
  ({ CodeEditor } =
    await import('../packages/ui/src/design-system/CodeEditor/CodeEditor'));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.doUnmock(implementation);
});

function Draft() {
  const [value, setValue] = useState('<img src=x onerror="bad()">');
  return h(CodeEditor, {
    label: 'Source code',
    language: 'javascript',
    value,
    onChange: setValue,
  });
}

async function type(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('loads current controlled content without moving focus, then retains normal editing', async () => {
  const onChange = vi.fn();
  const render = (value: string) =>
    root.render(
      h(
        'div',
        {},
        h('button', {}, 'Close settings'),
        h(CodeEditor, {
          label: 'Source code',
          language: 'javascript',
          value,
          onChange,
        }),
      ),
    );
  await act(async () => render('const initial = 1;'));
  const close = container.querySelector('button')!;
  close.focus();
  expect(container.querySelector('[role="status"]')?.textContent).toContain(
    'Loading',
  );
  expect(container.querySelector('textarea')).toBeNull();
  await act(async () => render('const updated = 2;\n'));
  await act(async () => {
    resolveEditor(await vi.importActual<EditorModule>(implementation));
    await vi.dynamicImportSettled();
  });
  const textarea = container.querySelector('textarea')!;
  expect(document.activeElement).toBe(close);
  expect(container.querySelector('label')?.htmlFor).toBe(textarea.id);
  expect(textarea.value).toBe('const updated = 2;\n');
  expect(container.querySelector('pre .token.keyword')?.textContent).toBe(
    'const',
  );
  expect(container.querySelector('pre')?.textContent).toBe(
    'const updated = 2;\n',
  );
  textarea.focus();
  await type(textarea, 'const updated = 3;\n');
  expect(onChange).toHaveBeenLastCalledWith('const updated = 3;\n');
  expect(container.querySelector('textarea')).toBe(textarea);
  expect(document.activeElement).toBe(textarea);
});

it('offers safe plain-text editing if the editor chunk cannot load', async () => {
  await act(async () => root.render(h(Draft)));
  await act(async () => {
    rejectEditor(new Error('Offline'));
    await vi.dynamicImportSettled();
  });
  const textarea = container.querySelector('textarea')!;
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.querySelector('label')?.htmlFor).toBe(textarea.id);
  expect(textarea.value).toContain('<img src=x');
  expect(container.querySelector('img')).toBeNull();
  textarea.focus();
  await type(textarea, '<script>still plain text</script>\n');
  expect(textarea.value).toBe('<script>still plain text</script>\n');
  expect(document.activeElement).toBe(textarea);
  expect(container.querySelector('script')).toBeNull();
});

it('does not mount a late editor after the field has unmounted', async () => {
  await act(async () => root.render(h(Draft)));
  await act(async () => root.render(null));
  await act(async () => {
    resolveEditor(await vi.importActual<EditorModule>(implementation));
    await vi.dynamicImportSettled();
  });
  expect(container.childElementCount).toBe(0);
});
