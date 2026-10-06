import { ActionIcon, Group, Select, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { ArrowUp, ArrowDown, X } from 'lucide-react';
import {
  composePrompt,
  type SavedPrompt,
  type WorkflowNode,
} from '@interlock/core';

export function PromptPicker({
  node,
  prompts,
  onChange,
}: {
  node: Extract<WorkflowNode, { kind: 'agent' }>;
  prompts: SavedPrompt[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const ids = node.promptIds ?? [];
  const selected = ids.map((id) => prompts.find((p) => p.id === id));
  const move = (index: number, offset: number) => {
    const next = [...ids];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return (
    <Stack gap="sm" mb="md">
      <Select
        label="Saved prompts"
        description="Runs use the latest saved prompts at startup. Each invoked workflow captures independently."
        placeholder="Add a prompt"
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        nothingFoundMessage="No available prompts"
        value={null}
        data={prompts
          .filter((p) => !ids.includes(p.id))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({
            value: p.id,
            label: `${p.name} · ${p.id.slice(0, 8)}`,
          }))}
        onChange={(id) => {
          if (id) onChange([...ids, id]);
          setSearch('');
        }}
      />
      {ids.map((id, i) => (
        <div key={id}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">
              {selected[i]?.name ?? `Missing prompt: ${id}`}
            </Text>
            <Group gap={4} wrap="nowrap">
              <ActionIcon
                variant="subtle"
                aria-label={`Move prompt ${i + 1} up`}
                disabled={!i}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={15} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                aria-label={`Move prompt ${i + 1} down`}
                disabled={i === ids.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={15} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                aria-label={`Remove prompt ${i + 1}`}
                onClick={() => onChange(ids.filter((_, j) => i !== j))}
              >
                <X size={15} />
              </ActionIcon>
            </Group>
          </Group>
          {selected[i] && (
            <details>
              <summary>View instructions</summary>
              <p className="assignment-prompt">{selected[i]!.content}</p>
            </details>
          )}
          {!selected[i] && (
            <Text c="red" size="xs">
              Select an available prompt or remove this reference before
              publishing.
            </Text>
          )}
        </div>
      ))}
      <details>
        <summary>Preview combined instructions</summary>
        {selected.some((p) => !p) ? (
          <Text c="red" size="sm">
            Preview unavailable while saved prompts are missing.
          </Text>
        ) : (
          <p className="assignment-prompt">
            {composePrompt(
              node.prompt,
              selected.filter((p): p is SavedPrompt => !!p),
            )}
          </p>
        )}
      </details>
    </Stack>
  );
}
