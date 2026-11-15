import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { InterlockTools } from './interlockTools.js';

/**
 * Whether this Codex accepts host-handled dynamic tools, an experimental
 * app-server API. Reads the protocol schema the executable generates; this
 * starts no thread and no model call. Returns the reason when it cannot.
 */
export async function codexDynamicTools(
  command: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const directory = await mkdtemp(join(tmpdir(), 'interlock-codex-schema-'));
  try {
    await promisify(execFile)(
      command,
      [
        'app-server',
        'generate-json-schema',
        '--experimental',
        '--out',
        directory,
      ],
      { signal, timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const start = JSON.parse(
      await readFile(join(directory, 'v2', 'ThreadStartParams.json'), 'utf8'),
    ) as { properties?: { dynamicTools?: unknown } } | null;
    const requests = await readFile(
      join(directory, 'ServerRequest.json'),
      'utf8',
    );
    return start?.properties?.dynamicTools &&
      requests.includes('"item/tool/call"')
      ? undefined
      : 'this Codex version has no dynamic tools';
  } catch (error) {
    if (signal.aborted) throw error;
    return 'could not read the Codex app-server protocol schema';
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Interlock's tools as Codex dynamic tool specs for thread/start. */
export const dynamicToolSpecs = (tools: InterlockTools) =>
  tools.tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

/** The answer to an `item/tool/call` request. */
export async function dynamicToolResult(
  tools: InterlockTools,
  params: { tool?: unknown; arguments?: unknown },
  signal: AbortSignal,
) {
  const result = await tools.invoke(
    typeof params.tool === 'string' ? params.tool : '',
    params.arguments,
    signal,
  );
  return {
    contentItems: [{ type: 'inputText', text: result.text }],
    success: !result.isError,
  };
}
