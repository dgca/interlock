import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { prefixedToolName, type InterlockTools } from './interlockTools.js';

const run = promisify(execFile);
/** Probe results per resolved executable and version, for this process. */
const probes = new Map<string, string | undefined>();

/**
 * Whether this Codex accepts host-handled dynamic tools, an experimental
 * app-server API. Reads the protocol schema the executable generates; this
 * starts no thread and no model call. Returns the reason when it cannot.
 * A definite answer is cached per executable and version; a probe that could
 * not run is tried again next time.
 */
export async function codexDynamicTools(
  command: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  let directory: string | undefined;
  try {
    const { stdout } = await run(command, ['--version'], {
      signal,
      timeout: 15_000,
    });
    const key = `${await realpath(command)}\0${stdout.trim()}`;
    if (probes.has(key)) return probes.get(key);
    directory = await mkdtemp(join(tmpdir(), 'interlock-codex-schema-'));
    await run(
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
    const reason =
      start?.properties?.dynamicTools && requests.includes('"item/tool/call"')
        ? undefined
        : 'this Codex version has no dynamic tools';
    probes.set(key, reason);
    return reason;
  } catch (error) {
    if (signal.aborted) throw error;
    return 'could not read the Codex app-server protocol schema';
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

/** Interlock's tools as Codex dynamic tool specs for thread/start. */
export const dynamicToolSpecs = (tools: InterlockTools) =>
  tools.tools.map((tool) => ({
    type: 'function',
    name: prefixedToolName(tool.name),
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

/** The answer to an `item/tool/call` request for one of those specs. */
export async function dynamicToolResult(
  tools: InterlockTools,
  params: { tool?: unknown; arguments?: unknown },
  signal: AbortSignal,
) {
  const tool = tools.tools.find(
    (t) => prefixedToolName(t.name) === params.tool,
  );
  const result = await tools.invoke(
    tool?.name ?? 'unknown',
    params.arguments,
    signal,
  );
  return {
    contentItems: [{ type: 'inputText', text: result.text }],
    success: !result.isError,
  };
}
