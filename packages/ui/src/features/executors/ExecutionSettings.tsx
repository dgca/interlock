import { useEffect, useId, useState } from 'react';
import { NumberInput, Skeleton, VisuallyHidden } from '@mantine/core';
import { executorSettingsSchema } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { api, errorMessage } from '../../lib/api';
import styles from './Harnesses.module.css';

export function ExecutionSettings() {
  const inputId = useId();
  const [settings, setSettings] =
    useState<Awaited<ReturnType<typeof api.executors.settings.query>>>();
  const [value, setValue] = useState<string | number>(3);
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
      setValue(next.concurrency);
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
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 8;
  return (
    <section
      id="concurrency"
      className={styles.sharedSettings}
      aria-label="Shared execution settings"
    >
      {settings ? (
        <form
          className={styles.sharedForm}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid || busy || loading || value === settings.concurrency)
              return;
            setBusy(true);
            setError('');
            try {
              const next = executorSettingsSchema.parse(
                await api.executors.manage.mutate({
                  action: 'save_settings',
                  concurrency: Number(value),
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
            <label
              htmlFor={inputId}
              id={`${inputId}-label`}
              className={styles.sharedLabel}
            >
              Concurrent assignments
            </label>
            <p>
              Maximum Agent assignments Interlock runs at once across all
              harnesses and workflows. Additional assignments wait.
            </p>
            <p className={styles.sharedNote}>
              Changing the limit does not stop running assignments.
            </p>
          </div>
          <div className={styles.sharedControls}>
            <NumberInput
              id={inputId}
              aria-labelledby={`${inputId}-label`}
              min={1}
              max={8}
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
            <Button
              type="submit"
              variant="primary"
              disabled={
                !valid || busy || loading || value === settings.concurrency
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
        </form>
      ) : !error ? (
        <Skeleton height={80} aria-label="Loading shared execution settings" />
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
  );
}
