import { useEffect, useState } from 'react';
import {
  executorSettingsSchema,
  type ExecutorPermissionMode,
} from '@interlock/core';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  NativeSelect,
  Radio,
  Skeleton,
  Stack,
  VisuallyHidden,
} from '../../design-system';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery, useQueryClient } from '../../lib/query';
import { permissionLabels, permissionOptions } from './permissions';
import styles from './Harnesses.module.css';

type Settings = ReturnType<typeof executorSettingsSchema.parse>;

const defaultDescriptions: Record<ExecutorPermissionMode, string> = {
  'read-only': 'Agents inspect and analyze without modifying files.',
  standard:
    'Agents use the harness’s Standard mode and ask before actions that need approval.',
  'full-access':
    'Agents run commands and edit files without asking. The harness sandbox and approval prompts are off.',
};

/**
 * Saves the shared default with the settings revision the caller read. With
 * `retryStale`, a failed save rereads the settings and tries once more.
 */
function useSaveDefaultPermissions() {
  const queryClient = useQueryClient();
  const save = async (
    settings: Settings,
    mode: ExecutorPermissionMode,
    retryStale = false,
  ): Promise<Settings> => {
    try {
      const next = executorSettingsSchema.parse(
        await api.executors.manage.mutate({
          action: 'save_settings',
          expectedRevision: settings.revision,
          concurrency: settings.concurrency,
          defaultPermissions: mode,
        }),
      );
      await queryClient.cancelQueries(trpc.executors.settings.queryFilter());
      queryClient.setQueryData(trpc.executors.settings.queryKey(), next);
      return next;
    } catch (error) {
      if (!retryStale) throw error;
      const latest = await queryClient.fetchQuery({
        ...trpc.executors.settings.queryOptions(),
        staleTime: 0,
      });
      return save(latest, mode);
    }
  };
  return save;
}

/** Execution settings card for the level harnesses and workflows inherit. */
export function DefaultPermissionsSettings({
  onDirty,
}: {
  onDirty?: (dirty: boolean) => void;
}) {
  const query = useQuery(trpc.executors.settings.queryOptions());
  const saveDefault = useSaveDefaultPermissions();
  const [mode, setMode] = useState<ExecutorPermissionMode>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const current = query.data?.defaultPermissions;
  // '' is the unset state, which runs as Standard until a level is saved.
  const selected = mode ?? current ?? '';
  const dirty = !!mode && mode !== current;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  if (!query.data)
    return query.error ? null : (
      <Skeleton height={80} aria-label="Loading default agent permissions" />
    );
  const settings = query.data;
  const save = async () => {
    if (!dirty || busy || !mode) return;
    setBusy(true);
    setError('');
    try {
      await saveDefault(settings, mode);
      setMode(undefined);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={styles.sharedForm}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className={styles.sharedCopy}>
        <h3 className={styles.sharedLabel}>Default agent permissions</h3>
        <p>{defaultDescriptions[selected || 'standard']}</p>
        <p className={styles.sharedNote}>
          Applies to managed Agents whose harness and workflow set no level.
          Running assignments keep their mode.
        </p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      <div className={styles.sharedControls}>
        <NativeSelect
          aria-label="Default agent permissions"
          value={selected}
          disabled={busy}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setMode(value ? (value as ExecutorPermissionMode) : undefined);
            setSaved(false);
          }}
          data={[
            ...(current ? [] : [{ value: '', label: 'Not set (Standard)' }]),
            ...permissionOptions,
          ]}
        />
        <Button type="submit" variant="primary" disabled={!dirty || busy}>
          {busy ? 'Saving…' : saved && !dirty ? 'Saved' : 'Save'}
        </Button>
        <VisuallyHidden role="status">
          {saved ? 'Default agent permissions saved.' : ''}
        </VisuallyHidden>
      </div>
    </form>
  );
}

const firstChoices = [
  {
    value: 'full-access',
    label: permissionLabels['full-access'],
    description: defaultDescriptions['full-access'],
  },
  {
    value: 'standard',
    label: 'Ask before actions (Standard)',
    description:
      'Agents stop for your approval before commands and file changes the harness does not allow on its own.',
  },
] as const;

/**
 * Asked once, when a person enables a harness before choosing a shared
 * default. Saves the default, then enables the harness; Cancel changes nothing.
 */
export function FirstEnableDialog({
  harness,
  settings,
  onEnable,
  onCancel,
}: {
  harness: string;
  settings: Settings;
  onEnable: () => Promise<void>;
  onCancel: () => void;
}) {
  const saveDefault = useSaveDefaultPermissions();
  const [mode, setMode] = useState<ExecutorPermissionMode>('full-access');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await saveDefault(settings, mode, true);
      await onEnable();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="How should managed agents run?"
      onClose={() => !busy && onCancel()}
      busy={busy}
      size={480}
    >
      <ModalBody>
        <Radio.Group
          aria-label="Default agent permissions"
          value={mode}
          onChange={(value) => setMode(value)}
        >
          <Stack gap="md">
            {firstChoices.map((choice) => (
              <Radio
                key={choice.value}
                value={choice.value}
                label={choice.label}
                description={choice.description}
                disabled={busy}
              />
            ))}
          </Stack>
        </Radio.Group>
        <p className="hint">
          Harnesses and workflows can set their own level. Change this later in
          AI Settings → Execution settings.
        </p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          data-autofocus
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? 'Enabling…' : `Enable ${harness}`}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
