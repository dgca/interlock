import { useEffect, useState } from 'react';
import { NativeSelect } from '@mantine/core';
import { api, errorMessage } from '../../lib/api';
import { paths } from '../../routes/paths';
import type { ExecutorPermissionMode } from '@interlock/core';
import { ModelSettings } from './ModelSettings';
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
  workflowEffort,
  onEffortChange,
  nodeModel,
  nodeEffort,
  onNodeModelChange,
  onNodeEffortChange,
}: {
  value: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
  inherit?: string;
  enabled?: boolean;
  workflowPermissions?: ExecutorPermissionMode;
  onPermissionsChange?: (mode: ExecutorPermissionMode | undefined) => void;
  workflowModel?: string;
  onModelChange?: (model: string | undefined) => void;
  workflowEffort?: string | null;
  onEffortChange?: (value: string | null | undefined) => void;
  nodeModel?: string;
  nodeEffort?: string | null;
  onNodeModelChange?: (value: string | undefined) => void;
  onNodeEffortChange?: (value: string | null | undefined) => void;
}) {
  const [profiles, setProfiles] =
    useState<Awaited<ReturnType<typeof api.executors.profiles.query>>>();
  const [error, setError] = useState('');
  const [concurrency, setConcurrency] = useState<number | null>();
  const [concurrencyError, setConcurrencyError] = useState('');
  const workflowSettings = !!(onPermissionsChange || onModelChange);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    if (workflowSettings)
      void api.executors.settings
        .query()
        .then((settings) => {
          if (alive) {
            setConcurrency(settings.concurrency);
            setConcurrencyError('');
          }
        })
        .catch(() => {
          if (alive)
            setConcurrencyError('Shared assignment limit could not be loaded.');
        });
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
  }, [enabled, workflowSettings]);
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
            Workflow default · {inherit || 'No default harness'}
          </option>
        )}
        <option value="__manual">
          {workflowSettings ? 'No default harness' : 'Connected agent'}
        </option>
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
          ? 'Default harness for managed work. A model alias can select a different harness.'
          : inherit !== undefined && value === undefined
            ? 'Uses the workflow’s harness and model defaults. A model alias can select a different harness.'
            : workflowSettings
              ? 'A model alias can select a harness. Otherwise, a connected agent picks up the assignment.'
              : 'An agent connected through MCP picks up the assignment.'}{' '}
        <a
          href={`${paths.harnesses}#harnesses`}
          target="_blank"
          rel="noreferrer"
        >
          Manage harnesses
        </a>
      </p>
      {workflowSettings && (concurrency !== undefined || concurrencyError) && (
        <p className="hint">
          {concurrencyError ||
            (concurrency === null
              ? 'No shared assignment limit. Interlock starts every ready assignment; workflow requirements and resource coordination still apply.'
              : `Up to ${concurrency} Agent assignments at once across all harnesses and workflows.`)}{' '}
          <a
            href={`${paths.harnesses}#concurrency`}
            target="_blank"
            rel="noreferrer"
          >
            Manage shared limit
          </a>
        </p>
      )}
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
      {(onModelChange || (value !== null && onNodeModelChange)) && (
        <div style={{ marginTop: 20 }}>
          <ModelSettings
            allowAliases
            modelHint={`${nodeModel && onNodeModelChange ? `${nodeModel} · node override.` : workflowModel ? `${workflowModel} · ${onNodeModelChange ? 'inherited from workflow' : 'workflow override'}.` : profile ? `${profile.model ?? 'CLI default'} · inherited from ${profile.name}.` : 'Each managed Agent uses its selected harness’s default model.'}${onModelChange ? ' Agent nodes can override the model and thinking effort. Connected agents keep their own settings.' : ''}`}
            label={onNodeModelChange ? 'Model' : 'Agent model'}
            defaultLabel={
              onNodeModelChange ? 'Use workflow default' : 'Use harness default'
            }
            effortDefaultLabel={
              onNodeModelChange ? 'Use workflow default' : 'Use harness default'
            }
            profileId={profile?.id}
            model={onNodeModelChange ? nodeModel : workflowModel}
            effort={onNodeModelChange ? nodeEffort : workflowEffort}
            inheritedModel={
              onNodeModelChange
                ? (workflowModel ?? profile?.model)
                : profile?.model
            }
            inheritedEffort={
              onNodeModelChange && workflowEffort !== undefined
                ? workflowEffort
                : profile?.effort
            }
            onModelChange={onNodeModelChange ?? onModelChange!}
            onEffortChange={onNodeEffortChange ?? onEffortChange ?? (() => {})}
          />
        </div>
      )}
    </div>
  );
}
