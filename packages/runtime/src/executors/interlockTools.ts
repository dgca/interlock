import type {
  ManagedExecution,
  Run,
  ToolCallInput,
  WorkMemoryRequest,
  WorkRequest,
} from '@interlock/core';
import { z } from 'zod';

/**
 * Interlock's own tool names. Harnesses expose them under their own names:
 * Claude Code as `mcp__interlock_assignment__<name>`, Codex and Pi through
 * `prefixedToolName`, so another extension's tool cannot be mistaken for one.
 */
export const saveNoteTool = 'save_memory_note';
export const callToolTool = 'call_workflow_tool';
/** The name Codex and Pi sessions see. */
export const prefixedToolName = (name: string) => `interlock_${name}`;

const shapes = {
  [saveNoteTool]: {
    content: z
      .string()
      .describe('One lasting fact for later runs of this workflow.'),
    scope: z
      .enum(['node', 'workflow'])
      .optional()
      .describe(
        'node (default): only this step sees it; workflow: every step.',
      ),
  },
  [callToolTool]: {
    name: z.string().describe('Tool name from the assignment tools.'),
    arguments: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Arguments matching the tool's inputSchema."),
    callId: z
      .string()
      .optional()
      .describe('The callId of an earlier call that is still running.'),
  },
};
const descriptions = {
  [saveNoteTool]:
    "Save one lasting fact to this workflow's memory for later runs. Usually a person reviews it first. Write only: it cannot read notes.",
  [callToolTool]:
    'Run a Script or Fetch step that the workflow attached to this step as a tool, in your working directory, and return its output. If status is running or waiting, call again with the returned callId.',
};

type ToolName = keyof typeof shapes;
export interface InterlockToolDefinition<N extends ToolName = ToolName> {
  name: N;
  description: string;
  /** Zod shape, for the Claude Agent SDK. */
  shape: (typeof shapes)[N];
  /** JSON Schema, for Codex and Pi. */
  inputSchema: Record<string, unknown>;
}
interface InterlockToolResult {
  text: string;
  isError?: boolean;
}

/**
 * Interlock's tools for one managed session, bound to its claim attempt. The
 * adapter hands calls to `invoke`; the session never sees a credential.
 */
export interface InterlockTools {
  tools: InterlockToolDefinition[];
  invoke(
    name: string,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<InterlockToolResult>;
}
export type InterlockToolsState = NonNullable<
  ManagedExecution['interlockTools']
>;

interface Host {
  run(id: string): Run;
  memory: { work(input: WorkMemoryRequest): unknown };
  callTool(input: ToolCallInput, signal?: AbortSignal): Promise<unknown>;
}

function definition<N extends ToolName>(name: N): InterlockToolDefinition<N> {
  const inputSchema: Record<string, unknown> = z.toJSONSchema(
    z.object(shapes[name]).strict(),
    { target: 'draft-7' },
  );
  // Harnesses validate with their own JSON Schema dialect; omit the marker.
  delete inputSchema.$schema;
  return {
    name,
    description: descriptions[name],
    shape: shapes[name],
    inputSchema,
  };
}

/**
 * The tools a managed session gets: saving a memory note when the run
 * captured memory, and calling workflow tools when the step has any. Read only
 * sessions get none. Each call acts on the claim attempt held by the host.
 */
export function interlockTools(
  host: Host,
  work: WorkRequest,
  permissions: string | undefined,
  /** A failed call, for the execution log: tool name and error class only. */
  onFailure?: (tool: string, errorClass: string) => void,
): InterlockTools | undefined {
  if (permissions === 'read-only' || !work.token) return undefined;
  const token = work.token;
  const tools: InterlockToolDefinition[] = [
    ...(host.run(work.runId).memoryCapture ? [definition(saveNoteTool)] : []),
    ...(work.tools?.length ? [definition(callToolTool)] : []),
  ];
  if (!tools.length) return undefined;
  return {
    tools,
    async invoke(name, args, signal) {
      try {
        if (!tools.some((tool) => tool.name === name))
          throw new Error(`Unknown Interlock tool ${name}`);
        let result: unknown;
        if (name === saveNoteTool) {
          const q = z.object(shapes[saveNoteTool]).strict().parse(args);
          result = host.memory.work({
            action: 'write',
            workId: work.id,
            token,
            content: q.content,
            ...(q.scope ? { scope: q.scope } : {}),
          });
        } else {
          const q = z.object(shapes[callToolTool]).strict().parse(args);
          result = await host.callTool(
            {
              workId: work.id,
              token,
              name: q.name,
              arguments: q.arguments ?? {},
              ...(q.callId ? { callId: q.callId } : {}),
            },
            signal,
          );
        }
        return { text: JSON.stringify(result) };
      } catch (error) {
        onFailure?.(
          tools.some((tool) => tool.name === name) ? name : 'unknown tool',
          error instanceof Error ? error.constructor.name : typeof error,
        );
        return {
          text: error instanceof Error ? error.message : String(error),
          isError: true,
        };
      }
    },
  };
}

/**
 * The run fields that hand a managed attempt its tools and record their
 * state on the execution. A later turn of the same attempt keeps the tools it
 * was given. Failed calls are logged by tool name and error class only.
 */
export function managedToolRun(
  host: Host,
  work: WorkRequest,
  record: ManagedExecution,
  log: (message: string) => void,
  active: () => boolean,
) {
  return {
    interlockTools: interlockTools(
      host,
      work,
      record.profile.permissions,
      (tool, errorClass) =>
        log(`Interlock tool ${tool} failed (${errorClass})`),
    ),
    onInterlockTools: (state: InterlockToolsState) => {
      if (!active()) return;
      if (record.interlockTools?.state !== 'attached')
        record.interlockTools = state;
      log(
        `Interlock tools ${state.state}: ${state.reason ?? state.tools.join(', ')}`,
      );
    },
  };
}
