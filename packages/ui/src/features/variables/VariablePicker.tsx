import { useEffect, useState } from 'react';
import { Select, Stack, Text } from '@mantine/core';
import { api, errorMessage } from '../../lib/api';
import { paths } from '../../routes/paths';
import type { SavedVariable, ScriptEnvironment } from '@interlock/core';
import { TextInput, Group } from '@mantine/core';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/Button/Button';

type Summary = SavedVariable & { availability: string };
export function VariablePicker({
  value,
  onChange,
  label = 'Variable',
  kind,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  kind?: 'secret' | 'config';
}) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<Summary>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
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
  }, [search]);
  useEffect(() => {
    let active = true;
    setSelected(undefined);
    if (value)
      void api.variables.read
        .query({ action: 'inspect', id: value, limit: 1 })
        .then((r) => {
          if (active && 'dependencies' in r) setSelected(r);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [value]);
  const options = items
    .filter((v) => !kind || v.kind === kind)
    .map((v) => ({
      value: v.id,
      label: `${v.name} · ${v.kind === 'secret' ? 'Secret' : 'Config'}${v.availability !== 'ready' ? ` · ${v.availability}` : ''}`,
    }));
  if (value && !options.some((o) => o.value === value))
    options.unshift({
      value,
      label: selected
        ? `${selected.name} · ${selected.kind === 'secret' ? 'Secret' : 'Config'}${selected.availability !== 'ready' ? ` · ${selected.availability}` : ''}`
        : `Missing variable: ${value}`,
    });
  return (
    <Stack gap={5}>
      <Select
        allowDeselect={false}
        label={label}
        searchable
        clearable
        clearButtonProps={{ 'aria-label': `Clear ${label.toLowerCase()}` }}
        value={value || null}
        onSearchChange={(term) =>
          setSearch(
            term === options.find((o) => o.value === value)?.label ? '' : term,
          )
        }
        onChange={(v) => {
          onChange(v ?? '');
          setSearch('');
        }}
        data={options}
        placeholder="Select a variable"
        nothingFoundMessage={
          loading ? 'Loading variables…' : 'No matching variables'
        }
        error={error || undefined}
      />
      {selected && selected.availability !== 'ready' && (
        <Text size="xs" c="yellow">
          This value is {selected.availability}. Update it in Variables before
          starting a run.
        </Text>
      )}
      {total > 100 && (
        <Text size="xs" c="dimmed">
          Showing 100 results. Refine your search.
        </Text>
      )}
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
    </Stack>
  );
}

export function EnvironmentEditor({
  value = [],
  onChange,
}: {
  value?: ScriptEnvironment;
  onChange: (value: ScriptEnvironment | undefined) => void;
}) {
  const update = (next: ScriptEnvironment) =>
    onChange(next.length ? next : undefined);
  return (
    <Stack gap="sm" mt="lg">
      <Group justify="space-between">
        <Text size="sm" fw={550}>
          Environment
        </Text>
        <Button
          variant="ghost"
          onClick={() => update([...value, { name: '', variableId: '' }])}
        >
          <Plus size={14} />
          Add variable
        </Button>
      </Group>
      {value.map((entry, index) => (
        <Stack key={index} gap="xs" pb="sm">
          <Group wrap="nowrap" align="end">
            <TextInput
              style={{ flex: 1 }}
              label="Environment name"
              value={entry.name}
              placeholder="SERVICE_API_TOKEN"
              onChange={(e) =>
                update(
                  value.map((v, i) =>
                    i === index ? { ...v, name: e.target.value } : v,
                  ),
                )
              }
            />
            <Button
              variant="ghost"
              aria-label={`Remove environment variable ${index + 1}`}
              onClick={() => update(value.filter((_, i) => i !== index))}
            >
              <Trash2 size={14} />
            </Button>
          </Group>
          <VariablePicker
            value={entry.variableId}
            onChange={(variableId) =>
              update(
                value.map((v, i) => (i === index ? { ...v, variableId } : v)),
              )
            }
          />
        </Stack>
      ))}
      {!!value.length && (
        <Text size="xs" c="dimmed">
          Only selected values are added to this process. Secret output is
          redacted before it enters run history.
        </Text>
      )}
    </Stack>
  );
}
