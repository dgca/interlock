import { z } from 'zod';
import type {
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from './index.js';
import { sameExecutionScope } from './parallel.js';

/** Defaults applied when a tool edge omits its call limits. */
const DEFAULT_TOOL_CALLS_PER_ATTEMPT = 10;
const DEFAULT_TOOL_CALLS_PER_EXECUTION = 30;
const DEFAULT_LEASE_SECONDS = 300;

/** Optional edge fields. Edges without kind are ordinary routes. */
export const toolEdgeFields = {
  kind: z
    .literal('tool')
    .optional()
    .describe(
      'tool offers a Script or Fetch target to the source Agent as a callable tool. Never followed as a route.',
    ),
  maxCallsPerAttempt: z.number().int().min(1).max(100).optional(),
  maxCallsPerExecution: z.number().int().min(1).max(1000).optional(),
};

export interface AssignmentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  edgeId: string;
  nodeId: string;
  kind: 'script' | 'fetch';
  maxCallsPerAttempt: number;
  maxCallsPerExecution: number;
}
/** The listing a worker receives with its assignment. */
export type WorkTool = Pick<
  AssignmentTool,
  | 'name'
  | 'description'
  | 'inputSchema'
  | 'maxCallsPerAttempt'
  | 'maxCallsPerExecution'
>;
/** Bounds the tool listing in each assignment. */
const MAX_TOOLS_PER_AGENT = 20;
const MAX_TOOL_SCHEMA_BYTES = 8_192;
const MAX_TOOL_LIST_BYTES = 32_768;
const jsonBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
export interface ToolEdgeProblem {
  code: string;
  message: string;
  edgeId?: string;
  nodeId?: string;
}

const isToolEdge = (edge: Pick<WorkflowEdge, 'kind'>) => edge.kind === 'tool';

/** Nodes offered as tools. They run only through tool calls, never as routes. */
export function toolTargetIds(definition: Pick<WorkflowDefinition, 'edges'>) {
  return new Set(definition.edges.filter(isToolEdge).map((e) => e.target));
}

/** Tool name derived from the target label, for example "Run checks" -> run_checks. */
function toolName(node: Pick<WorkflowNode, 'label'>) {
  return node.label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}
const validToolName = (name: string) => /^[a-z][a-z0-9_]{0,63}$/.test(name);

/** Tools offered to one Agent node, in edge order. */
export function agentTools(
  definition: Pick<WorkflowDefinition, 'nodes' | 'edges'>,
  agentId: string,
): AssignmentTool[] {
  return definition.edges.flatMap((edge) => {
    if (!isToolEdge(edge) || edge.source !== agentId) return [];
    const target = definition.nodes.find((n) => n.id === edge.target);
    if (target?.kind !== 'script' && target?.kind !== 'fetch') return [];
    return [
      {
        name: toolName(target),
        description: `${target.kind === 'script' ? 'Script' : 'Fetch'} step "${target.label}". Returns its output.`,
        inputSchema: target.inputSchema,
        edgeId: edge.id,
        nodeId: target.id,
        kind: target.kind,
        maxCallsPerAttempt:
          edge.maxCallsPerAttempt ?? DEFAULT_TOOL_CALLS_PER_ATTEMPT,
        maxCallsPerExecution:
          edge.maxCallsPerExecution ?? DEFAULT_TOOL_CALLS_PER_EXECUTION,
      },
    ];
  });
}

const literalResources = (node: WorkflowNode) =>
  'resources' in node
    ? (node.resources ?? []).flatMap((b) =>
        b.source === 'literal' && typeof b.value === 'string' ? [b.value] : [],
      )
    : [];

/** Assignment fields for an Agent's tools, captured when its work is created. */
export function workTools(
  definition: Pick<WorkflowDefinition, 'nodes' | 'edges'>,
  agentId: string,
): { tools?: WorkTool[] } {
  const tools = agentTools(definition, agentId).map(
    ({ name, description, inputSchema, ...limits }) => ({
      name,
      description,
      inputSchema,
      maxCallsPerAttempt: limits.maxCallsPerAttempt,
      maxCallsPerExecution: limits.maxCallsPerExecution,
    }),
  );
  return tools.length ? { tools } : {};
}

/** Every tool edge problem, for publication checks and draft diagnostics. */
export function toolEdgeProblems(
  definition: Pick<WorkflowDefinition, 'nodes' | 'edges'>,
): ToolEdgeProblem[] {
  const problems: ToolEdgeProblem[] = [];
  const nodes = new Map(definition.nodes.map((n) => [n.id, n]));
  const targets = toolTargetIds(definition);
  const names = new Map<string, Set<string>>();
  for (const edge of definition.edges) {
    const source = nodes.get(edge.source),
      target = nodes.get(edge.target);
    const add = (code: string, message: string, nodeId?: string) =>
      problems.push({ code, message, edgeId: edge.id, nodeId });
    if (!isToolEdge(edge)) {
      if (
        edge.maxCallsPerAttempt !== undefined ||
        edge.maxCallsPerExecution !== undefined
      )
        add('tool_limits_on_route', 'Call limits apply only to tool edges.');
      if (target && targets.has(target.id))
        add(
          'tool_target_routed',
          `${target.label}: a tool step cannot also be connected by routes.`,
          target.id,
        );
      if (source && targets.has(source.id))
        add(
          'tool_target_routed',
          `${source.label}: a tool step cannot also be connected by routes.`,
          source.id,
        );
      continue;
    }
    if (!source || !target) continue; // Ordinary validation reports missing endpoints.
    if (source.kind !== 'agent') {
      add('tool_source', 'Tool edges start at an Agent node.', source.id);
      continue;
    }
    if (target.kind !== 'script' && target.kind !== 'fetch') {
      add(
        'tool_target',
        'Tool edges target a Script or Fetch node.',
        target.id,
      );
      continue;
    }
    if (edge.port !== 'default' || edge.targetHandle)
      add('tool_port', 'Tool edges have no route port or target handle.');
    if (
      edge.maxCallsPerAttempt !== undefined &&
      edge.maxCallsPerExecution !== undefined &&
      edge.maxCallsPerAttempt > edge.maxCallsPerExecution
    )
      add(
        'tool_limits',
        'maxCallsPerAttempt cannot exceed maxCallsPerExecution.',
      );
    if (!sameExecutionScope(source, target))
      add(
        'tool_scope',
        `${target.label}: a tool step must be in its Agent's Batch or Parallel scope.`,
        target.id,
      );
    if (target.routing || target.onFailure === 'route')
      add(
        'tool_target_routing',
        `${target.label}: tool steps cannot use result routing or a Failed route.`,
        target.id,
      );
    if (target.kind === 'script' && target.executionMode === 'background')
      add(
        'tool_background',
        `${target.label}: background Scripts cannot be tools; a tool call blocks the Agent's turn.`,
        target.id,
      );
    const lease = source.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
    if (target.timeoutMs > lease * 1000)
      add(
        'tool_timeout',
        `${target.label}: timeout ${target.timeoutMs / 1000}s exceeds the ${source.label} claim lease of ${lease}s.`,
        target.id,
      );
    const shared = literalResources(target).filter((name) =>
      literalResources(source).includes(name),
    );
    if (shared.length)
      add(
        'tool_resources',
        `${target.label}: shares resource ${shared[0]} with ${source.label}, which holds it during the call.`,
        target.id,
      );
    if (jsonBytes(target.inputSchema) > MAX_TOOL_SCHEMA_BYTES)
      add(
        'tool_schema_size',
        `${target.label}: the input contract of a tool must be at most ${MAX_TOOL_SCHEMA_BYTES} bytes of JSON.`,
        target.id,
      );
    const name = toolName(target);
    if (!validToolName(name))
      add(
        'tool_name',
        `${target.label}: rename the step so its tool name starts with a letter.`,
        target.id,
      );
    const used = names.get(source.id) ?? new Set<string>();
    if (used.has(name))
      add(
        'tool_name_duplicate',
        `${source.label}: tool name ${name} is used twice. Rename one step.`,
        source.id,
      );
    used.add(name);
    names.set(source.id, used);
    if (used.size === MAX_TOOLS_PER_AGENT + 1)
      add(
        'tool_count',
        `${source.label}: at most ${MAX_TOOLS_PER_AGENT} tools per Agent.`,
        source.id,
      );
  }
  for (const agent of definition.nodes)
    if (
      agent.kind === 'agent' &&
      jsonBytes(workTools(definition, agent.id).tools ?? []) >
        MAX_TOOL_LIST_BYTES
    )
      problems.push({
        code: 'tool_list_size',
        message: `${agent.label}: its tool list must be at most ${MAX_TOOL_LIST_BYTES} bytes of JSON. Remove tools or shrink their input contracts.`,
        nodeId: agent.id,
      });
  return problems;
}

/** Links a tool run to the Agent execution and claim attempt that called it. */
export interface ToolCallLink {
  workId: string;
  executionId: string;
  attempt: number;
  edgeId: string;
  name: string;
  callId: string;
}

export const toolCallRequestSchema = z.object({
  workId: z.string().optional(),
  token: z.string().optional(),
  name: z.string(),
  arguments: z.record(z.unknown()).default({}),
  callId: z.string().optional(),
  waitMs: z.number().int().min(0).max(600_000).default(50_000),
});
export type ToolCallRequest = z.infer<typeof toolCallRequestSchema>;
export type ToolCallInput = z.input<typeof toolCallRequestSchema>;
