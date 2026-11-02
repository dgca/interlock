import { useEffect, useState } from 'react';
import { NumberInput, Skeleton } from '@mantine/core';
import { executorSettingsSchema } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { api, errorMessage } from '../../lib/api';
import styles from './Harnesses.module.css';

export function ExecutionSettings() {
  const [settings, setSettings] =
    useState<Awaited<ReturnType<typeof api.executors.settings.query>>>();
  const [value, setValue] = useState<string | number>(3);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid || busy) return;
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
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <NumberInput
            label="Concurrent assignments"
            description="Maximum Agent assignments running at once across all harnesses and workflows. Additional assignments wait."
            min={1}
            max={8}
            allowDecimal={false}
            allowNegative={false}
            value={value}
            onChange={setValue}
            disabled={busy || loading}
            styles={{ wrapper: { maxWidth: 160 } }}
          />
          <div className={styles.sharedActions}>
            <p className={styles.sharedNote}>
              Changing the limit does not stop running assignments.
            </p>
            <Button
              type="submit"
              variant="primary"
              disabled={
                !valid || busy || loading || value === settings.concurrency
              }
            >
              {busy ? 'Saving…' : loading ? 'Loading…' : 'Save limit'}
            </Button>
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
