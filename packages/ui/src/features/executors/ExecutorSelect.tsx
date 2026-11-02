import { useEffect, useState } from 'react';
import { NativeSelect } from '@mantine/core';
import { api, errorMessage } from '../../lib/api';

export function ExecutorSelect({
  value,
  onChange,
  inherit,
  enabled = true,
}: {
  value: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
  inherit?: string;
  enabled?: boolean;
}) {
  const [profiles, setProfiles] =
    useState<Awaited<ReturnType<typeof api.executors.profiles.query>>>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void api.executors.profiles
      .query()
      .then((p) => {
        if (alive) setProfiles(p);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return (
    <div style={{ marginBottom: 20 }}>
      <NativeSelect
        label={inherit !== undefined ? 'Executor' : 'Default Agent executor'}
        value={
          value ??
          (inherit !== undefined && value === undefined
            ? '__inherit'
            : '__manual')
        }
        onChange={(e) =>
          onChange(
            e.currentTarget.value === '__inherit'
              ? undefined
              : e.currentTarget.value === '__manual'
                ? null
                : e.currentTarget.value,
          )
        }
      >
        {inherit !== undefined && (
          <option value="__inherit">
            Workflow default · {inherit || 'Connected agent'}
          </option>
        )}
        <option value="__manual">Connected agent</option>
        {profiles?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {!p.enabled ? ' · disabled' : ''}
          </option>
        ))}
        {value && !profiles?.some((p) => p.id === value) && (
          <option value={value}>{value} · not configured</option>
        )}
      </NativeSelect>
      <p className="hint">
        {value
          ? 'Interlock starts this harness when the assignment is ready.'
          : inherit !== undefined && value === undefined && inherit
            ? 'Uses this workflow’s automatic executor unless overridden here.'
            : 'An agent connected through MCP picks up the assignment.'}{' '}
        <a href="/settings/harnesses" target="_blank" rel="noreferrer">
          Manage harnesses
        </a>
      </p>
      {error && (
        <p role="alert" className="hint">
          Harness settings could not be loaded. {error}
        </p>
      )}
    </div>
  );
}
