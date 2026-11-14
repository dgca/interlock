import { Plus, X } from 'lucide-react';
import type { BoardScope, BoardType, WorkflowBoard } from '@interlock/core';
import {
  ActionIcon,
  Button,
  Group,
  MultiSelect,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
} from '../../design-system';
import classes from './Boards.module.css';

export type TypedScope = {
  workflowIds: string[];
  tags: string[];
  systems: string[];
  mappings: { key: string; workflowId: string; from: string; to: string }[];
};

export function typedScope(board?: Partial<WorkflowBoard>): TypedScope {
  return {
    workflowIds: board?.scope?.workflowIds ?? [],
    tags: Object.entries(board?.scope?.tags ?? {}).map(
      ([key, value]) => `${key}=${value}`,
    ),
    systems: board?.scope?.systems ?? [],
    mappings: Object.entries(board?.stageMap ?? {}).flatMap(
      ([workflowId, stages]) =>
        Object.entries(stages).map(([from, to]) => ({
          key: `${workflowId}:${from}`,
          workflowId,
          from,
          to,
        })),
    ),
  };
}

/** The saved scope and stage map, or an error for a malformed tag. */
export function savedScope(draft: TypedScope) {
  const tags: Record<string, string> = {};
  for (const tag of draft.tags) {
    const equals = tag.indexOf('=');
    if (equals < 1) return { error: `Use key=value for the tag "${tag}".` };
    tags[tag.slice(0, equals)] = tag.slice(equals + 1);
  }
  const scope: BoardScope = {
    ...(draft.workflowIds.length && { workflowIds: draft.workflowIds }),
    ...(draft.tags.length && { tags }),
    ...(draft.systems.length && { systems: draft.systems }),
  };
  const stageMap: Record<string, Record<string, string>> = {};
  for (const { workflowId, from, to } of draft.mappings)
    if (workflowId && from.trim() && to)
      (stageMap[workflowId] ??= {})[from.trim()] = to;
  return { scope, stageMap };
}

export function TypedBoardFields({
  type,
  draft,
  workflows,
  disabled,
  onChange,
}: {
  type?: Pick<BoardType, 'lanes'>;
  draft: TypedScope;
  workflows: { id: string; name: string }[];
  disabled: boolean;
  onChange: (draft: TypedScope) => void;
}) {
  const stages = [
    ...new Set(
      type?.lanes.flatMap((lane) =>
        (lane.match ?? []).flatMap((rule) => rule.stages ?? []),
      ),
    ),
  ];
  const workflowChoices = workflows.map((workflow) => ({
    value: workflow.id,
    label: workflow.name,
  }));
  const setMapping = (
    key: string,
    patch: Partial<TypedScope['mappings'][number]>,
  ) =>
    onChange({
      ...draft,
      mappings: draft.mappings.map((item) =>
        item.key === key ? { ...item, ...patch } : item,
      ),
    });
  return (
    <>
      <Stack gap="xs">
        <h2>Runs on this board</h2>
        <MultiSelect
          label="Workflows"
          description="Leave empty to include every workflow."
          placeholder={draft.workflowIds.length ? undefined : 'All workflows'}
          searchable
          value={draft.workflowIds}
          disabled={disabled}
          onChange={(workflowIds) => onChange({ ...draft, workflowIds })}
          data={workflowChoices}
        />
        <TagsInput
          label="Run tags"
          description="Runs must carry every tag. Enter key=value."
          value={draft.tags}
          disabled={disabled}
          onChange={(tags) => onChange({ ...draft, tags })}
        />
        <TagsInput
          label="Task systems"
          description="Only runs whose external task comes from one of these systems."
          value={draft.systems}
          disabled={disabled}
          onChange={(systems) => onChange({ ...draft, systems })}
        />
      </Stack>
      <Stack gap="xs">
        <h2>Stage mapping</h2>
        <Text size="sm" c="dimmed">
          Workflows whose stage names match the board type need no mapping. Map
          another name to place that workflow&apos;s stage in a lane.
        </Text>
        {draft.mappings.map((mapping, index) => (
          <div key={mapping.key} className={classes.mappingEdit}>
            <Select
              aria-label={`Mapping ${index + 1} workflow`}
              placeholder="Workflow"
              searchable
              value={mapping.workflowId || null}
              disabled={disabled}
              data={workflowChoices}
              onChange={(workflowId) =>
                setMapping(mapping.key, { workflowId: workflowId ?? '' })
              }
            />
            <TextInput
              aria-label={`Mapping ${index + 1} workflow stage`}
              placeholder="Workflow stage"
              maxLength={200}
              value={mapping.from}
              disabled={disabled}
              onChange={(event) =>
                setMapping(mapping.key, { from: event.currentTarget.value })
              }
            />
            <Select
              aria-label={`Mapping ${index + 1} board stage`}
              placeholder="Board stage"
              value={mapping.to || null}
              disabled={disabled}
              data={stages}
              onChange={(to) => setMapping(mapping.key, { to: to ?? '' })}
            />
            <ActionIcon
              variant="subtle"
              disabled={disabled}
              aria-label={`Remove mapping ${index + 1}`}
              onClick={() =>
                onChange({
                  ...draft,
                  mappings: draft.mappings.filter(
                    (item) => item.key !== mapping.key,
                  ),
                })
              }
            >
              <X size={15} />
            </ActionIcon>
          </div>
        ))}
        <Group>
          <Button
            variant="ghost"
            disabled={disabled || !stages.length}
            onClick={() =>
              onChange({
                ...draft,
                mappings: [
                  ...draft.mappings,
                  {
                    key: crypto.randomUUID(),
                    workflowId: '',
                    from: '',
                    to: '',
                  },
                ],
              })
            }
          >
            <Plus size={16} /> Add mapping
          </Button>
        </Group>
      </Stack>
    </>
  );
}
