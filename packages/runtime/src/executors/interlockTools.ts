import type {
  ManagedExecution,
  Run,
  ToolCallInput,
  WorkMemoryRequest,
  WorkRequest,
} from '@interlock/core';
import { z } from 'zod';

/** Interlock's own tool names, the same in every built-in harness. */
export const saveNoteTool = 'save_memory_note';
export const callToolTool = 'call_workflow_tool';

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
    'Run a workflow tool attached to this step and return its output. If status is running or waiting, call again with the returned callId.',
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
        return {
          text: error instanceof Error ? error.message : String(error),
          isError: true,
        };
      }
    },
  };
}
