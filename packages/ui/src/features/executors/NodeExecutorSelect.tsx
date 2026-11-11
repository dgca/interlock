import { Select, Stack, Text } from '../../design-system';
import {
  firstEligiblePresetChoice,
  inheritsWorkflowHarnessSettings,
  presetPermissions,
  usesDirectHarness,
  type SavedModelAlias,
  type WorkflowDefinition,
} from '@interlock/core';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import {
  harnessLabel,
  isAvailableHarness,
  isPrimaryHarness,
} from './harnessProfiles';
import { ModelSettings } from './ModelSettings';
import { readModelAliases, inspectModelReference } from './modelAliasApi';
import { permissionLabels } from './permissions';

type Agent = Extract<WorkflowDefinition['nodes'][number], { kind: 'agent' }>;
type Selection = Pick<Agent, 'executor' | 'executorMode' | 'model' | 'effort'>;
const workflowDefault = 'workflow';
const connected = 'connected';

async function listPresets() {
  const items: SavedModelAlias[] = [];
  let offset = 0;
  while (true) {
    const page = await readModelAliases({ limit: 100, offset });
    items.push(...page.items);
    if (!page.truncated || !page.items.length) return items;
    offset += page.items.length;
  }
}

export function NodeExecutorSelect({
  node,
  definition,
  enabled,
  onChange,
  connectedSettings,
}: {
  node: Agent;
  definition?: WorkflowDefinition;
  enabled: boolean;
  onChange: (patch: Partial<Selection>) => void;
  connectedSettings: React.ReactNode;
}) {
  const profilesQuery = useQuery({
    ...trpc.executors.profiles.queryOptions(),
    enabled,
  });
  const presetsQuery = useQuery({
    queryKey: [...trpc.modelAliases.pathKey(), 'executor-options'],
    queryFn: listPresets,
    enabled,
  });
  const workflowModel = definition?.agentModel;
  const nodeReference =
    node.executorMode === 'harness' || node.executor === null
      ? undefined
      : node.model;
  const workflowAliasReference =
    definition?.agentModelMode === 'literal' ? undefined : workflowModel;
  const workflowAliasQuery = useQuery({
    queryKey: [
      ...trpc.modelAliases.pathKey(),
      'reference',
      workflowAliasReference,
    ],
    queryFn: () => inspectModelReference(workflowAliasReference!),
    enabled: enabled && !!workflowAliasReference,
  });
  const nodeAliasQuery = useQuery({
    queryKey: [...trpc.modelAliases.pathKey(), 'reference', nodeReference],
    queryFn: () => inspectModelReference(nodeReference!),
    enabled: enabled && !!nodeReference,
  });
  const profiles = profilesQuery.data ?? [];
  const presets = presetsQuery.data ?? [];
  const configuredProfile = (id?: string | null) =>
    profiles.find((profile) => profile.id === id);
  const availableProfile = (id?: string | null) => {
    const profile = configuredProfile(id);
    return profile && isAvailableHarness(profile) ? profile : undefined;
  };
  const workflowAlias = workflowAliasQuery.data?.alias;
  const nodeAlias = nodeAliasQuery.data?.alias;
  const strictWorkflowPreset = definition?.agentModelMode === 'preset';
  const workflowMissing =
    workflowAliasQuery.data?.missing ||
    (strictWorkflowPreset && workflowAliasQuery.isSuccess && !workflowAlias);
  const nodeMissing = nodeAliasQuery.data?.missing;
  const workflowUsesPreset = !!workflowAlias || !!workflowMissing;
  const workflowExecutor = definition?.executor;
  const workflowPermissions = definition?.agentPermissions;
  const choiceFor = (preset: SavedModelAlias, executor = workflowExecutor) =>
    firstEligiblePresetChoice(
      preset.candidates,
      executor,
      availableProfile,
      presetPermissions(preset.permissions, workflowPermissions),
    );
  const legacyCandidate = (preset: SavedModelAlias) =>
    preset.candidates.find(
      (item) => !item.profileId || configuredProfile(item.profileId)?.enabled,
    ) ?? preset.candidates[0];
  const legacyChoiceFor = (
    preset: SavedModelAlias,
    executor = workflowExecutor,
  ) => {
    if (preset.permissions) return choiceFor(preset, executor);
    const candidate = legacyCandidate(preset);
    const id = candidate?.profileId ?? executor;
    const profile = availableProfile(id);
    return candidate && id && profile
      ? { candidate, executor: id, profile }
      : undefined;
  };
  const workflowChoice =
    workflowAlias &&
    (strictWorkflowPreset
      ? choiceFor(workflowAlias)
      : legacyChoiceFor(workflowAlias));
  const defaultProfile = workflowUsesPreset
    ? workflowChoice?.profile
    : availableProfile(workflowExecutor);
  const loading =
    enabled &&
    (profilesQuery.isPending ||
      presetsQuery.isPending ||
      (!!workflowAliasReference && workflowAliasQuery.isPending) ||
      (!!nodeReference && nodeAliasQuery.isPending));
  const error =
    profilesQuery.isError ||
    presetsQuery.isError ||
    workflowAliasQuery.isError ||
    nodeAliasQuery.isError;

  const harnessOptions = profiles
    .filter(
      (profile) =>
        isAvailableHarness(profile) &&
        (isPrimaryHarness(profile) || profile.id === node.executor),
    )
    .map((profile) => ({
      value: `harness:${profile.id}`,
      label: harnessLabel(profile),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const presetOptions = presets
    .filter((preset) => choiceFor(preset))
    .map((preset) => ({ value: `preset:${preset.id}`, label: preset.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const effectiveLegacyAlias =
    !usesDirectHarness(node, definition) &&
    node.executorMode === undefined &&
    node.executor !== null
      ? (nodeAlias ?? (!node.model ? workflowAlias : undefined))
      : undefined;
  const savedPreset =
    node.executorMode === 'preset' ? nodeAlias : effectiveLegacyAlias;
  const savedChoice = savedPreset
    ? node.executorMode === 'preset'
      ? choiceFor(savedPreset)
      : legacyChoiceFor(savedPreset, node.executor ?? workflowExecutor)
    : undefined;
  const connectedThroughLegacyAlias =
    effectiveLegacyAlias &&
    !node.executor &&
    !workflowExecutor &&
    !effectiveLegacyAlias.permissions &&
    (!strictWorkflowPreset || !!node.model) &&
    !legacyCandidate(effectiveLegacyAlias)?.profileId;
  const legacyCombination = !!effectiveLegacyAlias && !!node.executor;
  const savedHarness = configuredProfile(node.executor);
  const selectedHarness = availableProfile(node.executor);
  const hasConfiguredDefault = !!workflowExecutor || workflowUsesPreset;
  const legacy = node.executorMode === undefined;
  const nodeMasksWorkflowPreset =
    legacy && !!node.model && !nodeAlias && !nodeMissing && workflowUsesPreset;
  const activeDefaultProfile = nodeMasksWorkflowPreset
    ? availableProfile(workflowExecutor)
    : defaultProfile;
  let value = connected;
  let savedLabel: string | undefined;
  let unavailable = false;
  if (node.executor === null || connectedThroughLegacyAlias) {
    value = connected;
  } else if (
    nodeMissing ||
    (legacy &&
      !node.model &&
      workflowMissing &&
      !usesDirectHarness(node, definition))
  ) {
    value = 'saved';
    savedLabel = node.model ?? 'Workflow default';
    unavailable = true;
  } else if (legacyCombination) {
    value = 'saved';
    savedLabel = `${savedHarness ? harnessLabel(savedHarness) : node.executor} + ${effectiveLegacyAlias.name} (saved)`;
    unavailable = !savedChoice;
  } else if (node.executorMode === 'preset' || (savedPreset && node.model)) {
    value = savedPreset ? `preset:${savedPreset.id}` : 'saved';
    if (
      !savedChoice ||
      !presetOptions.some((option) => option.value === value)
    ) {
      value = 'saved';
      savedLabel = savedPreset?.name ?? node.model;
      unavailable = !savedChoice;
    }
  } else if (node.executor) {
    value = `harness:${node.executor}`;
    if (!selectedHarness) {
      value = 'saved';
      savedLabel = savedHarness ? harnessLabel(savedHarness) : node.executor;
      unavailable = true;
    }
  } else if (activeDefaultProfile) {
    if (nodeMasksWorkflowPreset) {
      value = 'saved';
      savedLabel = `${harnessLabel(activeDefaultProfile)} (saved model override)`;
    } else value = workflowDefault;
  } else if (
    nodeMasksWorkflowPreset ? !!workflowExecutor : hasConfiguredDefault
  ) {
    value = 'saved';
    savedLabel = 'Workflow default';
    unavailable = true;
  }

  const options = [
    ...(defaultProfile
      ? [{ value: workflowDefault, label: 'Workflow default' }]
      : []),
    { value: connected, label: 'Connected agent' },
    ...(harnessOptions.length
      ? [{ group: 'Harnesses', items: harnessOptions }]
      : []),
    ...(presetOptions.length
      ? [{ group: 'Agent presets', items: presetOptions }]
      : []),
    ...(savedLabel
      ? [
          {
            value: 'saved',
            label: unavailable ? `${savedLabel} · unavailable` : savedLabel,
            disabled: true,
          },
        ]
      : []),
  ];
  const selectedProfile = unavailable
    ? undefined
    : (selectedHarness ??
      (value === workflowDefault || nodeMasksWorkflowPreset
        ? activeDefaultProfile
        : undefined));
  const showModels = !savedPreset && !!selectedProfile;
  const inheritSettings =
    selectedProfile &&
    ((legacy && !usesDirectHarness(node, definition)) ||
      inheritsWorkflowHarnessSettings(
        selectedProfile.id,
        workflowExecutor,
        workflowUsesPreset,
      ));
  const inheritedModel =
    (inheritSettings && !workflowUsesPreset ? workflowModel : undefined) ??
    selectedProfile?.model;
  const inheritedEffort =
    inheritSettings && definition?.agentEffort !== undefined
      ? definition.agentEffort
      : selectedProfile?.effort;
  const effectiveChoice =
    value === workflowDefault ? workflowChoice : savedChoice;
  const effectivePreset =
    value === workflowDefault ? workflowAlias : savedPreset;
  return (
    <Stack gap="sm" mb="md">
      <Select<string>
        label="Executor"
        description={
          !loading && value === workflowDefault && defaultProfile
            ? `Uses ${harnessLabel(defaultProfile)}${workflowAlias ? ` via ${workflowAlias.name}` : ''}.`
            : undefined
        }
        inputWrapperOrder={['label', 'input', 'description', 'error']}
        data={options}
        value={value}
        disabled={
          loading ||
          profilesQuery.isError ||
          workflowAliasQuery.isError ||
          nodeAliasQuery.isError
        }
        searchable
        allowDeselect={false}
        nothingFoundMessage="No matching executors"
        error={
          !loading && unavailable
            ? 'This saved executor is unavailable. Choose another executor or update its settings.'
            : undefined
        }
        onChange={(next) => {
          if (!next || next === value) return;
          const clear = {
            executor: undefined,
            executorMode: undefined,
            model: undefined,
            effort: undefined,
          };
          if (next === connected) onChange({ ...clear, executor: null });
          else if (next === workflowDefault) onChange(clear);
          else if (next.startsWith('harness:'))
            onChange({
              ...clear,
              executor: next.slice('harness:'.length),
              executorMode: 'harness',
            });
          else if (next.startsWith('preset:'))
            onChange({
              ...clear,
              model: next.slice('preset:'.length),
              executorMode: 'preset',
            });
        }}
      />
      {loading ? (
        <Text size="xs" c="dimmed">
          Checking executor availability…
        </Text>
      ) : error ? (
        <Text size="xs" role="alert">
          Some executor settings could not be loaded.
        </Text>
      ) : (
        <>
          {showModels && (
            <ModelSettings
              key={selectedProfile.id}
              label="Model"
              defaultLabel={
                inheritSettings && workflowModel && !workflowUsesPreset
                  ? 'Use workflow default'
                  : 'Use harness default'
              }
              effortDefaultLabel={
                inheritSettings && definition?.agentEffort !== undefined
                  ? 'Use workflow default'
                  : 'Use harness default'
              }
              profileId={selectedProfile.id}
              model={node.model}
              effort={node.effort}
              inheritedModel={inheritedModel}
              inheritedEffort={inheritedEffort}
              onModelChange={(model) => {
                if (legacy && node.executor) {
                  onChange({
                    model,
                    executorMode: 'harness',
                    ...(node.effort === undefined &&
                    !inheritsWorkflowHarnessSettings(
                      node.executor,
                      workflowExecutor,
                      workflowUsesPreset,
                    )
                      ? { effort: definition?.agentEffort }
                      : {}),
                  });
                } else onChange({ model });
              }}
              showInheritedModel
              onEffortChange={(effort) => onChange({ effort })}
              alwaysShowEffort
            />
          )}
          {effectiveChoice && effectivePreset && (
            <Text size="xs" c="dimmed">
              {effectiveChoice.candidate === effectivePreset.candidates[0]
                ? 'Primary choice'
                : 'Eligible fallback'}
              : {harnessLabel(effectiveChoice.profile)} ·{' '}
              {effectiveChoice.candidate.model}
              {effectiveChoice.candidate.effort
                ? ` · ${effectiveChoice.candidate.effort} effort`
                : ''}
              {' · '}
              {
                permissionLabels[
                  presetPermissions(
                    effectivePreset.permissions,
                    workflowPermissions,
                  ) ?? effectiveChoice.profile.permissions
                ]
              }
              {effectiveChoice.profile.harness === 'custom' ? ' requested' : ''}
            </Text>
          )}
          {!effectivePreset && selectedProfile && (
            <Text size="xs" c="dimmed">
              {
                permissionLabels[
                  workflowPermissions ?? selectedProfile.permissions
                ]
              }{' '}
              {selectedProfile.harness === 'custom'
                ? ' requested'
                : ' permissions'}{' '}
              · {workflowPermissions ? 'workflow override' : 'harness default'}
            </Text>
          )}
          {value === connected && (
            <>
              <Text size="xs" c="dimmed">
                An agent connected through MCP picks up the assignment.
              </Text>
              {connectedSettings}
            </>
          )}
        </>
      )}
      <Text size="xs">
        <a href={paths.harnesses} target="_blank" rel="noreferrer">
          Manage harnesses and presets
        </a>
      </Text>
    </Stack>
  );
}
