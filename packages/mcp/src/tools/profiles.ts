import { z } from 'zod';

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
  'call_work_tool',
  'manage_work_hold',
  'report_usage',
  'inspect_assignment_size',
  'manage_work_resources',
  'get_context_group',
  'handoff_context_group',
  'propose_workflow_change',
  'work_memory',
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
  'propose_workflow_change',
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
  'manage_work_resources',
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

const allTools = new Set([...execute, ...author, ...operate]);
const toolNames = new RegExp(`\\b(?:${[...allTools].join('|')})\\b`, 'g');

/**
 * Drops sentences and `;` clauses that name a tool outside a bounded profile,
 * so discovery text never points agents at tools they cannot call.
 */
export function profileText(profile: McpProfile, text: string) {
  if (profile === 'all') return text;
  const served = (part: string) =>
    [...part.matchAll(toolNames)].every(([name]) => members[profile].has(name));
  return text
    .split(/(?<=\.) +/)
    .map((sentence) => {
      const clauses = sentence.replace(/\.$/, '').split('; ');
      const kept = clauses.filter(served);
      if (kept.length === clauses.length) return sentence;
      if (!kept.length) return '';
      const joined = kept.join('; ');
      // A dropped leading clause can leave a lowercase word; identifiers stay.
      return kept[0] !== clauses[0] && /^[a-z]+ /.test(joined)
        ? `${joined[0].toUpperCase()}${joined.slice(1)}.`
        : `${joined}.`;
    })
    .filter(Boolean)
    .join(' ');
}

const outside = (profile: Exclude<McpProfile, 'all'>, value: unknown) =>
  typeof value === 'string' &&
  allTools.has(value) &&
  !members[profile].has(value);

/**
 * Narrows a tool schema to a bounded profile: descriptions pass through
 * profileText, enums drop out-of-profile tool names, and discriminated unions
 * drop options keyed by them. Unchanged nodes keep their identity, and
 * withProfileNextCall rewrites results so output validation still passes.
 */
export function profileSchema<T extends z.ZodTypeAny>(
  profile: McpProfile,
  schema: T,
): T {
  return profile === 'all' ? schema : (narrow(profile, schema) as T);
}

function narrow(
  profile: Exclude<McpProfile, 'all'>,
  schema: z.ZodTypeAny,
): z.ZodTypeAny {
  const rebuilt = rebuild(profile, schema);
  const { description } = rebuilt;
  if (description === undefined) return rebuilt;
  const text = profileText(profile, description);
  return text === description ? rebuilt : rebuilt.describe(text);
}

function rebuild(
  profile: Exclude<McpProfile, 'all'>,
  schema: z.ZodTypeAny,
): z.ZodTypeAny {
  // Recreates a node from its definition when any child changed.
  const remake = (patch: Record<string, unknown>) => {
    const Type = schema.constructor as new (def: unknown) => z.ZodTypeAny;
    return new Type({ ...(schema._def as object), ...patch });
  };
  const child = (key: string) => {
    const inner = (schema._def as Record<string, z.ZodTypeAny>)[key];
    const next = narrow(profile, inner);
    return next === inner ? schema : remake({ [key]: next });
  };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as z.ZodRawShape;
    const next = profileShape(profile, shape);
    return next === shape ? schema : remake({ shape: () => next });
  }
  if (schema instanceof z.ZodEnum) {
    const all = schema.options as string[];
    const values = all.filter((value) => !outside(profile, value));
    return values.length === all.length ? schema : remake({ values });
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const def = schema._def as {
      discriminator: string;
      options: z.ZodObject<Record<string, z.ZodTypeAny>>[];
    };
    let changed = false;
    const options = def.options.flatMap((option) => {
      const key = option.shape[def.discriminator];
      if (key instanceof z.ZodLiteral && outside(profile, key.value)) {
        changed = true;
        return [];
      }
      const next = narrow(profile, option) as typeof option;
      if (next !== option) changed = true;
      return [next];
    });
    if (!changed) return schema;
    return remake({
      options,
      optionsMap: new Map(
        options.map((option) => [
          (option.shape[def.discriminator] as z.ZodLiteral<unknown>).value,
          option,
        ]),
      ),
    });
  }
  if (schema instanceof z.ZodUnion) {
    const original = schema.options as z.ZodTypeAny[];
    const options = original.map((option) => narrow(profile, option));
    return options.every((option, i) => option === original[i])
      ? schema
      : remake({ options });
  }
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodReadonly
  )
    return child('innerType');
  if (schema instanceof z.ZodArray || schema instanceof z.ZodBranded)
    return child('type');
  if (schema instanceof z.ZodEffects) return child('schema');
  if (schema instanceof z.ZodRecord) return child('valueType');
  if (schema instanceof z.ZodIntersection) {
    const { left, right } = schema._def as {
      left: z.ZodTypeAny;
      right: z.ZodTypeAny;
    };
    const [l, r] = [narrow(profile, left), narrow(profile, right)];
    return l === left && r === right ? schema : remake({ left: l, right: r });
  }
  return schema;
}

/** Narrows each property of a raw input shape; see profileSchema. */
export function profileShape(profile: McpProfile, shape: z.ZodRawShape) {
  if (profile === 'all') return shape;
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(shape).map(([key, value]) => {
      const narrowed = narrow(profile, value);
      if (narrowed !== value) changed = true;
      return [key, narrowed];
    }),
  );
  return changed ? next : shape;
}

/**
 * Compact mutations can suggest a follow-up tool outside the connected
 * profile; suggest the run briefing instead, which reports the same blockers.
 * Claimable work becomes wait_for_worker where the profile cannot claim, as
 * another worker must claim it. profileSchema advertises the same values.
 */
export function withProfileNextCall(profile: McpProfile, result: unknown) {
  if (profile === 'all' || !result || typeof result !== 'object') return result;
  const { next, nextCall, runId, cursor } = result as {
    next?: unknown;
    nextCall?: { tool?: string } | null;
    runId?: unknown;
    cursor?: unknown;
  };
  if (
    next === 'claim_work' &&
    !inMcpProfile(profile, 'claim_work') &&
    typeof runId === 'string' &&
    typeof cursor === 'string' &&
    inMcpProfile(profile, 'wait_for_run_change')
  )
    return {
      ...result,
      next: 'wait_for_worker',
      ...('nextCall' in result
        ? {
            nextCall: {
              tool: 'wait_for_run_change',
              arguments: { id: runId, cursor },
            },
          }
        : {}),
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
