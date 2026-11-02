import { query } from '@anthropic-ai/claude-agent-sdk/core';
import { jsonSchema, type ModelUsage } from '@interlock/core';
import {
  assignmentPrompt,
  resultEnvelope,
  type HarnessAdapter,
  type HarnessRun,
} from './contracts.js';
import { detectExecutable } from './process.js';

export const claudeAdapter: HarnessAdapter = {
  id: 'claude-code',
  detect: (override) => detectExecutable('claude', override),
  async run(input: HarnessRun) {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    input.signal.addEventListener('abort', abort, { once: true });
    if (input.signal.aborted) abort();
    const stream = query({
      prompt: assignmentPrompt(input.work),
      options: {
        pathToClaudeCodeExecutable: input.command,
        cwd: input.cwd,
        ...(input.profile.model ? { model: input.profile.model } : {}),
        ...(input.sessionId ? { resume: input.sessionId } : {}),
        abortController,
        settingSources: ['user', 'project', 'local'],
        permissionMode:
          input.profile.permissions === 'read-only' ? 'plan' : 'default',
        permissionPrompts: 'host',
        outputFormat: {
          type: 'json_schema',
          schema: resultEnvelope(input.work),
        },
        canUseTool: async (name, parameters) => {
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
              })),
            });
            return {
              behavior: 'allow',
              updatedInput: {
                ...parameters,
                answers: Object.fromEntries(
                  Object.entries(answer.answers ?? {}).map(([key, values]) => [
                    key,
                    values.join(', '),
                  ]),
                ),
              },
            };
          }
          const answer = await input.request({
            kind: 'permission',
            title: `Claude Code requests ${name}`,
            detail: JSON.stringify(parameters, null, 2),
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
    try {
      for await (const message of stream) {
        if (input.signal.aborted) throw new Error('Execution stopped');
        if (message.type === 'system' && message.subtype === 'init')
          input.onSession(message.session_id, message.model);
        if (message.type === 'assistant')
          for (const block of message.message.content)
            if (block.type === 'tool_use')
              input.onProgress(`Using ${block.name}`);
        if (message.type !== 'result') continue;
        if (message.subtype !== 'success')
          throw new Error(`Claude Code ended with ${message.subtype}`);
        const envelope = message.structured_output;
        if (
          !envelope ||
          typeof envelope !== 'object' ||
          !Object.hasOwn(envelope, 'result')
        )
          throw new Error(
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
        };
      }
      throw new Error('Claude Code ended without an assignment result');
    } finally {
      input.signal.removeEventListener('abort', abort);
      stream.close();
    }
  },
};
