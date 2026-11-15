import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  jsonSchema,
  type ModelUsage,
  type ExecutorProfile,
} from '@interlock/core';
import {
  assignmentPrompt,
  resultEnvelope,
  HarnessResultError,
  HarnessModelError,
  HarnessRequestError,
  isModelRefusal,
  type HarnessAdapter,
  type HarnessRun,
} from './contracts.js';
import {
  detectExecutable,
  findExecutable,
  JsonLinesProcess,
} from './process.js';
import { piAction } from './permissionPolicy.js';
import {
  prefixedToolName,
  type InterlockToolDefinition,
  type InterlockTools,
} from './interlockTools.js';

/**
 * Loaded explicitly by Pi; no package imports or checkout-relative assets.
 * With `tools`, it also registers Interlock's tools under prefixed names.
 * Each call travels to the host as an editor dialog titled with the private
 * `tools.channel`, so it needs no network and the session receives no
 * credential. `tools.file` is this extension's unique file name: a call skips
 * approval only when Pi reports the tool as registered from that file, so a
 * tool another extension registers under the same name still asks.
 */
export function piPermissions(
  mode: ExecutorProfile['permissions'],
  command: string,
  tools?: { channel: string; file: string; tools: InterlockToolDefinition[] },
) {
  return `export default function (pi) {
    pi.registerCommand(${JSON.stringify(command)}, { description: 'Interlock permission bridge', handler: async () => {} });
    const own = ${JSON.stringify(
      tools?.tools.map(({ name, description, inputSchema }) => ({
        name: prefixedToolName(name),
        canonical: name,
        description,
        inputSchema,
      })) ?? [],
    )};
    const registeredHere = (name) => {
      try {
        const tool = pi.getAllTools().find((t) => t.name === name);
        return String(tool?.sourceInfo?.path ?? '').endsWith(${JSON.stringify(`/${tools?.file ?? ''}`)});
      } catch { return false; }
    };
    for (const tool of own) {
      pi.registerTool({
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
        async execute(id, params, signal, onUpdate, ctx) {
          const answer = await ctx.ui.editor(${JSON.stringify(tools?.channel ?? '')} + ':' + tool.canonical, JSON.stringify(params ?? {}));
          if (answer === undefined) throw new Error('Interlock did not answer this tool call');
          const result = JSON.parse(answer);
          if (result.isError) throw new Error(result.text);
          return { content: [{ type: 'text', text: result.text }], details: undefined };
        },
      });
    }
    pi.on('tool_call', async (event, ctx) => {
      if (['read', 'grep', 'find', 'ls'].includes(event.toolName)) return;
      // Interlock's own tools never ask: the workflow's author granted the
      // tool steps they run. Only the tools this extension registered count.
      if (own.some((t) => t.name === event.toolName) && registeredHere(event.toolName)) return;
      const mode = ${JSON.stringify(mode)};
      if (mode === 'read-only') return { block: true, reason: 'This Interlock profile is read-only' };
      if (mode === 'full-access') return;
      const detail = JSON.stringify(event.input, null, 2);
      if (!detail || detail.length > 12000 || !ctx.hasUI) return { block: true, reason: 'Approval details unavailable or too large' };
      let allowed = false;
      try { allowed = await ctx.ui.confirm(${JSON.stringify(command + ':')} + event.toolName, detail); }
      catch { return { block: true, reason: 'Interlock approval failed' }; }
      if (!allowed) return { block: true, reason: 'User denied this action in Interlock' };
    });
  }`;
}

const modelId = (model: any) => `${model.provider}/${model.id}`;

export const piAdapter: HarnessAdapter = {
  id: 'pi',
  available: (override) => !!findExecutable('pi', override),
  detect: (override) => detectExecutable('pi', override),
  async models(input) {
    const rpc = new JsonLinesProcess(
      input.command,
      [
        '--mode',
        'rpc',
        '--no-session',
        '--no-extensions',
        '--no-mcp',
        '--no-skills',
        '--no-context-files',
        '--offline',
      ],
      input.cwd,
      'pi',
    );
    const abort = () => {
      void rpc.close().catch(() => {});
    };
    input.signal.addEventListener('abort', abort, { once: true });
    try {
      if (input.signal.aborted) throw input.signal.reason;
      const catalog = await rpc.request('get_available_models', {});
      if (!Array.isArray(catalog?.models))
        throw new Error('Pi returned an invalid model catalog');
      const models = [];
      for (const model of catalog.models.slice(0, 100)) {
        if (typeof model.id !== 'string' || typeof model.provider !== 'string')
          throw new Error('Pi returned an invalid model');
        let effortLevels: string[] | undefined;
        try {
          // RPC model selection is session-local and starts no model turn.
          await rpc.request('set_model', {
            provider: model.provider,
            modelId: model.id,
          });
          const result = await rpc.request('get_available_thinking_levels', {});
          if (
            Array.isArray(result?.levels) &&
            result.levels.every((v: unknown) => typeof v === 'string')
          )
            effortLevels = result.levels;
        } catch {
          if (input.signal.aborted) throw input.signal.reason;
          // An inaccessible model can still be shown, without claiming verified effort support.
        }
        models.push({
          id: modelId(model),
          name: `${model.name ?? model.id} (${model.provider})`,
          ...(effortLevels ? { effortLevels } : {}),
        });
      }
      return { models, truncated: catalog.models.length > 100 };
    } finally {
      input.signal.removeEventListener('abort', abort);
      await rpc.close();
    }
  },
  recordsPrompt: true,
  async run(input: HarnessRun) {
    const directory = await mkdtemp(join(tmpdir(), 'interlock-pi-'));
    const tools = input.interlockTools;
    // Only the generated extension knows this; it is never a credential.
    const channel = `interlock-tools-${randomUUID()}`;
    let rpc: JsonLinesProcess | undefined;
    let taskStarted = false;
    const abort = () => {
      void rpc?.close().catch(() => {});
    };
    input.signal.addEventListener('abort', abort, { once: true });
    try {
      if (input.signal.aborted) throw input.signal.reason;
      const file = `interlock-${randomUUID()}.mjs`;
      const extension = join(directory, file);
      const bridge = `interlock-${randomUUID()}`;
      await writeFile(
        extension,
        piPermissions(
          input.profile.permissions,
          bridge,
          tools ? { channel, file, tools: tools.tools } : undefined,
        ),
        { mode: 0o600 },
      );
      if (input.signal.aborted) throw input.signal.reason;
      const sessionId = input.sessionId ?? randomUUID();
      rpc = new JsonLinesProcess(
        input.command,
        [
          '--mode',
          'rpc',
          '--offline',
          '--extension',
          extension,
          ...(input.sessionId
            ? ['--session', sessionId]
            : ['--session-id', sessionId]),
          ...(!input.sessionId && input.sessionName
            ? ['--session-name', input.sessionName]
            : []),
        ],
        input.cwd,
        'pi',
      );
      let finish!: (event: any) => void;
      const completed = new Promise<any>((resolve) => {
        finish = resolve;
      });
      let finalMessage: any;
      const usage = new Map<string, ModelUsage>();
      const fail = (error: Error) => {
        finish({ error });
        void rpc!.close().catch(() => {});
      };
      rpc.onMessage = (event) => {
        if (
          event.type === 'message_end' &&
          event.message?.role === 'assistant'
        ) {
          const text = event.message.content
            ?.filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n');
          if (text)
            input.onTranscript?.({
              kind: 'assistant',
              text,
              key: event.message.id
                ? `assistant:${event.message.id}`
                : undefined,
            });
        }
        if (event.type === 'tool_execution_start')
          input.onTranscript?.({
            kind: 'tool_call',
            tool: event.toolName,
            callId: event.toolCallId,
            key: `call:${event.toolCallId}`,
            text: transcriptText(event.args),
          });
        if (event.type === 'tool_execution_end')
          input.onTranscript?.({
            kind: 'tool_result',
            tool: event.toolName,
            callId: event.toolCallId,
            key: `result:${event.toolCallId}`,
            text: transcriptText(event.result?.content ?? event.result),
          });
        if (event.type === 'agent_settled') finish(event);
        if (event.type === 'extension_error')
          fail(new Error('Pi extension failed during execution'));
        if (
          event.type === 'message_end' &&
          event.message?.role === 'assistant'
        ) {
          finalMessage = event.message;
          addUsage(usage, event.message);
          input.onUsage?.([...usage.values()], 'attempt');
          if (
            event.message.stopReason !== 'error' &&
            event.message.stopReason !== 'aborted'
          )
            taskStarted = true;
        }
        if (
          event.type === 'tool_execution_start' ||
          event.type === 'tool_execution_end'
        )
          taskStarted = true;
        if (event.type === 'tool_execution_start')
          input.onProgress(`Using ${String(event.toolName).slice(0, 160)}`);
        if (event.type === 'extension_ui_request') {
          void answerUi(input, rpc!, event, bridge, {
            channel,
            tools,
          }).catch((error) => fail(error));
        }
      };
      const commands = await rpc.request('get_commands', {});
      if (
        !commands?.commands?.some(
          (c: any) => c.name === bridge && c.source === 'extension',
        )
      )
        throw new Error('Pi did not load the Interlock permission bridge');
      if (input.profile.model) {
        const catalog = await rpc.request('get_available_models', {});
        const matches = catalog?.models?.filter(
          (m: any) =>
            modelId(m) === input.profile.model || m.id === input.profile.model,
        );
        if (matches?.length !== 1)
          throw new HarnessModelError(
            'Pi model is unavailable or ambiguous; use an exact provider/model ID',
          );
        await rpc.request('set_model', {
          provider: matches[0].provider,
          modelId: matches[0].id,
        });
      }
      if (input.profile.effort) {
        const supported = await rpc.request(
          'get_available_thinking_levels',
          {},
        );
        if (!supported?.levels?.includes(input.profile.effort))
          throw new Error('Pi does not support the requested thinking effort');
        await rpc.request('set_thinking_level', {
          level: input.profile.effort,
        });
      }
      const state = await rpc.request('get_state', {});
      if (state?.sessionId !== sessionId)
        throw new Error('Pi did not open the required native session');
      if (input.profile.effort && state.thinkingLevel !== input.profile.effort)
        throw new Error('Pi did not apply the requested thinking effort');
      if (!state.model) throw new Error('Pi has no active model');
      if (
        input.profile.model &&
        state.model.id !== input.profile.model &&
        modelId(state.model) !== input.profile.model
      )
        throw new Error('Pi did not select the requested model');
      input.onSession(sessionId, modelId(state.model));
      const message = [
        assignmentPrompt(
          input.work,
          undefined,
          Object.fromEntries(
            (tools?.tools ?? []).map((t) => [t.name, prefixedToolName(t.name)]),
          ),
        ),
        `Return only JSON, without Markdown fences. Result envelope schema:\n${JSON.stringify(resultEnvelope(input.work))}`,
      ].join('\n\n');
      input.onTranscript?.({ kind: 'user', text: message });
      if (tools)
        input.onInterlockTools?.({
          state: 'attached',
          tools: tools.tools.map((t) => t.name),
        });
      const prompt = await rpc.request('prompt', { message });
      if (prompt?.disposition !== 'started')
        throw new HarnessResultError('Pi did not start the assignment prompt');
      input.onMessageChannel?.(async (message) => {
        if (input.signal.aborted) throw new Error('Pi execution ended');
        await rpc!.request('steer', { message }, 10000);
      });
      const ended = await Promise.race([completed, rpc.ended()]);
      // A final answer given before a stop keeps its result; the host decides.
      if (
        input.signal.aborted &&
        (finalMessage as { stopReason?: string } | undefined)?.stopReason !==
          'stop'
      )
        throw input.signal.reason ?? new Error('Execution stopped');
      if (ended.error) throw ended.error;
      if (ended.aborted || finalMessage?.stopReason !== 'stop')
        throw new HarnessResultError(
          `Pi ended without a successful assignment result (${finalMessage?.stopReason ?? 'no response'})${finalMessage?.errorMessage ? ': ' + String(finalMessage.errorMessage).slice(0, 2000) : ''}`,
        );
      const text = finalMessage.content
        ?.filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      let envelope;
      try {
        envelope = JSON.parse(text);
      } catch {
        throw new HarnessResultError('Pi returned invalid result JSON');
      }
      if (
        !envelope ||
        typeof envelope !== 'object' ||
        Array.isArray(envelope) ||
        !Object.hasOwn(envelope, 'result')
      )
        throw new HarnessResultError('Pi returned an invalid result envelope');
      return {
        output: jsonSchema.parse(envelope.result),
        usage: [...usage.values()],
        usageScope: 'attempt',
        resumeCommand: `pi --session ${sessionId}`,
      };
    } catch (error) {
      if (
        !taskStarted &&
        (error instanceof HarnessRequestError ||
          error instanceof HarnessResultError) &&
        isModelRefusal(error)
      )
        throw new HarnessModelError(
          error instanceof Error ? error.message : String(error),
        );
      throw error;
    } finally {
      input.onMessageChannel?.(undefined);
      input.signal.removeEventListener('abort', abort);
      try {
        await rpc?.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
};

async function answerUi(
  input: HarnessRun,
  rpc: JsonLinesProcess,
  event: any,
  bridge: string,
  own: { channel: string; tools?: InterlockTools },
) {
  const respond = (value: object) => {
    if (!input.signal.aborted)
      rpc.send({ type: 'extension_ui_response', id: event.id, ...value });
  };
  const dialog = event as {
    method?: string;
    title?: unknown;
    prefill?: unknown;
  };
  const name =
    dialog.method === 'editor' && typeof dialog.title === 'string'
      ? dialog.title
      : '';
  if (own.tools && name.startsWith(`${own.channel}:`)) {
    let args: unknown;
    try {
      args = JSON.parse(
        typeof dialog.prefill === 'string' ? dialog.prefill : '{}',
      );
    } catch {
      args = undefined;
    }
    const result = await own.tools.invoke(
      name.slice(own.channel.length + 1),
      args,
      input.signal,
    );
    respond({ value: JSON.stringify(result) });
  } else if (event.method === 'confirm') {
    // The bridge names the tool; other extensions' confirmations stay unjudged.
    const title = String(event.title ?? 'Pi requests approval');
    const tool = title.startsWith(`${bridge}:`)
      ? title.slice(bridge.length + 1)
      : undefined;
    const detail = String(event.message ?? '');
    let action;
    try {
      action = tool ? piAction(tool, JSON.parse(detail), input.cwd) : undefined;
    } catch {
      action = undefined;
    }
    const answer = await input.request({
      kind: 'permission',
      title: tool ? `Interlock requests ${tool}` : title,
      detail,
      ...(action ? { action } : {}),
    });
    respond({ confirmed: answer.allow === true });
  } else if (['select', 'input', 'editor'].includes(event.method)) {
    const answer = await input.request({
      kind: 'question',
      title: 'Pi needs your input',
      detail: '',
      questions: [
        {
          id: event.id,
          text: String(event.title ?? 'Pi question'),
          ...(event.method === 'select'
            ? { options: event.options }
            : { allowOther: true }),
        },
      ],
    });
    const value = answer.answers?.[event.id]?.[0];
    if (
      value === undefined ||
      (event.method === 'select' && !event.options?.includes(value))
    )
      respond({ cancelled: true });
    else respond({ value });
  } else if (['notify', 'setStatus'].includes(event.method)) {
    input.onProgress(String(event.message ?? event.text ?? '').slice(0, 200));
  }
}

function addUsage(totals: Map<string, ModelUsage>, message: any) {
  const u = message.usage;
  const measured = (v: unknown): v is number =>
    Number.isSafeInteger(v) && (v as number) >= 0;
  if (
    typeof message.provider !== 'string' ||
    typeof message.model !== 'string' ||
    !u ||
    ![u.input, u.output, u.cacheRead, u.cacheWrite].every(measured)
  )
    return;
  const key = `${message.provider}\0${message.model}`;
  const prior = totals.get(key);
  const value: ModelUsage = {
    provider: message.provider,
    model: message.model,
    inputTokens:
      (prior?.inputTokens ?? 0) + u.input + u.cacheRead + u.cacheWrite,
    outputTokens: (prior?.outputTokens ?? 0) + u.output,
    cachedInputTokens: (prior?.cachedInputTokens ?? 0) + u.cacheRead,
    ...(measured(u.reasoning) &&
    (!prior || prior.reasoningOutputTokens !== undefined)
      ? {
          reasoningOutputTokens:
            (prior?.reasoningOutputTokens ?? 0) + u.reasoning,
        }
      : {}),
  };
  const cost = Math.round(u.cost?.total * 1e6);
  if (measured(cost) && (!prior || prior.cost))
    value.cost = {
      amountMicros: (prior?.cost?.amountMicros ?? 0) + cost,
      currency: 'USD',
      source: 'Pi estimated usage',
    };
  totals.set(key, value);
}
import { transcriptText } from './transcriptEvents.js';
