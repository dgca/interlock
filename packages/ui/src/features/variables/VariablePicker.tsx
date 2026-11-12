import { LoadingSkeleton, Select, Stack, Text } from '../../design-system';

import { useEffect, useRef, useState } from 'react';

import { errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import type { SavedVariable } from '@interlock/core';
import styles from './VariablePicker.module.css';

export type VariableSummary = SavedVariable & { availability: string };
const availabilityLabels: Record<string, string> = {
  unset: 'Value not set',
  disabled: 'Use disabled',
  locked: 'Value locked',
};
function optionLabel(variable: VariableSummary) {
  return `${variable.name} · ${variable.kind === 'secret' ? 'Secret' : 'Config'}${variable.availability !== 'ready' ? ` · ${availabilityLabels[variable.availability] ?? 'Unavailable'}` : ''}`;
}
export function VariablePicker({
  value,
  onChange,
  label = 'Variable',
  kind,
  autoFocus,
  showManagement = true,
  required = false,
}: {
  value: string;
  onChange: (id: string, variable?: VariableSummary) => void;
  label?: string;
  kind?: 'secret' | 'config';
  autoFocus?: boolean;
  showManagement?: boolean;
  required?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selectionInvalid, setSelectionInvalid] = useState(false);
  const selectionError = 'Choose a saved variable or remove this entry.';
  useEffect(() => {
    input.current?.setCustomValidity(required && !value ? selectionError : '');
  }, [required, value]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  const list = useQuery({
    ...trpc.variables.read.queryOptions({ action: 'list', search, limit: 100 }),
    enabled: search === debouncedSearch,
    select: (page) => {
      if (!('items' in page)) throw new Error('Could not read variables.');
      return page;
    },
  });
  const detail = useQuery({
    ...trpc.variables.read.queryOptions({
      action: 'inspect',
      id: value,
      limit: 1,
    }),
    enabled: Boolean(value),
    select: (variable) => {
      if (!('dependencies' in variable))
        throw new Error('Could not read the selected variable.');
      return variable;
    },
  });
  const items = list.data?.items ?? [];
  // A selected option can keep its label while its exact reference read settles.
  const [selection, setSelection] = useState<VariableSummary>();
  const selected =
    detail.data ??
    (selection?.id === value ? selection : undefined) ??
    items.find((item) => item.id === value);
  const error = list.error ?? detail.error;
  const metadataFor = (id: string) =>
    items.find((item) => item.id === id) ??
    (id === value ? selected : undefined);
  const options = items
    .filter((v) => !kind || v.kind === kind)
    .map((v) => ({
      value: v.id,
      label: optionLabel(v),
      description: v.description,
    }));
  const selectedOutsideResults =
    Boolean(value) && !options.some((option) => option.value === value);
  if (selectedOutsideResults)
    options.unshift({
      value,
      label: selected
        ? optionLabel(selected)
        : detail.error
          ? 'Variable unavailable'
          : 'Selected variable',
      description: selected?.description ?? '',
    });
  const selectedLabel = options.find((option) => option.value === value)?.label;
  return (
    <Stack gap={5}>
      <Select
        ref={input}
        required={required}
        onInvalid={() => setSelectionInvalid(true)}
        classNames={{
          root: styles.root,
          input: styles.input,
          section: styles.section,
        }}
        allowDeselect={false}
        autoFocus={autoFocus}
        defaultDropdownOpened={autoFocus}
        aria-busy={list.isFetching || undefined}
        label={label}
        searchable
        clearable
        clearButtonProps={{
          'aria-label': `Clear ${label.toLowerCase()}`,
          'aria-hidden': false,
          tabIndex: 0,
          className: styles.clearButton,
        }}
        onClear={() => input.current?.focus()}
        value={value || null}
        onSearchChange={(term) => setSearch(term === selectedLabel ? '' : term)}
        onChange={(v) => {
          const variable = v ? metadataFor(v) : undefined;
          if (v && variable) setSelection(variable);
          onChange(v ?? '', v ? variable : undefined);
          setSearch('');
        }}
        data={options}
        filter={({ options, search }) => {
          const term = search === selectedLabel ? '' : search.toLowerCase();
          return options.filter(
            (option) =>
              'value' in option &&
              (!term || !selectedOutsideResults || option.value !== value) &&
              `${option.label} ${metadataFor(option.value)?.description ?? ''}`
                .toLowerCase()
                .includes(term),
          );
        }}
        renderOption={({ option }) => {
          const description = metadataFor(option.value)?.description;
          return (
            <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              <Text size="sm">{option.label}</Text>
              {description && (
                <Text size="xs" c="dimmed">
                  {description}
                </Text>
              )}
            </div>
          );
        }}
        placeholder="Select a variable"
        nothingFoundMessage={
          list.isPending ? (
            <LoadingSkeleton label="Loading variables…" />
          ) : list.error ? (
            'Could not load variables'
          ) : (
            'No matching variables'
          )
        }
        error={
          (required && !value && selectionInvalid ? selectionError : '') ||
          (error ? errorMessage(error) : undefined)
        }
      />
      {selected && selected.availability !== 'ready' && (
        <Text size="xs" c="yellow">
          {availabilityLabels[selected.availability] ?? 'Value unavailable'}.
          Update it in Variables before starting a run.
        </Text>
      )}
      {list.data?.truncated && (
        <Text size="xs" c="dimmed">
          Showing 100 results. Refine your search.
        </Text>
      )}
      {showManagement && (
        <Text size="xs">
          <a
            href={
              value && selected ? paths.variable(selected.id) : paths.variables
            }
            target="_blank"
            rel="noreferrer"
          >
            Manage variables
          </a>
        </Text>
      )}
    </Stack>
  );
}
