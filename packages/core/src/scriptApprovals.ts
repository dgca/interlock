import { z } from 'zod';

/**
 * Who must approve Script content before it runs. `imports` gates content that
 * arrived in an imported workflow; `imports_and_agents` also gates content an
 * agent added over MCP; `off` runs every Script without approval.
 */
export const scriptApprovalModeSchema = z.enum([
  'imports',
  'imports_and_agents',
  'off',
]);
export type ScriptApprovalMode = z.infer<typeof scriptApprovalModeSchema>;
export const scriptApprovalSettingsSchema = z
  .object({ mode: scriptApprovalModeSchema })
  .strict();
export const scriptApprovalTargetSchema = z
  .object({ runId: z.string().min(1), executionId: z.string().min(1) })
  .strict();

export type ScriptContent = {
  language?: 'javascript' | 'bash';
  command: string;
};
export type DefinitionScript = ScriptContent & {
  nodeId: string;
  label: string;
};
type ScriptSource = {
  nodes: readonly {
    id: string;
    kind: string;
    label: string;
    language?: 'javascript' | 'bash';
    command?: string;
    timing?: {
      kind: string;
      check?: { kind: string } & Partial<ScriptContent>;
    };
  }[];
  workspace?: {
    repository?: string;
    baseRef?: string;
    branch?: string;
    hooks?: { afterCreate?: ScriptContent; beforeRemove?: ScriptContent };
  };
};
const hookLabels = {
  afterCreate: 'Workspace hook after create',
  beforeRemove: 'Workspace hook before remove',
};

/** Every Script a definition can run: Script nodes, polling Wait checks and workspace hooks. */
export function definitionScripts(
  definition: ScriptSource,
): DefinitionScript[] {
  const hooks = Object.entries(definition.workspace?.hooks ?? {}).flatMap(
    ([name, hook]) =>
      typeof hook?.command === 'string'
        ? [
            {
              nodeId: `workspace.${name}`,
              label: hookLabels[name as keyof typeof hookLabels] ?? name,
              ...(hook.language ? { language: hook.language } : {}),
              command: hook.command,
            },
          ]
        : [],
  );
  return definition.nodes
    .flatMap((node) => {
      const content =
        node.kind === 'script'
          ? node
          : node.kind === 'wait' &&
              node.timing?.kind === 'poll' &&
              node.timing.check?.kind === 'script'
            ? node.timing.check
            : undefined;
      return typeof content?.command === 'string'
        ? [
            {
              nodeId: node.id,
              label: node.label,
              ...(content.language ? { language: content.language } : {}),
              command: content.command,
            },
          ]
        : [];
    })
    .concat(hooks);
}

/**
 * Distinct Scripts per workflow in an import, for review before importing,
 * followed by each distinct Git worktree setting, whose repository path comes
 * from the exporting machine.
 */
export function importedScripts(
  workflows: readonly {
    name: string;
    draft?: ScriptSource;
    versions?: readonly { definition: ScriptSource }[];
  }[],
) {
  return workflows.flatMap((workflow) => {
    const seen = new Set<string>();
    return [
      ...(workflow.draft ? [workflow.draft] : []),
      ...(workflow.versions ?? []).map((version) => version.definition),
    ]
      .flatMap(definitionScripts)
      .filter((script) => {
        const key = JSON.stringify([script.language ?? 'bash', script.command]);
        return !seen.has(key) && seen.add(key);
      })
      .map((script) => ({
        workflowName: workflow.name,
        label: script.label,
        language: script.language ?? 'bash',
        command: script.command,
      }));
  });
}
function importedWorkspaces(workflows: Parameters<typeof importedScripts>[0]) {
  return workflows.flatMap((workflow) => {
    const settings = [
      workflow.draft?.workspace,
      ...(workflow.versions ?? []).map((v) => v.definition.workspace),
    ].flatMap((w) =>
      w?.repository
        ? [
            {
              workflowName: workflow.name,
              repository: w.repository,
              baseRef: w.baseRef ?? 'HEAD',
              branch: w.branch ?? 'interlock/{runId}',
            },
          ]
        : [],
    );
    return settings.filter(
      (w, i) =>
        settings.findIndex((o) => JSON.stringify(o) === JSON.stringify(w)) ===
        i,
    );
  });
}
/** What a person reviews before importing: Scripts and Git worktree settings. */
export const importReview = (
  workflows: Parameters<typeof importedScripts>[0],
) => ({
  scripts: importedScripts(workflows),
  workspaces: importedWorkspaces(workflows),
});
