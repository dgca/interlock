import { useState } from 'react';
import {
  commandPatternError,
  type PermissionPolicy,
  type PermissionRule,
} from '@interlock/core';
import {
  Checkbox,
  Stack,
  TagsInput,
  Text,
  Textarea,
} from '../../design-system';

const commandsOf = (policy?: PermissionPolicy) =>
  (policy?.allow ?? []).flatMap((rule) =>
    rule.kind === 'command' ? [rule.pattern] : [],
  );

/** Actions managed Agent sessions take without asking, inside the run workspace. */
export function PermissionPolicySettings({
  value,
  onChange,
}: {
  value?: PermissionPolicy;
  onChange: (policy: PermissionPolicy | undefined) => void;
}) {
  const rules = value?.allow ?? [];
  const has = (kind: 'read' | 'edit') => rules.some((r) => r.kind === kind);
  const tools = rules.flatMap((r) => (r.kind === 'tool' ? [r.name] : []));
  const [commands, setCommands] = useState(() => commandsOf(value).join('\n'));
  const patterns = commands
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const errors = patterns.flatMap((pattern) => {
    const error = commandPatternError(pattern);
    return error ? [`${pattern}: ${error}`] : [];
  });
  const save = (next: {
    read?: boolean;
    edit?: boolean;
    commands?: string[];
    tools?: string[];
  }) => {
    const allow: PermissionRule[] = [
      ...((next.read ?? has('read')) ? [{ kind: 'read' as const }] : []),
      ...((next.edit ?? has('edit')) ? [{ kind: 'edit' as const }] : []),
      ...(next.commands ?? patterns).map((pattern) => ({
        kind: 'command' as const,
        pattern,
      })),
      ...(next.tools ?? tools).map((name) => ({ kind: 'tool' as const, name })),
    ];
    onChange(allow.length ? { allow } : undefined);
  };
  return (
    <Stack gap="sm" mb="md">
      <Stack gap={4}>
        <Text size="sm" fw={550}>
          Permission policy
        </Text>
        <Text size="xs" c="dimmed">
          Managed Agent sessions with standard permissions take these actions
          without asking, inside the run workspace only. Anything else still
          asks in Review.
        </Text>
      </Stack>
      <Checkbox
        label="Read files in the workspace"
        checked={has('read')}
        onChange={(event) => save({ read: event.currentTarget.checked })}
      />
      <Checkbox
        label="Create and edit files in the workspace"
        checked={has('edit')}
        onChange={(event) => save({ edit: event.currentTarget.checked })}
      />
      <Textarea
        label="Commands"
        description="One pattern per line, such as git status or pnpm test *. A final * allows further arguments whose paths stay in the workspace. Commands joined with &&, ; or | must each match."
        autosize
        minRows={2}
        value={commands}
        error={errors.length ? errors.join('\n') : undefined}
        onChange={(event) => {
          const text = event.currentTarget.value;
          setCommands(text);
          save({
            commands: text
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean),
          });
        }}
      />
      <TagsInput
        label="Tools"
        description="Claude Code or Pi tool names, such as WebSearch. Codex asks instead."
        placeholder="Add a tool name"
        value={tools}
        acceptValueOnBlur
        onChange={(names) =>
          save({
            tools: [...new Set(names.map((n) => n.trim()).filter(Boolean))],
          })
        }
      />
    </Stack>
  );
}
