import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import {
  boardCardFieldSources,
  boardLaneStatuses,
  runWaitingSchema,
  type BoardTypeContent,
  type LaneRule,
} from '@interlock/core';
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

type Lane = BoardTypeContent['lanes'][number];
type Field = BoardTypeContent['fields'][number];

const statusLabels: Record<(typeof boardLaneStatuses)[number], string> = {
  held: 'Held',
  queued: 'Queued',
  running: 'Running',
  waiting: 'Waiting',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const actorLabels = { agent: 'Agent', person: 'Person', engine: 'Engine' };
const fieldLabels: Record<(typeof boardCardFieldSources)[number], string> = {
  link: 'Task link',
  workflow: 'Workflow',
  stage: 'Stage',
  waiting: 'Waiting reason',
  actor: 'Actor',
  spend: 'Spend',
  age: 'Age',
  tags: 'Tags',
};
const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

/** A unique lane or field ID derived from its name. */
function slug(name: string, taken: string[]) {
  const base =
    name
      .toLowerCase()
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70) || 'lane';
  let id = base;
  for (let n = 2; taken.includes(id) || id === 'unmapped'; n++)
    id = `${base}-${n}`;
  return id;
}

function moved<T>(items: T[], index: number, offset: number) {
  const next = [...items];
  [next[index], next[index + offset]] = [next[index + offset], next[index]];
  return next;
}

function RuleRow({
  rule,
  index,
  laneName,
  disabled,
  onChange,
  onRemove,
}: {
  rule: LaneRule;
  index: number;
  laneName: string;
  disabled: boolean;
  onChange: (rule: LaneRule) => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof LaneRule>(key: K, value: LaneRule[K]) => {
    const next = { ...rule };
    if (Array.isArray(value) && !value.length) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  const name = `${laneName || 'Lane'} condition ${index + 1}`;
  return (
    <div className={classes.ruleRow} role="group" aria-label={name}>
      {index > 0 && (
        <Text size="xs" c="dimmed" className={classes.ruleOr}>
          or
        </Text>
      )}
      <TagsInput
        label="Stages"
        placeholder={rule.stages?.length ? undefined : 'Any stage'}
        value={rule.stages ?? []}
        disabled={disabled}
        onChange={(value) => set('stages', value)}
      />
      <MultiSelect
        label="Status"
        placeholder={rule.status?.length ? undefined : 'Any status'}
        value={rule.status ?? []}
        disabled={disabled}
        data={options(statusLabels)}
        onChange={(value) =>
          set('status', value as NonNullable<LaneRule['status']>)
        }
      />
      <MultiSelect
        label="Actor"
        placeholder={rule.actor?.length ? undefined : 'Anyone'}
        value={rule.actor ?? []}
        disabled={disabled}
        data={options(actorLabels)}
        onChange={(value) =>
          set('actor', value as NonNullable<LaneRule['actor']>)
        }
      />
      <MultiSelect
        label="Waiting on"
        placeholder={rule.waiting?.length ? undefined : 'Anything'}
        value={rule.waiting ?? []}
        disabled={disabled}
        data={runWaitingSchema.shape.kind.options.map((value) => ({
          value,
          label: value.replace(/_/g, ' '),
        }))}
        onChange={(value) => set('waiting', value)}
      />
      <ActionIcon
        variant="subtle"
        className={classes.ruleRemove}
        disabled={disabled}
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        <X size={15} />
      </ActionIcon>
    </div>
  );
}

export function LanesEditor({
  lanes,
  disabled,
  onChange,
}: {
  lanes: Lane[];
  disabled: boolean;
  onChange: (lanes: Lane[]) => void;
}) {
  const change = (index: number, lane: Lane) =>
    onChange(lanes.map((item, i) => (i === index ? lane : item)));
  return (
    <Stack gap="xs">
      <h2>Lanes</h2>
      <Text size="sm" c="dimmed">
        Each card goes to the first lane whose conditions match the run that
        places it. Cards no lane matches go to Unmapped.
      </Text>
      {lanes.map((lane, index) => (
        <section
          key={lane.id}
          className={classes.laneEdit}
          aria-label={lane.name || `Lane ${index + 1}`}
        >
          <div className={classes.columnEdit}>
            <TextInput
              aria-label={`Lane ${index + 1} name`}
              required
              maxLength={80}
              value={lane.name}
              disabled={disabled}
              onChange={(event) =>
                change(index, { ...lane, name: event.currentTarget.value })
              }
            />
            <Group gap={4}>
              <ActionIcon
                variant="subtle"
                disabled={disabled || index === 0}
                aria-label={`Move ${lane.name || 'lane'} up`}
                onClick={() => onChange(moved(lanes, index, -1))}
              >
                <ArrowUp size={15} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                disabled={disabled || index === lanes.length - 1}
                aria-label={`Move ${lane.name || 'lane'} down`}
                onClick={() => onChange(moved(lanes, index, 1))}
              >
                <ArrowDown size={15} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                disabled={disabled || lanes.length === 1}
                aria-label={`Remove ${lane.name || 'lane'}`}
                onClick={() => onChange(lanes.filter((_, i) => i !== index))}
              >
                <X size={15} />
              </ActionIcon>
            </Group>
          </div>
          {lane.match?.map((rule, ruleIndex) => (
            <RuleRow
              key={ruleIndex}
              rule={rule}
              index={ruleIndex}
              laneName={lane.name}
              disabled={disabled}
              onChange={(next) =>
                change(index, {
                  ...lane,
                  match: lane.match!.map((item, i) =>
                    i === ruleIndex ? next : item,
                  ),
                })
              }
              onRemove={() => {
                const match = lane.match!.filter((_, i) => i !== ruleIndex);
                change(index, {
                  id: lane.id,
                  name: lane.name,
                  ...(match.length && { match }),
                });
              }}
            />
          ))}
          {!lane.match?.length && (
            <Text size="sm" c="dimmed">
              Matches every card that an earlier lane did not.
            </Text>
          )}
          <Group>
            <Button
              variant="ghost"
              disabled={disabled || (lane.match?.length ?? 0) >= 10}
              onClick={() =>
                change(index, { ...lane, match: [...(lane.match ?? []), {}] })
              }
            >
              <Plus size={16} />
              {lane.match?.length ? 'Add alternative' : 'Add condition'}
            </Button>
          </Group>
        </section>
      ))}
      <Group>
        <Button
          variant="ghost"
          disabled={disabled || lanes.length >= 30}
          onClick={() =>
            onChange([
              ...lanes,
              {
                id: slug(
                  'Lane',
                  lanes.map((lane) => lane.id),
                ),
                name: '',
                match: [{}],
              },
            ])
          }
        >
          <Plus size={16} /> Add lane
        </Button>
      </Group>
    </Stack>
  );
}

export function FieldsEditor({
  fields,
  disabled,
  onChange,
}: {
  fields: Field[];
  disabled: boolean;
  onChange: (fields: Field[]) => void;
}) {
  const change = (index: number, field: Field) =>
    onChange(fields.map((item, i) => (i === index ? field : item)));
  return (
    <Stack gap="xs">
      <h2>Card fields</h2>
      <Text size="sm" c="dimmed">
        A node result reads a path from that step&apos;s latest output, such as
        open_pr.url.
      </Text>
      {fields.map((field, index) => {
        const node = field.source.startsWith('node.');
        return (
          <div key={field.id} className={classes.fieldEdit}>
            <TextInput
              aria-label={`Field ${index + 1} label`}
              required
              maxLength={80}
              value={field.label}
              disabled={disabled}
              onChange={(event) =>
                change(index, { ...field, label: event.currentTarget.value })
              }
            />
            <Select
              aria-label={`Field ${index + 1} source`}
              allowDeselect={false}
              value={node ? 'node' : field.source}
              disabled={disabled}
              data={[
                ...options(fieldLabels),
                { value: 'node', label: 'Node result' },
              ]}
              onChange={(value) =>
                value &&
                change(index, {
                  ...field,
                  source: value === 'node' ? 'node.step.result' : value,
                })
              }
            />
            {node && (
              <TextInput
                aria-label={`Field ${index + 1} node path`}
                placeholder="nodeId.path"
                value={field.source.slice('node.'.length)}
                disabled={disabled}
                onChange={(event) =>
                  change(index, {
                    ...field,
                    source: `node.${event.currentTarget.value}`,
                  })
                }
              />
            )}
            <ActionIcon
              variant="subtle"
              disabled={disabled}
              aria-label={`Remove ${field.label || 'field'}`}
              onClick={() => onChange(fields.filter((_, i) => i !== index))}
            >
              <X size={15} />
            </ActionIcon>
          </div>
        );
      })}
      <Group>
        <Button
          variant="ghost"
          disabled={disabled || fields.length >= 12}
          onClick={() =>
            onChange([
              ...fields,
              {
                id: slug(
                  'field',
                  fields.map((field) => field.id),
                ),
                label: '',
                source: 'age',
              },
            ])
          }
        >
          <Plus size={16} /> Add field
        </Button>
      </Group>
    </Stack>
  );
}
