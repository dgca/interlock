import { Switch, TextInput } from '../../design-system';

import type { WorkflowNode } from '@interlock/core';

import { DurationInput } from './DurationInput';

const defaults = { maxRetries: 1, windowMs: 300_000, initialBackoffMs: 1000 };

/**
 * Opt-in automatic retry for a foreground Script. Omitted and maxRetries 0
 * both keep the previous single-attempt behavior.
 */
export function ScriptRetrySettings({
  node,
  onChange,
}: {
  node: Extract<WorkflowNode, { kind: 'script' }>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  if (node.executionMode === 'background')
    return (
      <p className="hint">
        Transient retry is available for foreground Scripts. A background Script
        reconciles an uncertain outcome before it can run again.
      </p>
    );
  const value = node.transientRetry;
  const enabled = (value?.maxRetries ?? 0) > 0;
  const current = {
    ...defaults,
    ...value,
    maxRetries: Math.max(1, value?.maxRetries ?? defaults.maxRetries),
  };
  return (
    <>
      <Switch
        mt="md"
        label="Retry transient failures"
        description="Retry an observed non-zero exit after an explicit request, a recognized transient error, or one unclassified probe. Engine timeouts, signals, cancellation and invalid results are never retried."
        checked={enabled}
        onChange={(event) =>
          onChange({
            transientRetry: event.currentTarget.checked
              ? { ...current }
              : undefined,
          })
        }
      />
      {enabled && (
        <>
          <TextInput
            mt="md"
            label="Maximum retries"
            type="number"
            min={1}
            max={10}
            step={1}
            required
            value={current.maxRetries}
            onChange={(event) =>
              onChange({
                transientRetry: {
                  ...current,
                  maxRetries: Number(event.currentTarget.value),
                },
              })
            }
          />
          <DurationInput
            label="Retry window"
            min={0}
            max={86_400_000}
            value={current.windowMs}
            onChange={(windowMs) =>
              onChange({ transientRetry: { ...current, windowMs } })
            }
          />
          <DurationInput
            label="Initial backoff"
            min={0}
            max={60_000}
            value={current.initialBackoffMs}
            onChange={(initialBackoffMs) =>
              onChange({ transientRetry: { ...current, initialBackoffMs } })
            }
          />
          <p className="hint">
            Retries stay in one execution and keep its execution ID.
            INTERLOCK_ATTEMPT increases with each launch. Enable this only when
            repeating the Script is safe.
          </p>
        </>
      )}
    </>
  );
}
