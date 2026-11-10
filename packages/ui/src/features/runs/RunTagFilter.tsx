import { useEffect, useId, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  Anchor,
  Button,
  Code,
  Group,
  Pill,
  Popover,
  Stack,
  Text,
} from '../../design-system';
import { TagFields, tagRows, tagsFromRows, type TagRow } from './RunTags';
import styles from './RunTagFilter.module.css';

type RunTagFilterProps = {
  value?: Record<string, string>;
  onChange: (next?: Record<string, string>) => void;
  /** Pair the trigger and applied filters when they live in separate containers. */
  filterId: string;
};

export function RunTagFilter({ value, onChange, filterId }: RunTagFilterProps) {
  const titleId = useId();
  const source = JSON.stringify(value ?? {});
  const [draft, setDraft] = useState<{
    source: string;
    rows: TagRow[];
    error?: string;
  } | null>(null);
  // A changed URL filter invalidates an open draft before it can be applied.
  const opened = draft !== null && draft.source === source;
  useEffect(() => {
    setDraft((current) =>
      current && current.source !== source ? null : current,
    );
  }, [source]);
  const count = Object.keys(value ?? {}).length;
  return (
    <Popover
      id={filterId}
      opened={opened}
      onChange={(next) => {
        if (!next) setDraft(null);
      }}
      position="bottom-end"
      withinPortal
      trapFocus
      returnFocus
      preventPositionChangeWhenVisible={false}
      middlewares={{
        flip: { padding: 12 },
        shift: { padding: 12 },
        size: { padding: 12 },
      }}
      width="min(480px, calc(100vw - 24px))"
    >
      <Popover.Target>
        <Button
          variant="secondary"
          leftSection={<SlidersHorizontal size={16} />}
          onClick={() =>
            setDraft(opened ? null : { source, rows: tagRows(value) })
          }
        >
          Filter by tags{count ? ` (${count})` : ''}
        </Button>
      </Popover.Target>
      <Popover.Dropdown className={styles.dropdown} aria-labelledby={titleId}>
        <div className={styles.body}>
          <Stack gap="sm">
            <Text id={titleId} fw={600}>
              Filter by tags
            </Text>
            <Text size="sm" c="dimmed">
              Tags are optional key/value metadata added when starting a run.
              Add them under Tags in the Run dialog.
            </Text>
            <Text size="xs" c="dimmed">
              Example: <Code>repo = dgca/interlock</Code>
            </Text>
            <TagFields
              label="Matching tags"
              showLabel={false}
              showFieldLabels
              addLabel="Add condition"
              description="Match every condition exactly, including case and whitespace. Values may be empty. Up to 16 conditions, with 64 characters per key or value."
              rows={opened ? draft.rows : []}
              error={opened ? draft.error : undefined}
              onChange={(rows) => setDraft({ source, rows })}
            />
          </Stack>
        </div>
        <Group className={styles.footer} justify="flex-end" gap="xs">
          <Button variant="secondary" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!opened) return;
              try {
                const next = tagsFromRows(draft.rows);
                setDraft(null);
                onChange(next);
              } catch (error) {
                setDraft({
                  ...draft,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }}
          >
            Apply filters
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}

const displayPart = (value: string) =>
  !value || /\s/.test(value) ? JSON.stringify(value) : value;

export function AppliedRunTagFilters({
  value,
  onChange,
  filterId,
}: RunTagFilterProps) {
  const strip = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<HTMLElement | null>(null);
  const entries = Object.entries(value ?? {});
  useEffect(() => {
    pendingFocus.current?.focus({ preventScroll: true });
    pendingFocus.current = null;
  }, [value]);
  const rememberFocus = (removedKey?: string) => {
    const current = strip.current;
    if (!current?.contains(document.activeElement)) return;
    const removals = [
      ...current.querySelectorAll<HTMLButtonElement>(
        '[data-tag-condition] button',
      ),
    ];
    const index = entries.findIndex(([key]) => key === removedKey);
    pendingFocus.current =
      removedKey !== undefined && entries.length > 1
        ? (removals[index + 1] ?? removals[index - 1])
        : document.getElementById(filterId);
  };
  if (!entries.length) return null;
  return (
    <div
      ref={strip}
      className={styles.applied}
      role="group"
      aria-label="Applied tag filters"
    >
      <Text size="xs" c="dimmed">
        Matching all:
      </Text>
      {entries.map(([key, tagValue]) => {
        const label = `${displayPart(key)} = ${displayPart(tagValue)}`;
        return (
          <Pill
            key={key}
            data-tag-condition
            withRemoveButton
            size="md"
            title={label}
            classNames={{
              root: styles.chip,
              label: styles.chipLabel,
              remove: styles.chipRemove,
            }}
            removeButtonProps={{
              'aria-label': `Remove condition ${label}`,
              'aria-hidden': false,
              tabIndex: 0,
            }}
            onRemove={() => {
              rememberFocus(key);
              const next = entries.filter(([entryKey]) => entryKey !== key);
              onChange(next.length ? Object.fromEntries(next) : undefined);
            }}
          >
            {label}
          </Pill>
        );
      })}
      <Anchor
        component="button"
        type="button"
        size="sm"
        onClick={() => {
          rememberFocus();
          onChange(undefined);
        }}
      >
        Clear all
      </Anchor>
    </div>
  );
}
