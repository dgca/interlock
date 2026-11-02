import { useEffect, useId, useRef, useState } from 'react';
import {
  ActionIcon,
  Combobox,
  Group,
  InputBase,
  Input,
  Loader,
  Text,
  useCombobox,
} from '@mantine/core';
import { RefreshCw } from 'lucide-react';
import type { ExecutorModels } from '@interlock/core';
import { api, errorMessage } from '../../lib/api';

/** Explicit selection keeps search text separate from the saved model ID. */
export function ModelPicker({
  label,
  value,
  onChange,
  profileId,
  paths,
  defaultLabel,
}: {
  label: string;
  value?: string;
  onChange: (model: string | undefined) => void;
  profileId?: string;
  paths?: { command?: string; cwd?: string };
  defaultLabel: string;
}) {
  const [search, setSearch] = useState('');
  const id = useId();
  const [catalog, setCatalog] = useState<ExecutorModels>();
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const key = JSON.stringify([profileId, paths]);
  useEffect(() => {
    sequence.current++;
    setCatalog(undefined);
    setLoading(false);
    return () => {
      sequence.current++;
    };
  }, [key]);
  const load = async (refresh = false) => {
    if (!profileId) return;
    const request = ++sequence.current;
    setLoading(true);
    try {
      const result = await api.executors.models.query({
        profileId,
        paths,
        refresh,
      });
      if (sequence.current === request) setCatalog(result);
    } catch (error) {
      if (sequence.current === request)
        setCatalog({
          status: 'unavailable',
          models: [],
          truncated: false,
          message: errorMessage(error),
        });
    } finally {
      if (sequence.current === request) setLoading(false);
    }
  };
  const combobox = useCombobox({
    onDropdownOpen: () => {
      setSearch('');
      combobox.focusSearchInput();
      if (!catalog && !loading) void load();
    },
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      combobox.focusTarget();
    },
  });
  const models = catalog?.models ?? [];
  const selected = models.find((m) => m.id === value);
  const term = search.trim();
  const matches = models.filter((m) =>
    `${m.name} ${m.id}`.toLowerCase().includes(term.toLowerCase()),
  );
  return (
    <div>
      <Group justify="space-between" gap="xs" wrap="nowrap" mb={4}>
        <Input.Label htmlFor={id} id={`${id}-label`}>
          {label}
        </Input.Label>
        {profileId && (
          <ActionIcon
            size="sm"
            variant="subtle"
            aria-label="Refresh models"
            title="Refresh models"
            disabled={loading}
            onClick={() => void load(true)}
          >
            {loading ? <Loader size={12} /> : <RefreshCw size={13} />}
          </ActionIcon>
        )}
      </Group>
      <Combobox
        store={combobox}
        onOptionSubmit={(option) => {
          onChange(option === '__default' ? undefined : option.slice(6));
          combobox.closeDropdown();
        }}
      >
        <Combobox.Target>
          <InputBase
            component="button"
            type="button"
            id={id}
            aria-labelledby={`${id}-label`}
            pointer
            rightSection={<Combobox.Chevron />}
            rightSectionPointerEvents="none"
            onClick={() => combobox.toggleDropdown()}
            styles={{
              input: {
                textAlign: 'left',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              },
            }}
          >
            {selected?.name ?? value ?? defaultLabel}
          </InputBase>
        </Combobox.Target>
        <Combobox.Dropdown>
          <Combobox.Search
            value={search}
            maxLength={200}
            onChange={(e) => {
              setSearch(e.currentTarget.value);
              combobox.updateSelectedOptionIndex();
            }}
            placeholder="Find or enter a model ID"
            aria-label="Find or enter a model ID"
          />
          <Combobox.Options
            style={{
              maxHeight: 240,
              overflowY: 'auto',
              overflowWrap: 'anywhere',
            }}
          >
            <Combobox.Option value="__default">{defaultLabel}</Combobox.Option>
            {value &&
              !models.some((m) => m.id === value) &&
              (!term || value.toLowerCase().includes(term.toLowerCase())) && (
                <Combobox.Option value={`model:${value}`}>
                  {value}
                  <Text size="xs" c="dimmed">
                    Selected model
                  </Text>
                </Combobox.Option>
              )}
            {matches.map((model) => (
              <Combobox.Option key={model.id} value={`model:${model.id}`}>
                <Text size="sm">{model.name}</Text>
                {model.name !== model.id && (
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    {model.id}
                  </Text>
                )}
              </Combobox.Option>
            ))}
            {term && !models.some((m) => m.id === term) && term !== value && (
              <Combobox.Option value={`model:${term}`}>
                Use custom model: {term}
              </Combobox.Option>
            )}
            {loading && (
              <Combobox.Empty>
                <Loader size="xs" /> Loading models…
              </Combobox.Empty>
            )}
            {!loading && catalog?.status === 'ready' && !models.length && (
              <Combobox.Empty>
                No models reported. You can enter a custom ID.
              </Combobox.Empty>
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
      {(catalog?.status === 'unavailable' ||
        !profileId ||
        catalog?.truncated) && (
        <Text
          size="xs"
          mt={4}
          c={catalog?.status === 'unavailable' ? 'red' : 'dimmed'}
          style={{ overflowWrap: 'anywhere' }}
          role={catalog?.status === 'unavailable' ? 'alert' : undefined}
        >
          {catalog?.status === 'unavailable'
            ? `Models could not be loaded. ${catalog.message ?? ''} Refresh or enter a custom ID.`
            : !profileId
              ? 'Select a harness to browse its models, or enter a custom ID.'
              : 'Showing the first 100 models. Enter an ID to use another.'}
        </Text>
      )}
    </div>
  );
}
