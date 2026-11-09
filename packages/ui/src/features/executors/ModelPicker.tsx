import {
  LoadingSkeleton,
  ActionIcon,
  Button,
  Combobox,
  Group,
  InputBase,
  Input,
  Loader,
  Text,
  useCombobox,
} from '../../design-system';

import { useEffect, useId, useRef, useState } from 'react';

import { RefreshCw } from 'lucide-react';
import type { ExecutorModels, SavedModelAlias } from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import { readModelAliases, resolveModelAlias } from './modelAliasApi';

/** Explicit selection keeps search text separate from the saved model ID. */
export function ModelPicker({
  label,
  value,
  onChange,
  profileId,
  paths,
  defaultLabel,
  disabled = false,
  onCatalog,
  loadCapabilities = false,
  allowAliases = false,
  inheritedValue,
  onAlias,
}: {
  label: string;
  value?: string;
  onChange: (model: string | undefined) => void;
  profileId?: string;
  paths?: { command?: string; cwd?: string };
  defaultLabel: string;
  disabled?: boolean;
  onCatalog?: (catalog: ExecutorModels | undefined) => void;
  loadCapabilities?: boolean;
  allowAliases?: boolean;
  inheritedValue?: string;
  onAlias?: (alias: SavedModelAlias | null | undefined) => void;
}) {
  const [search, setSearch] = useState('');
  const [alias, setAlias] = useState<SavedModelAlias | null>();
  const [aliases, setAliases] =
    useState<Awaited<ReturnType<typeof readModelAliases>>>();
  const [aliasError, setAliasError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [aliasReload, setAliasReload] = useState(0);
  const reference = value ?? inheritedValue;
  useEffect(() => {
    let current = true;
    setAlias(undefined);
    onAlias?.(undefined);
    setReferenceError('');
    if (!allowAliases || !reference) {
      setAlias(null);
      onAlias?.(null);
      return;
    }
    void resolveModelAlias(reference).then(
      (result) => {
        if (current) {
          setAlias(result);
          onAlias?.(result);
        }
      },
      (error) => {
        if (current) setReferenceError(errorMessage(error));
      },
    );
    return () => {
      current = false;
    };
  }, [allowAliases, reference, aliasReload, onAlias]);
  const id = useId();
  const [catalog, setCatalog] = useState<ExecutorModels>();
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const key = JSON.stringify([profileId, paths]);
  useEffect(() => {
    sequence.current++;
    setCatalog(undefined);
    onCatalog?.(undefined);
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
      if (sequence.current === request) {
        setCatalog(result);
        onCatalog?.(result);
      }
    } catch (error) {
      if (sequence.current === request) {
        const failed: ExecutorModels = {
          status: 'unavailable',
          models: [],
          truncated: false,
          message: errorMessage(error),
        };
        setCatalog(failed);
        onCatalog?.(failed);
      }
    } finally {
      if (sequence.current === request) setLoading(false);
    }
  };
  useEffect(() => {
    if (
      loadCapabilities &&
      profileId &&
      !catalog &&
      !loading &&
      (!allowAliases || alias === null)
    )
      void load();
  }, [key, loadCapabilities, allowAliases, alias]);
  const combobox = useCombobox({
    onDropdownOpen: () => {
      if (allowAliases) setAliasReload((n) => n + 1);
      setSearch('');
      combobox.focusSearchInput();
      if (!catalog && !loading) void load();
    },
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      combobox.focusTarget();
    },
  });
  useEffect(() => {
    if (!allowAliases || !combobox.dropdownOpened) return;
    let current = true;
    setAliases(undefined);
    setAliasError('');
    // Literal model IDs can be longer than alias names and alias searches.
    if (search.length > 120) {
      setAliases({
        items: [],
        total: 0,
        offset: 0,
        limit: 25,
        truncated: false,
      });
      return;
    }
    const timer = window.setTimeout(
      () => {
        void readModelAliases({ search, limit: 25 }).then(
          (result) => {
            if (current) setAliases(result);
          },
          (error) => {
            if (current) setAliasError(errorMessage(error));
          },
        );
      },
      search ? 180 : 0,
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [allowAliases, combobox.dropdownOpened, search, aliasReload]);
  const aliasChoices = [
    ...(alias &&
    !aliases?.items.some((item) => item.id === alias.id) &&
    (!search || alias.name.toLowerCase().includes(search.toLowerCase()))
      ? [alias]
      : []),
    ...(aliases?.items ?? []),
  ];
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
            variant="subtle"
            aria-label="Refresh models"
            title="Refresh models"
            disabled={disabled || loading}
            onClick={() => void load(true)}
          >
            {loading ? <Loader size={12} /> : <RefreshCw size={13} />}
          </ActionIcon>
        )}
      </Group>
      <Combobox
        store={combobox}
        onOptionSubmit={(option) => {
          if (disabled) return;
          onChange(option === '__default' ? undefined : option.slice(6));
          combobox.closeDropdown();
        }}
      >
        <Combobox.Target>
          <InputBase
            component="button"
            disabled={disabled}
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
            {value && alias
              ? `${alias.name} · model alias`
              : (selected?.name ?? value ?? defaultLabel)}
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
              !alias &&
              !models.some((m) => m.id === value) &&
              (!term || value.toLowerCase().includes(term.toLowerCase())) && (
                <Combobox.Option value={`model:${value}`}>
                  {value}
                  <Text size="xs" c="dimmed">
                    Selected model
                  </Text>
                </Combobox.Option>
              )}
            {allowAliases && (
              <Combobox.Group label="Model aliases">
                {aliasChoices.map((item) => (
                  <Combobox.Option key={item.id} value={`alias:${item.id}`}>
                    <Text size="sm">{item.name}</Text>
                    <Text size="xs" c="dimmed">
                      {item.candidates[0]?.model ?? 'Not configured'} ·{' '}
                      {item.candidates.length} choice
                      {item.candidates.length === 1 ? '' : 's'}
                    </Text>
                  </Combobox.Option>
                ))}
              </Combobox.Group>
            )}
            <Combobox.Group label={allowAliases ? 'Harness models' : undefined}>
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
            </Combobox.Group>
            {term &&
              !aliases?.items.some(
                (item) => item.name.toLowerCase() === term.toLowerCase(),
              ) &&
              !models.some((m) => m.id === term) &&
              term !== value && (
                <Combobox.Option value={`model:${term}`}>
                  Use custom model: {term}
                </Combobox.Option>
              )}
            {allowAliases && !aliases && !aliasError && (
              <Combobox.Empty>Loading model aliases…</Combobox.Empty>
            )}
            {aliases?.truncated && (
              <Combobox.Empty>
                Showing 25 aliases. Refine your search to find another.
              </Combobox.Empty>
            )}
            {loading && (
              <Combobox.Empty>
                <LoadingSkeleton label="Loading models…" />
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
      {allowAliases && (aliasError || referenceError) && (
        <Text size="xs" c="red" role="alert">
          Model aliases could not be loaded. {aliasError || referenceError}{' '}
          <Button variant="ghost" onClick={() => setAliasReload((n) => n + 1)}>
            Retry aliases
          </Button>
        </Text>
      )}
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
