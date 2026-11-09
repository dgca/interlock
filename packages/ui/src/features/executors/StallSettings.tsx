import {
  NativeSelect,
  Switch,
  TextInput,
  Textarea,
  Stack,
  Button,
} from '../../design-system';

import { useEffect, useState } from 'react';

import {
  MAX_ACTIVE_CLOCK_MS,
  stallPolicySchema,
  type StallPolicy,
} from '@interlock/core';

import { api, errorMessage } from '../../lib/api';
import { DurationInput } from '../workflows/DurationInput';
import styles from './StallSettings.module.css';

const defaultRecovery = {
  maxRecoveries: 1,
  message:
    'Continue the stalled assignment and return its required result, or report the blocker.',
};

const fields = [
  [
    'unclaimedStallMs',
    'Unclaimed stall',
    'Unclaimed threshold',
    'An assignment is ready, but no agent has picked it up.',
  ],
  [
    'claimedIdleStallMs',
    'Claimed idle stall',
    'Claimed idle threshold',
    'An agent has picked up work but has stopped reporting activity.',
  ],
  [
    'humanWaitStallMs',
    'External input stall',
    'External input threshold',
    'An External input step is waiting for a value to be submitted or accepted.',
  ],
  [
    'runStallMs',
    'Run transition stall',
    'Run transition threshold',
    'The run has stopped advancing or reporting progress. Planned waits and active child workflows do not count.',
  ],
] as const;
export function StallPolicyEditor({
  value,
  onChange,
  inherit = true,
  showRecovery = true,
  showHeading = true,
  thresholds,
}: {
  value: StallPolicy;
  onChange: (patch: Partial<StallPolicy>) => void;
  inherit?: boolean;
  showRecovery?: boolean;
  showHeading?: boolean;
  thresholds?: (typeof fields)[number][0][];
}) {
  const [recoveryEnabled, setRecoveryEnabled] = useState(
    () => !!value.idleRecovery?.maxRecoveries,
  );
  return (
    <Stack gap="sm" mb="md">
      {showHeading && <h3>Stall detection</h3>}
      <p className={styles.intro}>
        Flag runs that wait too long for an agent, input, or progress. A stall
        adds Needs attention without failing the run. Pauses and declared holds
        do not count.
      </p>
      {fields
        .filter(([key]) => !thresholds || thresholds.includes(key))
        .map(([key, label, thresholdLabel, description]) => (
          <div key={key}>
            {inherit ? (
              <NativeSelect
                className={styles.selection}
                label={label}
                description={description}
                value={
                  value[key] === undefined || (!inherit && value[key] === null)
                    ? 'inherit'
                    : value[key] === null
                      ? 'disabled'
                      : 'threshold'
                }
                data={[
                  { value: 'inherit', label: inherit ? 'Inherit' : 'Disabled' },
                  ...(inherit
                    ? [{ value: 'disabled', label: 'Disabled' }]
                    : []),
                  { value: 'threshold', label: 'Set threshold' },
                ]}
                onChange={(e) =>
                  onChange({
                    [key]:
                      e.currentTarget.value === 'inherit'
                        ? undefined
                        : e.currentTarget.value === 'disabled'
                          ? null
                          : 300000,
                  })
                }
              />
            ) : (
              <Switch
                label={label}
                description={description}
                checked={typeof value[key] === 'number'}
                onChange={(event) =>
                  onChange({
                    [key]: event.currentTarget.checked ? 300000 : undefined,
                  })
                }
              />
            )}
            {typeof value[key] === 'number' && (
              <div className={styles.threshold}>
                <DurationInput
                  label={thresholdLabel}
                  min={1}
                  max={MAX_ACTIVE_CLOCK_MS}
                  step={1}
                  value={value[key]}
                  onChange={(duration) => onChange({ [key]: duration })}
                />
              </div>
            )}
          </div>
        ))}
      {showRecovery &&
        (inherit ? (
          <NativeSelect
            className={styles.selection}
            label="Managed idle recovery"
            description="Send a reminder to an idle agent. Requires a custom launcher with recovery support."
            value={
              value.idleRecovery === undefined ||
              (!inherit && value.idleRecovery === null)
                ? 'inherit'
                : value.idleRecovery === null
                  ? 'disabled'
                  : 'configured'
            }
            data={[
              { value: 'inherit', label: inherit ? 'Inherit' : 'Disabled' },
              ...(inherit ? [{ value: 'disabled', label: 'Disabled' }] : []),
              { value: 'configured', label: 'Configure' },
            ]}
            onChange={(e) =>
              onChange({
                idleRecovery:
                  e.currentTarget.value === 'inherit'
                    ? undefined
                    : e.currentTarget.value === 'disabled'
                      ? null
                      : { ...defaultRecovery },
              })
            }
          />
        ) : (
          <Switch
            label="Managed idle recovery"
            description="Send a reminder to an idle agent. Requires a custom launcher with recovery support."
            checked={recoveryEnabled}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setRecoveryEnabled(enabled);
              onChange({
                idleRecovery: enabled
                  ? value.idleRecovery
                    ? {
                        ...value.idleRecovery,
                        maxRecoveries: Math.max(
                          1,
                          value.idleRecovery.maxRecoveries,
                        ),
                      }
                    : { ...defaultRecovery }
                  : undefined,
              });
            }}
          />
        ))}
      {showRecovery && value.idleRecovery && (inherit || recoveryEnabled) && (
        <>
          <TextInput
            label="Maximum idle recoveries"
            type="number"
            min={inherit ? 0 : 1}
            max={10}
            step={1}
            required
            value={value.idleRecovery.maxRecoveries}
            onChange={(e) =>
              onChange({
                idleRecovery: {
                  ...value.idleRecovery!,
                  maxRecoveries: Number(e.currentTarget.value),
                },
              })
            }
          />
          <Textarea
            label="Idle nudge message"
            required
            maxLength={4000}
            value={value.idleRecovery.message}
            onChange={(e) =>
              onChange({
                idleRecovery: {
                  ...value.idleRecovery!,
                  message: e.currentTarget.value,
                },
              })
            }
          />
          <p className="hint">
            Requires a claimed idle threshold and a custom launcher with
            message, stop and status support. A confirmed stop spends an
            ordinary attempt before relaunch.
          </p>
        </>
      )}
    </Stack>
  );
}
export function StallSettings({
  onDirty,
  showHeading = true,
}: {
  onDirty?: (dirty: boolean) => void;
  showHeading?: boolean;
}) {
  const [saved, setSaved] =
    useState<Awaited<ReturnType<typeof api.stalls.settings.query>>>();
  const [policy, setPolicy] = useState<StallPolicy>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadGeneration, setLoadGeneration] = useState(0);
  const dirty =
    !!saved && JSON.stringify(saved.policy) !== JSON.stringify(policy);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const load = () => {
    setError('');
    void api.stalls.settings
      .query()
      .then((s) => {
        setSaved(s);
        setPolicy(s.policy);
        setLoadGeneration((generation) => generation + 1);
      })
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, []);
  return (
    <section aria-label="Library stall settings">
      {saved ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const result = await api.stalls.configure.mutate({
                expectedRevision: saved.revision,
                policy: stallPolicySchema.parse(policy),
              });
              setSaved(result);
              setPolicy(result.policy);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset
            disabled={busy}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <StallPolicyEditor
              key={loadGeneration}
              value={policy}
              inherit={false}
              showHeading={showHeading}
              onChange={(patch) => setPolicy((p) => ({ ...p, ...patch }))}
            />
            <div className={styles.actions}>
              <Button
                type="submit"
                variant="primary"
                disabled={
                  !dirty || busy || !stallPolicySchema.safeParse(policy).success
                }
              >
                {busy ? 'Saving…' : 'Save stall settings'}
              </Button>
            </div>
          </fieldset>
        </form>
      ) : !error ? (
        <p className="hint">Loading stall settings…</p>
      ) : null}
      {error && (
        <>
          <p role="alert">{error}</p>
          <Button onClick={load}>Reload stall settings</Button>
        </>
      )}
    </section>
  );
}
