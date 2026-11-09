import {
  ActionIcon,
  Anchor,
  Code,
  Group,
  Stack,
  Text,
  TextInput,
  Button,
} from '../../design-system';

import { useEffect, useRef, useState } from 'react';

import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { ScriptEnvironment } from '@interlock/core';

import { paths } from '../../routes/paths';
import { VariablePicker, type VariableSummary } from './VariablePicker';
import styles from './EnvironmentEditor.module.css';

const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/;
type Entry = ScriptEnvironment[number];

function EnvironmentRow({
  entry,
  otherNames,
  language,
  refreshKey,
  onChange,
  onRemove,
}: {
  entry: Entry;
  otherNames: string[];
  language?: 'javascript' | 'bash';
  refreshKey: number;
  onChange: (entry: Entry) => void;
  onRemove: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [suggestedName, setSuggestedName] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const error = !entry.name
    ? 'Enter the environment name your script will use.'
    : !environmentName.test(entry.name)
      ? 'Use letters, digits and underscores. Start with a letter or underscore.'
      : otherNames.includes(entry.name)
        ? 'This environment name is already used in this script. Choose another name.'
        : '';
  const showName = editingName || (!!entry.variableId && !!error);
  useEffect(() => {
    nameInput.current?.setCustomValidity(error);
  }, [error, showName]);
  const choose = (variableId: string, variable?: VariableSummary) => {
    setSuggestedName(false);
    let name = entry.name;
    // Derive a name only when first configuring the mapping. Source replacement
    // and central renames must never rewrite a key an existing script relies on.
    if (!name && variable) {
      name = variable.name.replace(/[^A-Za-z0-9_]/g, '_');
      setSuggestedName(name !== variable.name);
      if (name !== variable.name || otherNames.includes(name))
        setEditingName(true);
    }
    onChange({ name, variableId });
  };
  return (
    <Stack gap="xs" className={styles.row}>
      <div className={styles.selection}>
        <VariablePicker
          value={entry.variableId}
          onChange={choose}
          autoFocus={!entry.variableId}
          refreshKey={refreshKey}
          showManagement={false}
          required
        />
        <ActionIcon
          size={36}
          variant="subtle"
          color="gray"
          aria-label={`Remove ${entry.name || 'environment variable'}`}
          onClick={onRemove}
        >
          <Trash2 size={16} />
        </ActionIcon>
      </div>
      {entry.name && !error && (
        <Text size="xs" c="dimmed" className={styles.access}>
          Available as{' '}
          <Code>
            {language === 'javascript'
              ? `process.env.${entry.name}`
              : `$${entry.name}`}
          </Code>
        </Text>
      )}
      {showName ? (
        <TextInput
          ref={nameInput}
          label="Use in script as"
          description={
            suggestedName
              ? 'The saved name contains characters environment names cannot use. Confirm or edit this suggestion before applying.'
              : undefined
          }
          value={entry.name}
          maxLength={120}
          required
          pattern="[A-Za-z_][A-Za-z0-9_]*"
          error={error || undefined}
          styles={{ description: { lineHeight: 1.4 } }}
          onChange={(event) => {
            setEditingName(true);
            onChange({ ...entry, name: event.currentTarget.value });
          }}
        />
      ) : entry.name ? (
        <Anchor
          component="button"
          type="button"
          size="xs"
          className={styles.changeName}
          onClick={() => {
            setEditingName(true);
            requestAnimationFrame(() => nameInput.current?.focus());
          }}
        >
          Change environment name
        </Anchor>
      ) : null}
    </Stack>
  );
}

export function EnvironmentEditor({
  value = [],
  language,
  polling = false,
  onChange,
}: {
  value?: ScriptEnvironment;
  language?: 'javascript' | 'bash';
  polling?: boolean;
  onChange: (value: ScriptEnvironment | undefined) => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const keys = useRef(new WeakMap<Entry, number>());
  const nextKey = useRef(0);
  const keyFor = (entry: Entry) => {
    if (!keys.current.has(entry)) keys.current.set(entry, nextKey.current++);
    return keys.current.get(entry)!;
  };
  const update = (next: ScriptEnvironment) =>
    onChange(next.length ? next : undefined);
  return (
    <Stack gap="sm" mt="lg">
      <Group justify="space-between" gap="xs">
        <Text size="sm" fw={550}>
          Environment variables
        </Text>
        <Button
          variant="ghost"
          className={styles.action}
          onClick={() => update([...value, { name: '', variableId: '' }])}
        >
          <Plus size={14} />
          Add variable
        </Button>
      </Group>
      {!value.length && (
        <Text size="xs" c="dimmed">
          Add saved variables to make their values available to this script.
        </Text>
      )}
      {value.map((entry, index) => (
        <EnvironmentRow
          key={keyFor(entry)}
          entry={entry}
          otherNames={value.filter((_, i) => i !== index).map((v) => v.name)}
          language={language}
          refreshKey={refreshKey}
          onChange={(next) => {
            keys.current.set(next, keyFor(entry));
            update(value.map((v, i) => (i === index ? next : v)));
          }}
          onRemove={() => update(value.filter((_, i) => i !== index))}
        />
      ))}
      <Group gap="sm">
        <Anchor
          className={styles.manage}
          href={paths.variables}
          target="_blank"
          rel="noreferrer"
          size="xs"
        >
          Manage variables
        </Anchor>
        {!!value.length && (
          <Button
            variant="ghost"
            className={styles.action}
            onClick={() => setRefreshKey((key) => key + 1)}
          >
            <RefreshCw size={14} />
            Refresh variables
          </Button>
        )}
      </Group>
      {!!value.length && (
        <Text size="xs" c="dimmed">
          Secret output is redacted before it enters run history.
        </Text>
      )}
      <details className={styles.access}>
        <summary>Execution context</summary>
        <Stack gap="xs">
          <Text size="xs">
            Read the current run ID with{' '}
            <Code>
              {language === 'javascript'
                ? 'process.env.INTERLOCK_RUN_ID'
                : '$INTERLOCK_RUN_ID'}
            </Code>
            .
          </Text>
          <Text size="xs">
            <Code>INTERLOCK_ROOT_RUN_ID</Code> identifies the outermost run.
            <br />
            <Code>INTERLOCK_WORKFLOW_ID</Code> and{' '}
            <Code>INTERLOCK_WORKFLOW_VERSION</Code> identify the published
            workflow.
          </Text>
          <Text size="xs">
            <Code>INTERLOCK_NODE_ID</Code> identifies the step.{' '}
            <Code>INTERLOCK_EXECUTION_ID</Code> changes on each visit or retry.{' '}
            <Code>INTERLOCK_ATTEMPT</Code> starts at 1 and increases on retry.
          </Text>
          <Text size="xs">
            Batch items also get <Code>INTERLOCK_BATCH_OWNER_RUN_ID</Code> and{' '}
            <Code>INTERLOCK_BATCH_ITEM_INDEX</Code>. The first item is index 0.
          </Text>
          {polling && (
            <Text size="xs">
              <Code>INTERLOCK_POLL_CHECK_NUMBER</Code> counts checks within this
              Wait attempt, starting at 1.
            </Text>
          )}
          <Text size="xs" c="dimmed">
            Use different names for saved variable bindings to read these
            values.
          </Text>
        </Stack>
      </details>
    </Stack>
  );
}
