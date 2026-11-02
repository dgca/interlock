import { useEffect, useState } from 'react';
import { NativeSelect } from '@mantine/core';
import { api, errorMessage } from '../../lib/api';
import type { ExecutorPermissionMode } from '@interlock/core';
import { ModelPicker } from './ModelPicker';
import {
  permissionLabels,
  permissionDescriptions,
  permissionOptions,
} from './permissions';

export function ExecutorSelect({
  value,
  onChange,
  inherit,
  enabled = true,
  workflowPermissions,
  onPermissionsChange,
  workflowModel,
  onModelChange,
}: {
  value: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
  inherit?: string;
  enabled?: boolean;
  workflowPermissions?: ExecutorPermissionMode;
  onPermissionsChange?: (mode: ExecutorPermissionMode | undefined) => void;
  workflowModel?: string;
  onModelChange?: (model: string | undefined) => void;
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
  const selected = value === undefined ? inherit : value;
  const profile = profiles?.find((p) => p.id === selected);
  const effective = workflowPermissions ?? profile?.permissions;
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
      {onPermissionsChange && (
        <NativeSelect
          mt="md"
          label="Agent permissions"
          value={workflowPermissions ?? '__default'}
          onChange={(e) =>
            onPermissionsChange(
              e.currentTarget.value === '__default'
                ? undefined
                : (e.currentTarget.value as ExecutorPermissionMode),
            )
          }
          data={[
            { value: '__default', label: 'Use harness default' },
            ...permissionOptions,
          ]}
        />
      )}
      {(selected || onPermissionsChange) && (
        <p className="hint">
          {effective ? (
            <>
              {permissionLabels[effective]} ·{' '}
              {workflowPermissions
                ? 'workflow override'
                : `inherited from ${profile?.name ?? selected}`}
              . {permissionDescriptions[effective]}
            </>
          ) : (
            'Each managed Agent uses its selected harness’s default permissions.'
          )}
          {onPermissionsChange &&
            !selected &&
            ' Connected agents keep their own permissions.'}
        </p>
      )}
      {error && (
        <p role="alert" className="hint">
          Harness settings could not be loaded. {error}
        </p>
      )}
      {onModelChange && (
        <div style={{ marginTop: 20 }}>
          <ModelPicker
            label="Agent model"
            defaultLabel="Use harness default"
            profileId={profile?.id}
            value={workflowModel}
            onChange={onModelChange}
          />
        </div>
      )}
      {(selected || onModelChange) && (
        <p className="hint">
          {workflowModel
            ? `${workflowModel} · workflow override.`
            : profile
              ? `${profile.model ?? 'CLI default'} · inherited from ${profile.name}.`
              : 'Each managed Agent uses its selected harness’s default model.'}
          {onModelChange &&
            ' Applies to all managed Agents, including node-specific executors. Connected agents keep their own model.'}
        </p>
      )}
    </div>
  );
}
