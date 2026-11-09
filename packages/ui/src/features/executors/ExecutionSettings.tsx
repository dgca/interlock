import {
  NativeSelect,
  NumberInput,
  Skeleton,
  VisuallyHidden,
  Button,
  workspacePage,
} from '../../design-system';

import { StallSettings } from './StallSettings';
import { RetentionSettings } from '../runs/RetentionSettings';
import { useEffect, useId, useState } from 'react';

import { executorSettingsSchema } from '@interlock/core';

import { api, errorMessage } from '../../lib/api';
import styles from './Harnesses.module.css';

export function ExecutionSettings({
  onDirty,
}: {
  onDirty?: (dirty: boolean) => void;
}) {
  const inputId = useId();
  const [stallDirty, setStallDirty] = useState(false);
  const [retentionDirty, setRetentionDirty] = useState(false);
  const [settings, setSettings] =
    useState<Awaited<ReturnType<typeof api.executors.settings.query>>>();
  const [value, setValue] = useState<string | number>(3);
  const [mode, setMode] = useState('limited');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await api.executors.settings.query();
      setSettings(next);
      setMode(next.concurrency === null ? 'unlimited' : 'limited');
      setValue(next.concurrency ?? 3);
      setSaved(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const valid =
    mode === 'unlimited' ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1);
  const concurrency = mode === 'unlimited' ? null : value;
  const dirty = !!settings && concurrency !== settings.concurrency;
  useEffect(
    () => onDirty?.(dirty || stallDirty || retentionDirty),
    [dirty, stallDirty, retentionDirty, onDirty],
  );
  useEffect(() => () => onDirty?.(false), [onDirty]);
  return (
    <>
      <section
        id="concurrency"
        className={`${workspacePage.card} ${styles.sharedSettings}`}
        aria-label="Shared execution settings"
      >
        {settings ? (
          <form
            className={styles.sharedForm}
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                !valid ||
                busy ||
                loading ||
                concurrency === settings.concurrency
              )
                return;
              setBusy(true);
              setError('');
              try {
                const next = executorSettingsSchema.parse(
                  await api.executors.manage.mutate({
                    action: 'save_settings',
                    concurrency: concurrency === null ? null : Number(value),
                    expectedRevision: settings.revision,
                  }),
                );
                setSettings(next);
                setSaved(true);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className={styles.sharedCopy}>
              <h3 id={`${inputId}-label`} className={styles.sharedLabel}>
                Concurrent assignments
              </h3>
              <p>
                {mode === 'unlimited'
                  ? 'Start every ready assignment. Workflow requirements and resource coordination still apply.'
                  : 'Maximum Agent assignments Interlock runs at once across all harnesses and workflows. Additional assignments wait.'}
              </p>
              <p className={styles.sharedNote}>
                Changing the limit does not stop running assignments.
              </p>
            </div>
            <div className={styles.sharedControls}>
              <NativeSelect
                aria-label="Assignment limit mode"
                className={styles.limitMode}
                value={mode}
                disabled={busy || loading}
                onChange={(event) => {
                  setMode(event.currentTarget.value);
                  setSaved(false);
                }}
                data={[
                  { value: 'limited', label: 'Limit to' },
                  { value: 'unlimited', label: 'Unlimited' },
                ]}
              />
              <div className={styles.limitValueActions}>
                {mode === 'limited' && (
                  <NumberInput
                    id={inputId}
                    aria-labelledby={`${inputId}-label`}
                    min={1}
                    allowDecimal={false}
                    allowNegative={false}
                    value={value}
                    onChange={(value) => {
                      setValue(value);
                      setSaved(false);
                    }}
                    disabled={busy || loading}
                    className={styles.limitInput}
                  />
                )}
                <Button
                  type="submit"
                  variant="primary"
                  disabled={
                    !valid ||
                    busy ||
                    loading ||
                    concurrency === settings.concurrency
                  }
                >
                  {busy
                    ? 'Saving…'
                    : loading
                      ? 'Loading…'
                      : saved
                        ? 'Saved'
                        : 'Save limit'}
                </Button>
                <VisuallyHidden role="status">
                  {saved ? 'Concurrent assignment limit saved.' : ''}
                </VisuallyHidden>
              </div>
            </div>
          </form>
        ) : !error ? (
          <Skeleton
            height={80}
            aria-label="Loading shared execution settings"
          />
        ) : null}
        {error && (
          <div className={styles.sharedError}>
            <p role="alert" className={styles.error}>
              {error}
            </p>
            <Button variant="ghost" onClick={() => void load()}>
              Reload settings
            </Button>
          </div>
        )}
      </section>
      <div id="stall-settings" className={workspacePage.card}>
        <h3 className={styles.settingsHeading}>Stall detection</h3>
        <StallSettings showHeading={false} onDirty={setStallDirty} />
      </div>
      <section id="history-retention" className={workspacePage.card}>
        <h3 className={styles.settingsHeading}>History retention</h3>
        <RetentionSettings showHeading={false} onDirty={setRetentionDirty} />
      </section>
    </>
  );
}
