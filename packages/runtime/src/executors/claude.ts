import { query } from '@anthropic-ai/claude-agent-sdk/core';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { MessageInput } from './messageInput.js';
import { transcriptText } from './transcriptEvents.js';
import { anthropicStreamUsage } from './budgetStops.js';
import { jsonSchema, type ModelUsage } from '@interlock/core';
import {
  HarnessResultError,
  HarnessModelError,
  isModelRefusal,
  assignmentPrompt,
  resultEnvelope,
  type HarnessAdapter,
  type HarnessRun,
} from './contracts.js';
import {
  detectExecutable,
  findExecutable,
  spawnManagedProcess,
} from './process.js';
import { claudeAction } from './permissionPolicy.js';

export const claudeAdapter: HarnessAdapter = {
  id: 'claude-code',
  available: (override) => !!findExecutable('claude', override),
  detect: (override) => detectExecutable('claude', override),
  async models(input) {
    const abortController = new AbortController();
    const abort = () => abortController.abort(input.signal.reason);
    input.signal.addEventListener('abort', abort, { once: true });
    if (input.signal.aborted) abort();
    let owned: ReturnType<typeof spawnManagedProcess> | undefined;
    let stream: ReturnType<typeof query> | undefined;
    try {
      // Initialize the native session without ever sending a user message or starting a turn.
      async function* noMessages(): AsyncGenerator<never> {
        if (!abortController.signal.aborted)
          await new Promise<void>((resolve) =>
            abortController.signal.addEventListener('abort', () => resolve(), {
              once: true,
            }),
          );
      }
      stream = query({
        prompt: noMessages(),
        options: {
          pathToClaudeCodeExecutable: input.command,
          cwd: input.cwd,
          abortController,
          settingSources: ['user', 'project', 'local'],
          persistSession: false,
          tools: [],
          mcpServers: {},
          strictMcpConfig: true,
          settings: { disableAllHooks: true },
          canUseTool: async () => ({
            behavior: 'deny',
            message: 'Model discovery does not execute tools',
          }),
          spawnClaudeCodeProcess: (options) => {
            owned = spawnManagedProcess(options.command, options.args, {
              cwd: options.cwd,
              env: options.env,
            });
            owned.child.stderr.resume();
            return owned.child;
          },
        },
      });
      const models = await stream.supportedModels();
      return {
        models: models.slice(0, 100).map((m) => ({
          id: m.value,
          name: m.displayName,
          description: m.description,
          ...(m.supportsEffort === false
            ? { effortLevels: [] }
            : m.supportedEffortLevels
              ? { effortLevels: m.supportedEffortLevels }
              : {}),
        })),
        truncated: models.length > 100,
      };
    } finally {
      input.signal.removeEventListener('abort', abort);
      abortController.abort();
      stream?.close();
      await owned?.close();
    }
  },
  async run(input: HarnessRun) {
    const messages = new MessageInput<SDKUserMessage>();
    let taskStarted = false;
    let modelRefused = false;
    let capturedSessionId: string | undefined = input.sessionId;
    const streamedUsage = anthropicStreamUsage();
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    input.signal.addEventListener('abort', abort, { once: true });
    if (input.signal.aborted) abort();
    let owned: ReturnType<typeof spawnManagedProcess> | undefined;
    let stream: ReturnType<typeof query> | undefined;
    try {
      stream = query({
        prompt: (async function* () {
          yield {
            type: 'user' as const,
            message: {
              role: 'user' as const,
              content: assignmentPrompt(input.work),
            },
            parent_tool_use_id: null,
            session_id: input.sessionId ?? '',
          };
          yield* messages;
        })(),
        options: {
          spawnClaudeCodeProcess: (options) => {
            owned = spawnManagedProcess(options.command, options.args, {
              cwd: options.cwd,
              env: options.env,
            });
            owned.child.stderr.resume();
            return owned.child;
          },
          pathToClaudeCodeExecutable: input.command,
          cwd: input.cwd,
          ...(input.profile.model ? { model: input.profile.model } : {}),
          ...(input.profile.effort
            ? {
                effort: input.profile.effort as
                  'low' | 'medium' | 'high' | 'xhigh' | 'max',
              }
            : {}),
          ...(input.sessionId ? { resume: input.sessionId } : {}),
          abortController,
          settingSources: ['user', 'project', 'local'],
          // Policy paths resolve from the session directory, so Bash returns there.
          ...(input.permissionPolicy
            ? {
                env: {
                  ...process.env,
                  CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1',
                },
              }
            : {}),
          permissionMode:
            input.profile.permissions === 'read-only'
              ? 'plan'
              : input.profile.permissions === 'full-access'
                ? 'bypassPermissions'
                : 'default',
          ...(input.profile.permissions === 'full-access'
            ? { allowDangerouslySkipPermissions: true }
            : {}),
          permissionPrompts: 'host',
          outputFormat: {
            type: 'json_schema',
            schema: resultEnvelope(input.work),
          },
          canUseTool: async (name, parameters) => {
            taskStarted = true;
            if (
              input.profile.permissions === 'read-only' &&
              ![
                'Read',
                'Glob',
                'Grep',
                'WebSearch',
                'WebFetch',
                'AskUserQuestion',
              ].includes(name)
            )
              return {
                behavior: 'deny',
                message: 'This Interlock profile is read-only',
              };
            if (name === 'AskUserQuestion') {
              const questions = Array.isArray(parameters.questions)
                ? parameters.questions
                : [];
              const answer = await input.request({
                kind: 'question',
                title: 'Claude Code needs your input',
                detail: '',
                questions: questions.map((q: any) => ({
                  id: q.question,
                  text: q.question,
                  options: q.options?.map((o: any) => o.label),
                  multiple: !!q.multiSelect,
                  allowOther: true,
                })),
              });
              return {
                behavior: 'allow',
                updatedInput: {
                  ...parameters,
                  answers: Object.fromEntries(
                    Object.entries(answer.answers ?? {}).map(
                      ([key, values]) => [key, values.join(', ')],
                    ),
                  ),
                },
              };
            }
            const answer = await input.request({
              kind: 'permission',
              title: `Claude Code requests ${name}`,
              detail: JSON.stringify(parameters, null, 2),
              action: claudeAction(name, parameters, input.cwd),
            });
            return answer.allow
              ? { behavior: 'allow', updatedInput: parameters }
              : {
                  behavior: 'deny',
                  message: 'User denied this action in Interlock',
                };
          },
          // Read-only profiles also constrain calls that native rules would auto-approve.
          ...(input.profile.permissions === 'read-only'
            ? {
                hooks: {
                  PreToolUse: [
                    {
                      hooks: [
                        async (event: any) =>
                          [
                            'Read',
                            'Glob',
                            'Grep',
                            'WebSearch',
                            'WebFetch',
                            'AskUserQuestion',
                          ].includes(event.tool_name)
                            ? {}
                            : {
                                hookSpecificOutput: {
                                  hookEventName: 'PreToolUse',
                                  permissionDecision: 'deny' as const,
                                  permissionDecisionReason:
                                    'This Interlock profile is read-only',
                                },
                              },
                      ],
                    },
                  ],
                },
              }
            : {}),
        },
      });
      for await (const message of stream) {
        // A result that arrives after a stop is returned; the host decides.
        if (input.signal.aborted && message.type !== 'result')
          throw new Error('Execution stopped');
        if (message.type === 'system' && message.subtype === 'init') {
          if (input.sessionId && message.session_id !== input.sessionId)
            throw new Error(
              'Claude Code did not resume the required native session',
            );
          capturedSessionId = message.session_id;
          input.onSession(message.session_id, message.model);
          input.onMessageChannel?.((text) =>
            messages.send({
              type: 'user',
              message: { role: 'user', content: text },
              parent_tool_use_id: null,
              session_id: message.session_id,
              client_composed: true,
              priority: 'next',
              origin: { kind: 'human' },
            }),
          );
        }
        if (message.type === 'user') {
          for (const block of typeof message.message.content === 'string'
            ? []
            : message.message.content) {
            if (block.type === 'tool_result')
              input.onTranscript?.({
                kind: 'tool_result',
                callId: block.tool_use_id,
                key: `result:${block.tool_use_id}`,
                text: transcriptText(block.content),
              });
          }
        }
        if (message.type === 'assistant') {
          if (message.error === 'model_not_found') modelRefused = true;
          else if (!message.error) taskStarted = true;
          const usage = streamedUsage(message.message);
          if (usage) input.onUsage?.(usage, 'attempt');
          for (const [index, block] of message.message.content.entries()) {
            if (block.type === 'text')
              input.onTranscript?.({
                kind: 'assistant',
                text: block.text,
                key: `assistant:${message.uuid}:${index}`,
              });
            if (block.type === 'tool_use') {
              input.onTranscript?.({
                kind: 'tool_call',
                tool: block.name,
                callId: block.id,
                key: `call:${block.id}`,
                text: transcriptText(block.input),
              });
              taskStarted = true;
              input.onProgress(`Using ${block.name}`);
            }
          }
        }
        if (message.type !== 'result') continue;
        if (message.subtype !== 'success' && modelRefused && !taskStarted)
          throw new HarnessModelError(
            'Claude Code rejected the selected model (model_not_found)',
          );
        if (message.subtype !== 'success')
          throw new HarnessResultError(
            `Claude Code ended with ${message.subtype}${'errors' in message ? ': ' + message.errors.join('; ').slice(0, 2000) : ''}`,
          );
        const envelope = message.structured_output;
        if (
          !envelope ||
          typeof envelope !== 'object' ||
          !Object.hasOwn(envelope, 'result')
        )
          throw new HarnessResultError(
            'Claude Code completed without a structured assignment result',
          );
        const usage: ModelUsage[] = Object.entries(message.modelUsage).map(
          ([model, u]) => ({
            provider:
              u.provider === 'firstParty'
                ? 'anthropic'
                : (u.provider ?? 'unknown'),
            model,
            inputTokens:
              u.inputTokens +
              u.cacheReadInputTokens +
              u.cacheCreationInputTokens,
            outputTokens: u.outputTokens,
            cachedInputTokens: u.cacheReadInputTokens,
            cacheWriteInputTokens: u.cacheCreationInputTokens,
            ...(u.thinkingTokens !== undefined
              ? { reasoningOutputTokens: u.thinkingTokens }
              : {}),
            ...(u.costBasis !== 'unknown' &&
            Number.isSafeInteger(Math.round(u.costUSD * 1e6))
              ? {
                  cost: {
                    amountMicros: Math.round(u.costUSD * 1e6),
                    currency: 'USD',
                    source: 'Claude Code estimated usage',
                  },
                }
              : {}),
          }),
        );
        return {
          output: jsonSchema.parse(
            (envelope as Record<string, unknown>).result,
          ),
          usage,
          resumeCommand: capturedSessionId
            ? `claude resume ${capturedSessionId}`
            : undefined,
        };
      }
      throw new Error('Claude Code ended without an assignment result');
    } catch (error) {
      if (
        !taskStarted &&
        error instanceof HarnessResultError &&
        isModelRefusal(error)
      )
        throw new HarnessModelError(
          error instanceof Error ? error.message : String(error),
        );
      throw error;
    } finally {
      input.onMessageChannel?.(undefined);
      messages.close();
      input.signal.removeEventListener('abort', abort);
      stream?.close();
      await owned?.close();
    }
  },
};
