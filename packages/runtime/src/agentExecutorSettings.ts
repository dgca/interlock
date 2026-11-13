import {
  agentAliasReference,
  eligiblePresetChoices,
  inheritsWorkflowHarnessSettings,
  InterlockError,
  presetPermissions,
  type Run,
  selectsPreset,
  usesDirectHarness,
  type WorkflowDefinition,
  type WorkRequest,
} from '@interlock/core';
import type { ContextContinuityGroups } from './contextContinuity.js';
import type { ExecutorManager } from './executors/manager.js';
import type { ModelAliases } from './modelAliases.js';

/** Resolves the harness, model, effort and permissions for an Agent assignment. */
export class AgentExecutorSettings {
  constructor(
    private readonly modelAliases: ModelAliases,
    private readonly executors: ExecutorManager,
    private readonly contextGroups: ContextContinuityGroups,
    private readonly options: { substituteOperation?: unknown },
  ) {}
  resolve(
    run: Run,
    definition: WorkflowDefinition,
    node: Extract<WorkflowDefinition['nodes'][number], { kind: 'agent' }>,
  ): Partial<WorkRequest> | undefined {
    if (node.executor === null) return {};
    const captures = run.modelAliasCaptures;
    const legacy = node.executorMode === undefined;
    const direct = usesDirectHarness(node, definition);
    const target = node.model ?? definition.agentModel;
    const aliasRef = agentAliasReference(node, definition);
    const alias = aliasRef
      ? captures
        ? this.modelAliases.capturedAlias(captures, aliasRef)
        : this.modelAliases.get(aliasRef)
      : undefined;
    const workflowRef = definition.agentModel;
    const workflowHasPreset =
      definition.agentModelMode === 'preset' ||
      (definition.agentModelMode !== 'literal' &&
        !!workflowRef &&
        (run.ignoredWorkflowModelAlias === workflowRef ||
          !!(captures
            ? this.modelAliases.capturedAlias(captures, workflowRef)
            : this.modelAliases.get(workflowRef))));
    const preset =
      !this.options.substituteOperation &&
      (selectsPreset(node, definition) ||
        (captures !== undefined && alias?.permissions !== undefined));
    const profiles = this.executors.profiles();
    let executor = node.executor ?? definition.executor;
    let model = target;
    let effort =
      node.effort !== undefined ? node.effort : definition.agentEffort;
    let effortSource: WorkRequest['executorEffortSource'] =
      node.effort === undefined ? 'workflow' : 'node';
    let permissions = definition.agentPermissions;
    let permissionSource: WorkRequest['executorPermissionsSource'] = direct
      ? permissions
        ? 'workflow'
        : 'harness'
      : undefined;
    let selection: WorkRequest['modelAliasSelection'];

    if (direct && node.executor) {
      if (
        !inheritsWorkflowHarnessSettings(
          node.executor,
          definition.executor,
          workflowHasPreset,
        )
      ) {
        model = node.model;
        effort = node.effort;
      }
    } else if (aliasRef) {
      const candidates = this.modelAliases.expandCandidates(captures, aliasRef);
      if (preset) {
        const override = presetPermissions(
          alias?.permissions,
          definition.agentPermissions,
        );
        const binding = node.context.continuityGroup
          ? this.contextGroups.describe(run.id, node.context.continuityGroup)
              .session
          : undefined;
        const choices = alias && [
          ...eligiblePresetChoices(
            candidates,
            executor,
            (id) =>
              !binding || binding.executorId === id
                ? this.executors.configuredPresetProfile(
                    profiles.find((profile) => profile.id === id),
                  )
                : undefined,
            override,
          ),
        ];
        // Probe in parallel but never select a fallback before its predecessors resolve.
        const readiness =
          choices &&
          choices.map((choice) =>
            this.executors.presetProfileReady(choice.profile),
          );
        const first =
          readiness && readiness.findIndex((ready) => ready !== false);
        if (
          typeof first === 'number' &&
          first >= 0 &&
          readiness &&
          readiness[first] === undefined
        )
          return undefined;
        const choice =
          choices && typeof first === 'number' && first >= 0
            ? choices[first]
            : undefined;
        if (!choice)
          throw new InterlockError(
            `Agent preset "${aliasRef}" has no eligible harness for ${node.label}.`,
          );
        executor = choice.executor;
        model = choice.candidate.model;
        selection = choice.candidate.modelAliasSelection;
        permissions = override ?? choice.profile.permissions;
        permissionSource = !override
          ? 'harness'
          : override === definition.agentPermissions
            ? 'workflow'
            : 'preset';
        if (node.effort === undefined) {
          const inheritEffort =
            node.model === undefined ||
            inheritsWorkflowHarnessSettings(
              choice.executor,
              definition.executor,
              workflowHasPreset,
            );
          effort =
            choice.candidate.effort !== undefined
              ? choice.candidate.effort
              : inheritEffort
                ? definition.agentEffort
                : undefined;
          effortSource =
            choice.candidate.effort !== undefined && node.model
              ? 'node'
              : 'workflow';
        }
      } else if (legacy) {
        // Existing definitions keep alias-first routing, including the stored fallback
        // to the first candidate when a profile is disabled after run start.
        const candidate =
          candidates.find(
            (candidate) =>
              !candidate.profileId ||
              profiles.some(
                (profile) =>
                  profile.id === candidate.profileId && profile.enabled,
              ),
          ) ?? candidates[0];
        executor = candidate?.profileId ?? executor;
        model = candidate?.model ?? model;
        selection = candidate?.modelAliasSelection;
        if (candidate?.effort !== undefined) {
          effort = candidate.effort;
          effortSource = 'node';
        }
      }
    }

    return {
      ...(selection ? { modelAliasSelection: selection } : {}),
      ...(model
        ? {
            executorModel: model,
            executorModelSource: node.model ? 'node' : 'workflow',
          }
        : {}),
      ...(executor
        ? {
            executor,
            ...(effort !== undefined
              ? { executorEffort: effort, executorEffortSource: effortSource }
              : {}),
            ...(permissions ? { executorPermissions: permissions } : {}),
            ...(permissionSource
              ? { executorPermissionsSource: permissionSource }
              : {}),
          }
        : {}),
    };
  }
}
