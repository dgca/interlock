import { Combobox, TextInput, useCombobox } from '@mantine/core';
import { useLayoutEffect, useRef, useState } from 'react';
import { contractAtPath, contractPaths, type Contract } from '@interlock/core';

type Token = {
  pathStart: number;
  pathEnd: number;
  closingLength: number;
  query: string;
};

/** Find the input token whose path is being edited at the cursor. */
export function activeInputToken(url: string, cursor: number): Token | null {
  const openings = /\{\{\s*input\./g;
  for (const opening of url.matchAll(openings)) {
    const pathStart = opening.index + opening[0].length;
    if (cursor < pathStart) break;
    let pathEnd = pathStart;
    while (pathEnd < url.length && /[\w$.]/.test(url[pathEnd])) pathEnd++;
    if (cursor > pathEnd) continue;
    const closingLength = url.slice(pathEnd).match(/^\s*\}\}/)?.[0].length ?? 0;
    return {
      pathStart,
      pathEnd,
      closingLength,
      query: url.slice(pathStart, cursor),
    };
  }
  return null;
}

export function urlInputPaths(schema: Contract): string[] {
  const validPath = /^(?:[A-Za-z_$][\w$]*|\d+)(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/;
  const paths = contractPaths(schema).filter((path) => validPath.test(path));
  const rank = (path: string) => {
    const field = contractAtPath(schema, path);
    if (field.type === 'object' || field.type === 'array') return 2;
    if (Array.isArray(field.type))
      return field.type.every((type) =>
        ['string', 'number', 'integer', 'boolean', 'null'].includes(type),
      )
        ? 0
        : 2;
    if (Array.isArray(field.enum))
      return field.enum.every(
        (value) => value === null || typeof value !== 'object',
      )
        ? 0
        : 2;
    return ['string', 'number', 'integer', 'boolean', 'null'].includes(
      String(field.type),
    )
      ? 0
      : 1;
  };
  return paths
    .filter((path) => rank(path) === 0)
    .concat(paths.filter((path) => rank(path) === 1));
}

export function completeInputToken(url: string, token: Token, path: string) {
  const value =
    url.slice(0, token.pathStart) +
    path +
    (token.closingLength ? '' : '}}') +
    url.slice(token.pathEnd);
  return {
    value,
    cursor: token.pathStart + path.length + (token.closingLength || 2),
  };
}

export function FetchUrlInput({
  value,
  onChange,
  schema,
  suggestionSource,
}: {
  value: string;
  onChange: (value: string) => void;
  schema: Contract;
  suggestionSource?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pendingCursor = useRef<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });
  const token = cursor === null ? null : activeInputToken(value, cursor);
  const paths = urlInputPaths(schema);
  const matches = token
    ? paths.filter((path) =>
        path.toLowerCase().includes(token.query.toLowerCase()),
      )
    : [];
  const visible = matches.slice(0, 50);

  useLayoutEffect(() => {
    if (pendingCursor.current === null) return;
    input.current?.focus();
    input.current?.setSelectionRange(
      pendingCursor.current,
      pendingCursor.current,
    );
    setCursor(pendingCursor.current);
    pendingCursor.current = null;
  }, [value]);

  const updateCursor = (element: HTMLInputElement) => {
    const next = element.selectionStart;
    setCursor(next);
    if (next !== null && activeInputToken(element.value, next) && paths.length)
      combobox.openDropdown();
    else combobox.closeDropdown();
  };

  return (
    <Combobox
      store={combobox}
      withinPortal={false}
      width="target"
      position="bottom-start"
      onOptionSubmit={(path) => {
        const current = input.current;
        const active = current && activeInputToken(value, cursor ?? -1);
        if (!active) return;
        const completed = completeInputToken(value, active, path);
        if (completed.value === value) {
          current.focus();
          current.setSelectionRange(completed.cursor, completed.cursor);
          setCursor(completed.cursor);
        } else {
          pendingCursor.current = completed.cursor;
          onChange(completed.value);
        }
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target>
        <TextInput
          ref={input}
          mb="xs"
          label="URL"
          placeholder="https://api.example.com/customers/{{input.customerId}}"
          value={value}
          onChange={(event) => {
            onChange(event.currentTarget.value);
            updateCursor(event.currentTarget);
          }}
          onFocus={(event) => updateCursor(event.currentTarget)}
          onClick={(event) => updateCursor(event.currentTarget)}
          onKeyUp={(event) => updateCursor(event.currentTarget)}
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options style={{ maxHeight: 240, overflowY: 'auto' }}>
          {visible.length > 0 && (
            <Combobox.Group
              label={
                suggestionSource
                  ? `Fields from ${suggestionSource.toLowerCase()}`
                  : 'Suggested fields'
              }
            >
              {visible.map((path) => (
                <Combobox.Option key={path} value={path}>
                  {path}
                </Combobox.Option>
              ))}
            </Combobox.Group>
          )}
          {matches.length > visible.length && (
            <Combobox.Empty>First 50 matches. Type to narrow.</Combobox.Empty>
          )}
          {matches.length === 0 && (
            <Combobox.Empty>No matching fields</Combobox.Empty>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
