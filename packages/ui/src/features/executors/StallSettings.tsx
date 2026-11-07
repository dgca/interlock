import { useEffect, useState } from 'react';
import { NativeSelect, TextInput, Textarea, Stack } from '@mantine/core';
import {
  MAX_ACTIVE_CLOCK_MS,
  stallPolicySchema,
  type StallPolicy,
} from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { api, errorMessage } from '../../lib/api';

const fields = [
  ['unclaimedStallMs', 'Unclaimed stall'],
  ['claimedIdleStallMs', 'Claimed idle stall'],
  ['humanWaitStallMs', 'External input stall'],
  ['runStallMs', 'Run transition stall'],
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
  return (
    <Stack gap="sm" my="md">
      {showHeading && <h3>Stall detection</h3>}
      <p className="hint">
        Active time excludes pauses and declared holds. A stall adds Needs
        attention without failing the run.
      </p>
      {fields
        .filter(([key]) => !thresholds || thresholds.includes(key))
        .map(([key, label]) => (
          <div key={key}>
            <NativeSelect
              label={label}
              value={
                value[key] === undefined || (!inherit && value[key] === null)
                  ? 'inherit'
                  : value[key] === null
                    ? 'disabled'
                    : 'threshold'
              }
              data={[
                { value: 'inherit', label: inherit ? 'Inherit' : 'Disabled' },
                ...(inherit ? [{ value: 'disabled', label: 'Disabled' }] : []),
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
            {typeof value[key] === 'number' && (
              <TextInput
                mt="xs"
                label={`${label} milliseconds`}
                type="number"
                required
                min={1}
                max={MAX_ACTIVE_CLOCK_MS}
                step={1}
                value={value[key]}
                onChange={(e) =>
                  onChange({ [key]: Number(e.currentTarget.value) })
                }
              />
            )}
          </div>
        ))}
      {showRecovery && (
        <NativeSelect
          label="Managed idle recovery"
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
                    : {
                        maxRecoveries: 1,
                        message:
                          'Continue the stalled assignment and return its required result, or report the blocker.',
                      },
            })
          }
        />
      )}
      {showRecovery && value.idleRecovery && (
        <>
          <TextInput
            label="Maximum idle recoveries"
            type="number"
            min={0}
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
}: {
  onDirty?: (dirty: boolean) => void;
}) {
  const [saved, setSaved] =
    useState<Awaited<ReturnType<typeof api.stalls.settings.query>>>();
  const [policy, setPolicy] = useState<StallPolicy>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty =
    !!saved && JSON.stringify(saved.policy) !== JSON.stringify(policy);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const load = () => {
    setError('');
    void api.stalls.settings
      .query()
      .then((s) => {
        setSaved(s);
        setPolicy(s.policy);
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
              value={policy}
              inherit={false}
              onChange={(patch) => setPolicy((p) => ({ ...p, ...patch }))}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={
                !dirty || busy || !stallPolicySchema.safeParse(policy).success
              }
            >
              {busy ? 'Saving…' : 'Save stall settings'}
            </Button>
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
