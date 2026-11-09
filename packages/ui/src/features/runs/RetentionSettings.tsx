import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Group,
  NativeSelect,
  NumberInput,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { retentionPolicySchema, type RetentionPolicy } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { Modal } from '../../components/Modal/Modal';
import { ModalBody, ModalFooter } from '../../components/Modal/ModalLayout';
import { api, errorMessage } from '../../lib/api';
import styles from './RetentionSettings.module.css';

type Settings = Awaited<ReturnType<typeof api.runs.retentionSettings.query>>;
type Status = Awaited<ReturnType<typeof api.runs.retentionStatus.query>>;
type Mode = 'inherit' | 'disabled' | 'enabled';
const modeFor = (settings: Settings): Mode =>
  settings.inherited ? 'inherit' : settings.policy ? 'enabled' : 'disabled';
const bytes = (size: number) =>
  size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KiB`
    : `${(size / 1024 / 1024).toFixed(1)} MiB`;
function describe(policy: RetentionPolicy | null) {
  if (!policy)
    return 'Disabled. History is kept until you clean it up manually.';
  const limits = [];
  if (policy.maxAgeDays !== undefined)
    limits.push(`trees last updated more than ${policy.maxAgeDays} days ago`);
  if (policy.maxCompletedRuns !== undefined)
    limits.push(
      `trees beyond the newest ${policy.maxCompletedRuns} completed trees`,
    );
  return `Delete ${limits.join(' or ')} when unprotected.`;
}

export function RetentionSettings({
  workflowId,
  onDirty,
  onBusy,
  showHeading = true,
}: {
  workflowId?: string;
  onDirty?: (dirty: boolean) => void;
  onBusy?: (busy: boolean) => void;
  showHeading?: boolean;
}) {
  const [settings, setSettings] = useState<Settings>();
  const [status, setStatus] = useState<Status>();
  const [mode, setMode] = useState<Mode>(workflowId ? 'inherit' : 'disabled');
  const [age, setAge] = useState<string | number>('');
  const [count, setCount] = useState<string | number>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const generation = useRef(0);
  const apply = (next: Settings) => {
    setSettings(next);
    setMode(modeFor(next));
    setAge(next.policy?.maxAgeDays ?? '');
    setCount(next.policy?.maxCompletedRuns ?? '');
  };
  const refreshStatus = useCallback(async () => {
    const request = generation.current;
    try {
      const next = await api.runs.retentionStatus.query();
      if (request === generation.current) {
        setStatus(next);
        setStatusError('');
      }
    } catch (e) {
      if (request === generation.current) setStatusError(errorMessage(e));
    }
  }, []);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    setSaved(false);
    try {
      const next = await api.runs.retentionSettings.query({ workflowId });
      if (request === generation.current) apply(next);
    } catch (e) {
      if (request === generation.current) setError(errorMessage(e));
    } finally {
      if (request === generation.current) setLoading(false);
    }
    if (request === generation.current) await refreshStatus();
  }, [workflowId, refreshStatus]);
  useEffect(() => {
    setSettings(undefined);
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  const policy: RetentionPolicy = {
    ...(age !== '' ? { maxAgeDays: Number(age) } : {}),
    ...(count !== '' ? { maxCompletedRuns: Number(count) } : {}),
  };
  const parsed = retentionPolicySchema.safeParse(policy);
  const value =
    mode === 'enabled' ? policy : mode === 'inherit' ? 'inherit' : null;
  const initialValue = settings?.inherited
    ? 'inherit'
    : (settings?.policy ?? null);
  const dirty =
    !!settings && JSON.stringify(initialValue) !== JSON.stringify(value);
  const valid = mode !== 'enabled' || parsed.success;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  useEffect(() => onBusy?.(busy), [busy, onBusy]);
  return (
    <section
      className={`${styles.section}${showHeading ? '' : ` ${styles.dialogSection}`}`}
      aria-label={
        workflowId ? 'Workflow history retention' : 'Library history retention'
      }
    >
      {showHeading && <h3>History retention</h3>}
      <p className={styles.intro}>
        Automatically delete completed run history by age or count. Workflows
        and published versions are kept.
      </p>
      {settings ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid || !dirty || busy || loading) return;
            const request = generation.current;
            setBusy(true);
            setError('');
            setSaved(false);
            try {
              const next = await api.runs.configureRetention.mutate({
                workflowId,
                expectedRevision: settings.revision,
                policy:
                  mode === 'enabled'
                    ? parsed.data!
                    : (value as 'inherit' | null),
              });
              if (request === generation.current) {
                apply(next);
                setSaved(true);
                await refreshStatus();
              }
            } catch (e) {
              if (request === generation.current) setError(errorMessage(e));
            } finally {
              if (request === generation.current) setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy || loading} className={styles.fields}>
            <NativeSelect
              label="Automatic cleanup"
              value={mode}
              onChange={(event) => {
                setMode(event.currentTarget.value as Mode);
                setSaved(false);
              }}
              data={[
                ...(workflowId
                  ? [{ value: 'inherit', label: 'Inherit library policy' }]
                  : []),
                { value: 'disabled', label: 'Disabled' },
                {
                  value: 'enabled',
                  label: workflowId ? 'Override library policy' : 'Enabled',
                },
              ]}
            />
            {mode === 'enabled' && (
              <>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <NumberInput
                    label="Maximum age in days"
                    description="Leave blank for no age limit."
                    min={1}
                    max={36500}
                    allowDecimal={false}
                    allowNegative={false}
                    value={age}
                    onChange={(value) => {
                      setAge(value);
                      setSaved(false);
                    }}
                  />
                  <NumberInput
                    label="Completed run trees to keep"
                    description="Leave blank for no count limit. Zero keeps none."
                    min={0}
                    max={1000000}
                    allowDecimal={false}
                    allowNegative={false}
                    value={count}
                    onChange={(value) => {
                      setCount(value);
                      setSaved(false);
                    }}
                  />
                </SimpleGrid>
                {!valid && (
                  <Text size="sm" c="dimmed">
                    Set at least one limit using whole numbers within the field
                    bounds.
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  A run tree includes its child and continuation runs. Either
                  limit can delete a tree, including failed or cancelled runs.
                  {workflowId
                    ? ' This override has its own count.'
                    : ' The count is shared by workflows that inherit this policy.'}
                </Text>
              </>
            )}
            <Text size="sm" c="dimmed">
              Cleanup permanently deletes run inputs, outputs, and usage. Active
              runs and protected history are kept. Changes apply when saved.
            </Text>
            <Group gap="sm">
              <Button
                type="submit"
                variant="primary"
                disabled={!dirty || !valid || busy || loading}
              >
                {busy ? 'Saving…' : 'Save retention settings'}
              </Button>
              <Text size="sm" role="status">
                {saved ? 'Retention settings saved.' : ''}
              </Text>
            </Group>
          </fieldset>
        </form>
      ) : !error ? (
        <Skeleton height={100} aria-label="Loading retention settings" />
      ) : null}
      {error && (
        <Alert
          color="red"
          role="alert"
          title="Retention settings could not be loaded or saved"
        >
          <Text size="sm">{error}</Text>
          <Button
            variant="ghost"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            Reload settings
          </Button>
        </Alert>
      )}
      {settings && (
        <Text size="sm" className={styles.effective}>
          {settings.inherited ? 'Saved library policy: ' : 'Saved policy: '}
          {describe(settings.effectivePolicy)}
        </Text>
      )}
      {status && (
        <Stack gap={6} className={styles.status}>
          <Group justify="space-between" align="center">
            <Text size="sm" fw={600}>
              Library cleanup status
            </Text>
            <Button
              variant="ghost"
              disabled={busy || loading}
              onClick={() => void refreshStatus()}
            >
              Refresh status
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            {status.nextCheckAt
              ? `Next check ${new Date(status.nextCheckAt).toLocaleString()}.`
              : 'No automatic cleanup is scheduled.'}
          </Text>
          {status.lastSweep && (
            <Text size="sm" c="dimmed">
              Last check {new Date(status.lastSweep.checkedAt).toLocaleString()}
              : deleted {status.lastSweep.deletedRoots} trees and{' '}
              {status.lastSweep.deletedRuns} runs; skipped{' '}
              {status.lastSweep.protectedTrees} protected trees.
            </Text>
          )}
          <Text size="sm" c="dimmed">
            SQLite allocated {bytes(status.storage.databaseBytes)}; reusable
            pages {bytes(status.storage.reusableBytes)}. The file may not
            shrink.
          </Text>
          {status.lastError && (
            <Alert color="red" title="Last cleanup failed">
              {status.lastError}
            </Alert>
          )}
        </Stack>
      )}
      {statusError && (
        <Group gap="sm">
          <Text size="sm" c="red" role="alert">
            Could not load cleanup status. {statusError}
          </Text>
          <Button
            variant="ghost"
            disabled={busy || loading}
            onClick={() => void refreshStatus()}
          >
            Retry status
          </Button>
        </Group>
      )}
    </section>
  );
}

export function RetentionSettingsDialog({
  workflowId,
  onClose,
}: {
  workflowId?: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const close = () => {
    if (
      !busy &&
      (!dirty || window.confirm('Discard unsaved retention settings?'))
    )
      onClose();
  };
  return (
    <Modal
      title={
        workflowId ? 'Workflow history retention' : 'Library history retention'
      }
      size={640}
      busy={busy}
      onClose={close}
    >
      <ModalBody>
        <RetentionSettings
          workflowId={workflowId}
          showHeading={false}
          onDirty={setDirty}
          onBusy={setBusy}
        />
      </ModalBody>
      <ModalFooter>
        <Button disabled={busy} onClick={close}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
