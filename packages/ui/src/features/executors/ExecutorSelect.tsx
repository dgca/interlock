import { NativeSelect, SimpleGrid, Stack } from '../../design-system';

import { errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import type { ExecutorPermissionMode } from '@interlock/core';
import {
  harnessLabel,
  isAvailableHarness,
  isPrimaryHarness,
} from './harnessProfiles';
import { ModelSettings } from './ModelSettings';
import {
  permissionLabels,
  permissionDescriptions,
  permissionOptions,
} from './permissions';

export function ExecutorSelect({
  value,
  onChange,
  enabled = true,
  workflowPermissions,
  onPermissionsChange,
  workflowModel,
  workflowModelMode,
  onModelChange,
  workflowEffort,
  onEffortChange,
}: {
  value: string | null | undefined;
  onChange: (value: string | null | undefined) => void;
  enabled?: boolean;
  workflowPermissions?: ExecutorPermissionMode;
  onPermissionsChange?: (mode: ExecutorPermissionMode | undefined) => void;
  workflowModel?: string;
  onModelChange?: (
    model: string | undefined,
    mode?: 'literal' | 'preset',
  ) => void;
  workflowModelMode?: 'literal' | 'preset';
  workflowEffort?: string | null;
  onEffortChange?: (value: string | null | undefined) => void;
}) {
  const workflowSettings = !!(onPermissionsChange || onModelChange);
  const profilesQuery = useQuery({
    ...trpc.executors.profiles.queryOptions(),
    enabled,
  });
  const settingsQuery = useQuery({
    ...trpc.executors.settings.queryOptions(),
    enabled: enabled && workflowSettings,
  });
  const profiles = profilesQuery.data;
  const error = profilesQuery.error ? errorMessage(profilesQuery.error) : '';
  const concurrency = settingsQuery.data?.concurrency;
  const concurrencyError = settingsQuery.error
    ? 'Shared assignment limit could not be loaded.'
    : '';
  const profile = profiles?.find((p) => p.id === value);
  const effective = workflowPermissions ?? profile?.permissions;
  return (
    <Stack gap="sm" mb="md">
      <SimpleGrid
        cols={{ base: 1, sm: onPermissionsChange ? 2 : 1 }}
        spacing="sm"
      >
        <div>
          <NativeSelect
            label="Default Agent executor"
            value={value ?? '__manual'}
            onChange={(e) =>
              onChange(
                e.currentTarget.value === '__manual'
                  ? null
                  : e.currentTarget.value,
              )
            }
          >
            <option value="__manual">No default harness</option>
            {profiles
              ?.filter(
                (p) =>
                  p.id === value ||
                  (isPrimaryHarness(p) && isAvailableHarness(p)),
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {harnessLabel(p)}
                  {!p.enabled ? ' · disabled' : ''}
                </option>
              ))}
            {value && !profiles?.some((p) => p.id === value) && (
              <option value={value}>{value} · not configured</option>
            )}
          </NativeSelect>
          <p className="hint">
            {value
              ? 'An Agent preset can select a different harness.'
              : 'An agent preset can select a harness. Otherwise, a connected agent picks up the assignment.'}{' '}
            <a
              href={`${paths.harnesses}#harnesses`}
              target="_blank"
              rel="noreferrer"
            >
              Manage harnesses
            </a>
          </p>
        </div>
        {onPermissionsChange && (
          <div>
            <NativeSelect
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
            <p className="hint">
              {effective ? (
                <>
                  {permissionLabels[effective]} ·{' '}
                  {workflowPermissions
                    ? 'workflow override'
                    : `inherited from ${profile?.name ?? value}`}
                  . {permissionDescriptions[effective]}
                </>
              ) : (
                'Each managed Agent uses its selected harness’s default permissions.'
              )}
              {!value && ' Connected agents keep their own permissions.'}
            </p>
          </div>
        )}
      </SimpleGrid>
      {onModelChange && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <ModelSettings
            allowAliases
            compact
            referenceMode={workflowModelMode}
            modelHint={
              !workflowModel && profile
                ? `${profile.model ?? 'CLI default'} · inherited from ${harnessLabel(profile)}.`
                : undefined
            }
            label="Agent model"
            defaultLabel="Use harness default"
            effortDefaultLabel="Use harness default"
            profileId={profile?.id}
            model={workflowModel}
            effort={workflowEffort}
            inheritedModel={profile?.model}
            inheritedEffort={profile?.effort}
            onModelChange={onModelChange}
            onEffortChange={onEffortChange ?? (() => {})}
          />
        </SimpleGrid>
      )}
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
      {error && (
        <p role="alert" className="hint">
          Harness settings could not be loaded. {error}
        </p>
      )}
    </Stack>
  );
}
