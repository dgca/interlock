import {
  normalizeProvider,
  resolveProvider,
  type ProviderDiversityBlock,
  type Run,
  type WorkflowNode,
  type WorkflowDefinition,
  type ExecutorProfile,
  type ExpandedModelCandidate,
  type ModelAliasSelection,
} from '@interlock/core';
import type { Engine } from './index.js';

export type ProviderDiversityEvaluation =
  | {
      status: 'selected';
      candidate: string;
      modelAliasSelection?: ModelAliasSelection;
      candidateProfileId?: string;
      candidateEffort?: string | null;
      provider: string;
      excludedProviders: string[];
    }
  | {
      status: 'blocked';
      reason: 'provider_diversity_unmet' | 'provider_diversity_exhausted';
      excludedProviders: string[];
      details?: string;
    };

export function evaluateProviderDiversity(options: {
  run: Run;
  node: Extract<WorkflowNode, { kind: 'agent' }>;
  definition: WorkflowDefinition;
  engine: Engine;
  profiles: ExecutorProfile[];
  prefixOverrides?: Record<string, string>;
}): ProviderDiversityEvaluation | null {
  const { run, node, definition, engine, profiles, prefixOverrides } = options;
  if (!node.distinctProviderFrom || node.distinctProviderFrom.length === 0) {
    return null;
  }

  const excludedProviders = new Set<string>();

  for (const upstreamId of node.distinctProviderFrom) {
    const executions = run.executions.filter(
      (e) => e.nodeId === upstreamId && e.status === 'completed',
    );
    if (!executions.length) {
      return {
        status: 'blocked',
        reason: 'provider_diversity_unmet',
        excludedProviders: Array.from(excludedProviders),
        details: `Upstream node "${upstreamId}" has not completed yet`,
      };
    }

    const latestExec = executions[executions.length - 1];
    let provider: string | null = null;

    if (latestExec.provenance?.provider) {
      provider = normalizeProvider(latestExec.provenance.provider);
    } else {
      const model =
        latestExec.provenance?.actualModel ??
        latestExec.provenance?.requestedModel;
      const profile = latestExec.provenance?.profileId
        ? profiles.find((p) => p.id === latestExec.provenance!.profileId)
        : null;

      provider = resolveProvider({
        model,
        profile,
        prefixOverrides,
      });

      if (!provider) {
        // Try to check work request
        const work = engine.store
          .work(undefined, run.id)
          .find((w) => w.executionId === latestExec.id);
        if (work) {
          const workProfile = work.executor
            ? profiles.find((p) => p.id === work.executor)
            : null;
          provider = resolveProvider({
            model: work.modelSelection?.model ?? work.executorModel,
            catalogProvider: work.modelSelection?.provider,
            profile: workProfile,
            prefixOverrides,
          });
        }
      }

      if (!provider) {
        // Try to check upstream node definition
        const upstreamDef = definition.nodes.find(
          (n) => n.id === upstreamId && n.kind === 'agent',
        ) as Extract<WorkflowNode, { kind: 'agent' }> | undefined;
        if (upstreamDef?.model) {
          const aliasCandidates = engine.modelAliases.resolveCandidates(
            run.modelAliasCaptures,
            upstreamDef.model,
          );
          const modelToCheck = aliasCandidates?.[0]?.model ?? upstreamDef.model;
          const profileToCheck = aliasCandidates?.[0]?.profileId
            ? profiles.find((p) => p.id === aliasCandidates[0].profileId)
            : undefined;
          provider = resolveProvider({
            model: profileToCheck?.model ?? modelToCheck,
            profile: profileToCheck,
            prefixOverrides,
          });
        }
        if (!provider && upstreamDef?.context.continuityGroup) {
          const binding = engine.contextGroups.describe(
            run.id,
            upstreamDef.context.continuityGroup,
          );
          if (binding.session?.executorId) {
            const groupProfile = profiles.find(
              (p) => p.id === binding.session!.executorId,
            );
            provider = resolveProvider({
              profile: groupProfile,
              prefixOverrides,
            });
          }
        }
      }
    }

    if (!provider) {
      return {
        status: 'blocked',
        reason: 'provider_diversity_unmet',
        excludedProviders: Array.from(excludedProviders),
        details: `Provider for upstream node "${upstreamId}" could not be determined`,
      };
    }

    excludedProviders.add(provider);
  }

  // Check continuity group of current node
  if (node.context.continuityGroup) {
    const binding = engine.contextGroups.describe(
      run.id,
      node.context.continuityGroup,
    );
    if (binding.session) {
      const pinnedProfile = profiles.find(
        (p) => p.id === binding.session!.executorId,
      );
      // Check prior session in store
      const sessionKey = JSON.stringify([
        run.id,
        node.context.continuityGroup,
        binding.session.sessionId,
      ]);
      const priorSession = engine.store.get<{
        profile?: ExecutorProfile;
        requestedModel?: string;
      }>('sessions', sessionKey);

      const pinnedProvider = resolveProvider({
        model:
          priorSession?.requestedModel ??
          priorSession?.profile?.model ??
          pinnedProfile?.model,
        profile: priorSession?.profile ?? pinnedProfile,
        prefixOverrides,
      });

      if (pinnedProvider && excludedProviders.has(pinnedProvider)) {
        return {
          status: 'blocked',
          reason: 'provider_diversity_exhausted',
          excludedProviders: Array.from(excludedProviders),
          details: `Continuity group pinned provider "${pinnedProvider}" is excluded by upstream diversity constraint`,
        };
      }

      if (pinnedProvider) {
        return {
          status: 'selected',
          candidate:
            priorSession?.requestedModel ??
            priorSession?.profile?.model ??
            pinnedProfile?.model ??
            binding.session.executorId,
          provider: pinnedProvider,
          excludedProviders: Array.from(excludedProviders),
        };
      }
    }
  }

  // Determine candidates
  const configuredProfile =
    (node.executor ?? definition.executor)
      ? profiles.find((p) => p.id === (node.executor ?? definition.executor))
      : null;

  const rawCandidates: string[] = [];
  if (node.candidateModels && node.candidateModels.length > 0) {
    rawCandidates.push(...node.candidateModels);
  } else if (node.model) {
    rawCandidates.push(node.model);
  } else if (configuredProfile?.model) {
    rawCandidates.push(configuredProfile.model);
  } else if (definition.agentModel) {
    rawCandidates.push(definition.agentModel);
  }

  const candidates: ExpandedModelCandidate[] = [];
  for (const raw of rawCandidates) {
    candidates.push(
      ...engine.modelAliases.expandCandidates(run.modelAliasCaptures, raw),
    );
  }

  if (candidates.length === 0) {
    return {
      status: 'blocked',
      reason: 'provider_diversity_exhausted',
      excludedProviders: Array.from(excludedProviders),
      details: 'No candidate models declared or available',
    };
  }

  for (const candidate of candidates) {
    const matchedProfile = candidate.profileId
      ? profiles.find((p) => p.id === candidate.profileId)
      : profiles.find((p) => p.id === candidate.model);
    const candidateProvider = resolveProvider({
      model: matchedProfile ? matchedProfile.model : candidate.model,
      profile: matchedProfile ?? configuredProfile,
      prefixOverrides,
    });

    if (candidateProvider && !excludedProviders.has(candidateProvider)) {
      return {
        status: 'selected',
        candidate: candidate.model,
        ...(candidate.modelAliasSelection
          ? { modelAliasSelection: candidate.modelAliasSelection }
          : {}),
        candidateProfileId:
          candidate.profileId ??
          (profiles.some((p) => p.id === candidate.model)
            ? candidate.model
            : undefined),
        candidateEffort: candidate.effort,
        provider: candidateProvider,
        excludedProviders: Array.from(excludedProviders),
      };
    }
  }

  return {
    status: 'blocked',
    reason: 'provider_diversity_exhausted',
    excludedProviders: Array.from(excludedProviders),
    details: `All candidate models [${candidates.map((c) => c.model).join(', ')}] belong to excluded providers [${Array.from(excludedProviders).join(', ')}]`,
  };
}
