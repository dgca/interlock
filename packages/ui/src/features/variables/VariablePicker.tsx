import { useEffect, useRef, useState } from 'react';
import { Select, Stack, Text } from '@mantine/core';
import { api, errorMessage } from '../../lib/api';
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
  refreshKey = 0,
  showManagement = true,
  required = false,
}: {
  value: string;
  onChange: (id: string, variable?: VariableSummary) => void;
  label?: string;
  kind?: 'secret' | 'config';
  autoFocus?: boolean;
  refreshKey?: number;
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
  const [items, setItems] = useState<VariableSummary[]>([]);
  // An imported reference can resolve to a different local ID. Keep the lookup
  // key with its metadata instead of comparing the resolved ID to the reference.
  const [selection, setSelection] = useState<{
    referenceId: string;
    variable?: VariableSummary;
    error?: string;
  }>();
  const selected =
    selection?.referenceId === value ? selection.variable : undefined;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [focusRefresh, setFocusRefresh] = useState(0);
  useEffect(() => {
    const refresh = () => setFocusRefresh((key) => key + 1);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void api.variables.read
        .query({ action: 'list', search, limit: 100 })
        .then((result) => {
          if (!active || !('items' in result)) return;
          setItems(result.items);
          setTotal(result.total);
          setError('');
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, refreshKey, focusRefresh]);
  useEffect(() => {
    let active = true;
    if (value)
      void api.variables.read
        .query({ action: 'inspect', id: value, limit: 1 })
        .then((r) => {
          if (active && 'dependencies' in r)
            setSelection({ referenceId: value, variable: r });
        })
        .catch((e) => {
          if (active)
            setSelection((previous) => ({
              referenceId: value,
              variable:
                previous?.referenceId === value ? previous.variable : undefined,
              error: errorMessage(e),
            }));
        });
    return () => {
      active = false;
    };
  }, [value, refreshKey, focusRefresh]);
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
  if (value && !options.some((o) => o.value === value))
    options.unshift({
      value,
      label: selected
        ? optionLabel(selected)
        : selection?.referenceId === value && selection.error
          ? 'Variable unavailable'
          : 'Loading variable…',
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
          if (v && variable) setSelection({ referenceId: v, variable });
          onChange(v ?? '', v ? variable : undefined);
          setSearch('');
        }}
        data={options}
        filter={({ options, search }) => {
          const term = search === selectedLabel ? '' : search.toLowerCase();
          return options.filter(
            (option) =>
              'value' in option &&
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
          loading ? 'Loading variables…' : 'No matching variables'
        }
        error={
          (required && !value && selectionInvalid ? selectionError : '') ||
          error ||
          (selection?.referenceId === value && selection.error) ||
          undefined
        }
      />
      {selected && selected.availability !== 'ready' && (
        <Text size="xs" c="yellow">
          {availabilityLabels[selected.availability] ?? 'Value unavailable'}.
          Update it in Variables before starting a run.
        </Text>
      )}
      {total > 100 && (
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
