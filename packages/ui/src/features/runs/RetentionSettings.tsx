import {
  Alert,
  Group,
  NativeSelect,
  NumberInput,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
} from '../../design-system';

import { useCallback, useEffect, useRef, useState } from 'react';

import { retentionPolicySchema, type RetentionPolicy } from '@interlock/core';

import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery, useQueryClient } from '../../lib/query';
import styles from './RetentionSettings.module.css';

type Settings = Awaited<ReturnType<typeof api.runs.retentionSettings.query>>;
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

type RetentionSettingsProps = {
  workflowId?: string;
  onDirty?: (dirty: boolean) => void;
  onBusy?: (busy: boolean) => void;
  showHeading?: boolean;
};

export function RetentionSettings(props: RetentionSettingsProps) {
  return (
    <RetentionSettingsForm
      key={
        props.workflowId === undefined
          ? 'library'
          : `workflow:${props.workflowId}`
      }
      {...props}
    />
  );
}

function RetentionSettingsForm({
  workflowId,
  onDirty,
  onBusy,
  showHeading = true,
}: RetentionSettingsProps) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(
    trpc.runs.retentionSettings.queryOptions({ workflowId }),
  );
  const statusQuery = useQuery(trpc.runs.retentionStatus.queryOptions());
  const [settings, setSettings] = useState(settingsQuery.data);
  const status = statusQuery.data;
  const [mode, setMode] = useState<Mode>(
    settingsQuery.data
      ? modeFor(settingsQuery.data)
      : workflowId
        ? 'inherit'
        : 'disabled',
  );
  const [age, setAge] = useState<string | number>(
    settingsQuery.data?.policy?.maxAgeDays ?? '',
  );
  const [count, setCount] = useState<string | number>(
    settingsQuery.data?.policy?.maxCompletedRuns ?? '',
  );
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [actionError, setError] = useState('');
  const error =
    actionError ||
    (settingsQuery.error ? errorMessage(settingsQuery.error) : '');
  const statusError = statusQuery.error ? errorMessage(statusQuery.error) : '';
  const generation = useRef(0);
  const apply = (next: Settings) => {
    setSettings(next);
    setMode(modeFor(next));
    setAge(next.policy?.maxAgeDays ?? '');
    setCount(next.policy?.maxCompletedRuns ?? '');
  };
  const refreshStatus = useCallback(async () => {
    await statusQuery.refetch();
  }, [statusQuery.refetch]);
  const load = async () => {
    const request = generation.current;
    setLoading(true);
    setError('');
    setSaved(false);
    try {
      const { data: next } = await settingsQuery.refetch({
        throwOnError: true,
      });
      if (request === generation.current && next) apply(next);
    } catch (e) {
      if (request === generation.current) setError(errorMessage(e));
    } finally {
      if (request === generation.current) setLoading(false);
    }
    if (request === generation.current) await refreshStatus();
  };
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
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
  useEffect(() => {
    if (settingsQuery.data && !dirty && !busy && !loading)
      apply(settingsQuery.data);
  }, [settingsQuery.data, dirty, busy, loading]);
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
                await queryClient.cancelQueries(
                  trpc.runs.retentionSettings.queryFilter({ workflowId }),
                );
                queryClient.setQueryData(
                  trpc.runs.retentionSettings.queryKey({ workflowId }),
                  next,
                );
                void queryClient.invalidateQueries({
                  ...trpc.runs.retentionSettings.pathFilter(),
                  refetchType: 'none',
                });
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
                <Text size="xs" c="dimmed">
                  A run tree includes its child and continuation runs. Either
                  limit can delete a tree, including failed or cancelled runs.
                  {workflowId
                    ? ' This override has its own count.'
                    : ' The count is shared by workflows that inherit this policy.'}
                </Text>
              </>
            )}
            <Text size="xs" c="dimmed">
              Cleanup permanently deletes run inputs, outputs, and usage. Active
              runs and protected history are kept. Changes apply when saved.
            </Text>
            <Group gap="sm" justify="flex-end">
              <Text size="sm" role="status">
                {saved ? 'Retention settings saved.' : ''}
              </Text>
              <Button
                type="submit"
                variant="primary"
                disabled={!dirty || !valid || busy || loading}
              >
                {busy ? 'Saving…' : 'Save retention settings'}
              </Button>
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
  returnFocusTo,
}: {
  workflowId?: string;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
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
      returnFocusTo={returnFocusTo}
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
