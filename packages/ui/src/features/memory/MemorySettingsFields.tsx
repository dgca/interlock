import { memoryLimits, type MemoryListing } from '@interlock/core';
import { NumberInput, Select, Stack, Switch } from '../../design-system';
import { trpc, useQuery } from '../../lib/query';
import styles from './Memory.module.css';

export type MemorySettingsDraft = {
  enabled?: boolean;
  agentWrites?: 'review' | 'live';
  promptBudget?: number;
};

/**
 * Memory settings in workflow settings. Changes stay in the draft until the
 * dialog applies them; they take effect for runs that start afterwards.
 */
export function MemorySettingsFields({
  workflowId,
  value,
  onChange,
}: {
  workflowId: string;
  value: MemorySettingsDraft;
  onChange: (value: MemorySettingsDraft) => void;
}) {
  const query = useQuery(
    trpc.memory.read.queryOptions({ action: 'list', workflowId }),
  );
  const saved = (query.data as MemoryListing | undefined)?.settings;
  const current = { ...saved, ...value };
  const loading = !saved;
  return (
    <Stack gap="sm" mb="md">
      <h3>Memory</h3>
      <p className={styles.hint}>
        Notes from earlier runs join each Agent prompt as reference information.
        Manage notes in the Memory tab. Changes apply to runs that start
        afterwards.
      </p>
      <Switch
        label="Use memory"
        checked={current.enabled ?? false}
        disabled={loading}
        onChange={(event) =>
          onChange({ ...value, enabled: event.currentTarget.checked })
        }
      />
      {query.error && (
        <p role="alert" className={styles.error}>
          Memory settings could not load: {query.error.message}
        </p>
      )}
      {current.enabled && (
        <>
          <Select
            label="Agent notes"
            allowDeselect={false}
            value={current.agentWrites ?? 'review'}
            data={[
              { value: 'review', label: 'Wait for review' },
              { value: 'live', label: 'Go live immediately' },
            ]}
            onChange={(next) =>
              onChange({
                ...value,
                agentWrites: next === 'live' ? 'live' : 'review',
              })
            }
          />
          <NumberInput
            label="Prompt budget (characters)"
            description="When notes exceed the budget, the most recently updated notes that fit are included."
            min={memoryLimits.promptBudget.min}
            max={memoryLimits.promptBudget.max}
            step={1000}
            thousandSeparator=","
            clampBehavior="strict"
            value={current.promptBudget ?? memoryLimits.promptBudget.default}
            onChange={(next) =>
              typeof next === 'number' &&
              onChange({ ...value, promptBudget: next })
            }
          />
        </>
      )}
    </Stack>
  );
}
