import { useEffect, useState } from 'react';
import type { ScriptApprovalMode } from '@interlock/core';
import {
  Button,
  NativeSelect,
  Skeleton,
  VisuallyHidden,
} from '../../design-system';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery, useQueryClient } from '../../lib/query';
import styles from './Harnesses.module.css';

const choices: { value: ScriptApprovalMode; label: string; help: string }[] = [
  {
    value: 'imports',
    label: 'Imported Scripts',
    help: 'Scripts from imported workflows wait for your approval before their first run. Scripts you or a connected agent write run without approval.',
  },
  {
    value: 'imports_and_agents',
    label: 'Imported and agent Scripts',
    help: 'Scripts from imported workflows, and Scripts an agent adds or changes over MCP, wait for your approval before their first run.',
  },
  {
    value: 'off',
    label: 'Off',
    help: 'Every Script runs without approval, including Scripts from imported workflows.',
  },
];

/** Library setting for which Script content needs a person's approval. */
export function ScriptApprovalSettings({
  onDirty,
}: {
  onDirty?: (dirty: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery(trpc.scripts.settings.queryOptions());
  const [mode, setMode] = useState<ScriptApprovalMode>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const current = query.data?.mode;
  const selected = mode ?? current;
  const dirty = !!mode && mode !== current;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.scripts.saveSettings.mutate({ mode });
      queryClient.setQueryData(trpc.scripts.settings.queryKey(), next);
      setMode(undefined);
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!selected)
    return query.error ? (
      <p role="alert" className={styles.error}>
        {errorMessage(query.error)}
      </p>
    ) : (
      <Skeleton height={80} aria-label="Loading Script approval" />
    );
  return (
    <form
      className={styles.sharedForm}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className={styles.sharedCopy}>
        <h3 className={styles.sharedLabel}>Script approval</h3>
        <p>{choices.find((choice) => choice.value === selected)?.help}</p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      <div className={styles.sharedControls}>
        <NativeSelect
          aria-label="Scripts that need approval"
          value={selected}
          disabled={busy}
          onChange={(event) => {
            setMode(event.currentTarget.value as ScriptApprovalMode);
            setSaved(false);
          }}
          data={choices.map(({ value, label }) => ({ value, label }))}
        />
        <Button type="submit" variant="primary" disabled={!dirty || busy}>
          {busy ? 'Saving…' : saved && !dirty ? 'Saved' : 'Save'}
        </Button>
        <VisuallyHidden role="status">
          {saved ? 'Script approval saved.' : ''}
        </VisuallyHidden>
      </div>
    </form>
  );
}
