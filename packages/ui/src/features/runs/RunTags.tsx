import {
  ActionIcon,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
} from '../../design-system';

import { Plus, X } from 'lucide-react';
import { runTagsSchema } from '@interlock/core';
import { useEffect, useId, useRef } from 'react';
import styles from './RunTags.module.css';

export type TagRow = { key: string; value: string };
export const tagRows = (tags?: Record<string, string>): TagRow[] =>
  Object.entries(tags ?? {}).map(([key, value]) => ({ key, value }));

export function tagsFromRows(rows: TagRow[]) {
  if (!rows.length) return undefined;
  if (new Set(rows.map((row) => row.key)).size !== rows.length)
    throw new Error('Each tag key must be unique.');
  const parsed = runTagsSchema.safeParse(
    Object.fromEntries(rows.map(({ key, value }) => [key, value])),
  );
  if (!parsed.success)
    throw new Error(
      'Use up to 16 tags with nonempty keys and at most 64 characters per key or value.',
    );
  return parsed.data;
}

export function TagFields({
  rows,
  onChange,
  label = 'Tags',
  description = 'Up to 16 tags. Keys and values can have at most 64 characters. Values may be empty.',
  error,
  showLabel = true,
}: {
  rows: TagRow[];
  onChange: (rows: TagRow[]) => void;
  label?: string;
  description?: string;
  error?: string;
  showLabel?: boolean;
}) {
  const errorId = useId();
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  return (
    <fieldset
      className={styles.fields}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      {showLabel && <legend>{label}</legend>}
      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          {description}
        </Text>
        {rows.map((row, index) => (
          <Group key={index} gap="xs" wrap="nowrap" align="flex-start">
            <TextInput
              aria-label={`${label} key ${index + 1}`}
              placeholder="Key"
              value={row.key}
              maxLength={64}
              required
              className={styles.field}
              onChange={(event) =>
                onChange(
                  rows.map((item, i) =>
                    i === index
                      ? { ...item, key: event.currentTarget.value }
                      : item,
                  ),
                )
              }
            />
            <TextInput
              aria-label={`${label} value ${index + 1}`}
              placeholder="Value"
              value={row.value}
              maxLength={64}
              className={styles.field}
              onChange={(event) =>
                onChange(
                  rows.map((item, i) =>
                    i === index
                      ? { ...item, value: event.currentTarget.value }
                      : item,
                  ),
                )
              }
            />
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              <X size={16} />
            </ActionIcon>
          </Group>
        ))}
        <Group>
          <Button
            variant="ghost"
            leftSection={<Plus size={14} />}
            disabled={rows.length >= 16}
            onClick={() => onChange([...rows, { key: '', value: '' }])}
          >
            Add tag
          </Button>
        </Group>
        {error && (
          <Text
            id={errorId}
            ref={errorRef}
            tabIndex={-1}
            size="xs"
            c="red"
            role="alert"
          >
            {error}
          </Text>
        )}
      </Stack>
    </fieldset>
  );
}

export function RunTags({
  tags,
  compact = false,
}: {
  tags?: Record<string, string>;
  compact?: boolean;
}) {
  const entries = Object.entries(tags ?? {});
  if (!entries.length) return null;
  return (
    <span
      className={`${styles.tags} ${compact ? styles.compact : ''}`}
      aria-label="Run tags"
    >
      {(compact ? entries.slice(0, 2) : entries).map(([key, value]) => (
        <span className={styles.tag} key={key} title={`${key}=${value}`}>
          {key}={value}
        </span>
      ))}
      {compact && entries.length > 2 && (
        <span
          title={entries
            .slice(2)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')}
        >
          +{entries.length - 2} tags
        </span>
      )}
    </span>
  );
}
