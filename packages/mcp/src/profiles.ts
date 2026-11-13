// Tool profiles bound the MCP discovery an agent pays for. `all` keeps the
// complete tool set so existing client configurations see the same tools.
const mcpProfiles = ['all', 'execute', 'author', 'operate'] as const;
export type McpProfile = (typeof mcpProfiles)[number];

const inspect = [
  'get_run',
  'get_run_briefing',
  'get_run_result',
  'wait_for_run_change',
];

const execute = [
  ...inspect,
  'list_work',
  'claim_work',
  'renew_claim',
  'preflight_result',
  'submit_result',
  'fail_work',
  'report_usage',
  'inspect_assignment_size',
  'manage_work_resources',
  'get_context_group',
  'handoff_context_group',
];

const author = [
  'doctor',
  'workflow_report',
  'list_workflows',
  'get_workflow',
  'export_workflow',
  'import_workflows',
  'create_workflow',
  'update_workflow',
  'edit_workflow',
  'validate_workflow',
  'publish_workflow',
  'list_workflow_versions',
  'preview_workflow_ownership',
  'set_workflow_owner',
  'preview_version_deletion',
  'delete_workflow_versions',
  'delete_workflow',
  'list_prompts',
  'get_prompt',
  'create_prompt',
  'update_prompt',
  'delete_prompt',
  'read_variables',
  'manage_variables',
  'manage_model_aliases',
  'read_workflow_triggers',
  'manage_workflow_triggers',
  'read_workflow_boards',
  'manage_workflow_boards',
  'workflow_simulation',
  'read_test_suites',
  'save_test_suite',
  'preview_workflow_comparison',
  'start_workflow_comparison',
  'read_workflow_comparisons',
  'update_workflow_comparison',
];

const operate = [
  ...inspect,
  'doctor',
  'workflow_report',
  'list_workflows',
  'read_workflow_boards',
  'read_workflow_triggers',
  'start_run',
  'list_runs',
  'retry_run',
  'manage_run_version',
  'manage_run_history',
  'list_work',
  'workflow_requests',
  'external_input',
  'preview_run_cancellation',
  'cancel_run',
  'cancel_run_tree',
  'manage_pause',
  'manage_work_hold',
  'manage_stalls',
  'manage_executors',
  'manage_script',
  'get_run_budget',
  'set_run_budget',
  'get_run_usage',
];

const members: Record<Exclude<McpProfile, 'all'>, ReadonlySet<string>> = {
  execute: new Set(execute),
  author: new Set(author),
  operate: new Set(operate),
};

export function parseMcpProfile(value: string | undefined): McpProfile {
  if (value === undefined || value === '') return 'all';
  if ((mcpProfiles as readonly string[]).includes(value))
    return value as McpProfile;
  throw new Error(
    `Unknown MCP profile "${value}". Use one of: ${mcpProfiles.join(', ')}.`,
  );
}

/** Whether a tool is served by a profile. Every tool must belong to one. */
export function inMcpProfile(profile: McpProfile, name: string) {
  const owners = Object.values(members).filter((set) => set.has(name));
  if (owners.length === 0)
    throw new Error(`Tool ${name} is not assigned to an MCP profile`);
  return profile === 'all' || members[profile].has(name);
}

/**
 * Compact mutations can suggest a follow-up tool outside the connected
 * profile; suggest the run briefing instead, which reports the same blockers.
 */
export function withProfileNextCall(profile: McpProfile, result: unknown) {
  if (profile === 'all' || !result || typeof result !== 'object') return result;
  const { nextCall, runId } = result as {
    nextCall?: { tool?: string } | null;
    runId?: unknown;
  };
  if (
    !nextCall?.tool ||
    inMcpProfile(profile, nextCall.tool) ||
    typeof runId !== 'string' ||
    !inMcpProfile(profile, 'get_run_briefing')
  )
    return result;
  return {
    ...result,
    nextCall: { tool: 'get_run_briefing', arguments: { id: runId } },
  };
}
