#!/usr/bin/env node
// Deterministic native-protocol stand-in. Never invokes a model or executes a tool.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
if (process.argv.includes('--version')) {
  console.log('test-harness 1.0');
  process.exit(0);
}
const codex = process.argv.includes('app-server');
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
function flag(name) {
  const equals = process.argv.find((value) => value.startsWith(name + '='));
  const index = process.argv.indexOf(name);
  return equals
    ? equals.slice(name.length + 1)
    : index >= 0
      ? process.argv[index + 1]
      : undefined;
}
let session = flag('--resume') ?? randomUUID();
async function diagnostics() {
  await new Promise((resolve) =>
    process.stderr.write('test diagnostic\n'.repeat(300000), resolve),
  );
}
if (flag('--model') === 'diagnostic-flood') await diagnostics();
let waiting = false,
  model = 'test-model';
let awaitingGuidance = false;
const end = (allowed) => {
  if (model === 'wait') return;
  if (model === 'model-refusal' || model === 'late-model-refusal') {
    if (codex) {
      if (model === 'late-model-refusal')
        send({
          method: 'item/started',
          params: {
            threadId: session,
            turnId: 'turn',
            item: { type: 'commandExecution', id: 'action' },
          },
        });
      send({
        method: 'turn/completed',
        params: {
          threadId: session,
          turn: {
            id: 'turn',
            status: 'failed',
            error: {
              message: 'The requested model does not exist (model_not_found)',
            },
          },
        },
      });
    } else {
      send({
        type: 'assistant',
        session_id: session,
        error: 'model_not_found',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Model not found' }],
        },
      });
      send({
        type: 'result',
        subtype: 'error_during_execution',
        session_id: session,
        is_error: true,
        errors: ['model_not_found'],
      });
    }
    return;
  }
  const result = { result: { ok: allowed } };
  if (codex) {
    send({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: session,
        turnId: 'turn',
        tokenUsage: {
          total: {
            inputTokens: 13,
            cachedInputTokens: 2,
            outputTokens: 4,
            reasoningOutputTokens: 1,
          },
        },
      },
    });
    send({
      method: 'item/completed',
      params: {
        threadId: session,
        turnId: 'turn',
        item: {
          id: 'answer',
          type: 'agentMessage',
          text: JSON.stringify(result),
        },
      },
    });
    send({
      method: 'turn/completed',
      params: { threadId: session, turn: { id: 'turn', status: 'completed' } },
    });
  } else
    send({
      type: 'result',
      subtype: 'success',
      session_id: session,
      is_error: false,
      num_turns: 1,
      structured_output: result,
      total_cost_usd: 0.00004,
      usage: { input_tokens: 10, output_tokens: 4 },
      modelUsage: {
        'test-model': {
          inputTokens: 10,
          outputTokens: 4,
          cacheReadInputTokens: 2,
          cacheCreationInputTokens: 1,
          thinkingTokens: 1,
          costUSD: 0.00004,
          provider: 'firstParty',
          costBasis: 'list',
        },
      },
    });
};
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (codex) {
    if (message.method === 'initialize')
      send({ id: message.id, result: { userAgent: 'test' } });
    if (message.method === 'model/list') {
      send({
        id: message.id,
        result: {
          data: [
            {
              model: message.params.cursor ? 'fixture-fast' : 'fixture-model',
              supportedReasoningEfforts: [
                { reasoningEffort: 'low' },
                { reasoningEffort: 'high' },
              ],
              defaultReasoningEffort: 'high',
              displayName: message.params.cursor
                ? 'Fixture Fast'
                : 'Fixture Model',
            },
          ],
          nextCursor: message.params.cursor ? null : 'page-two',
        },
      });
    }
    if (['thread/start', 'thread/resume'].includes(message.method)) {
      model = message.params.model ?? model;
      session = message.params.threadId ?? session;
      if (model.startsWith('permissions-')) {
        const mode = model.slice('permissions-'.length);
        const expectedSandbox =
          mode === 'read-only'
            ? 'read-only'
            : mode === 'full-access'
              ? 'danger-full-access'
              : 'workspace-write';
        const expectedApprovals = mode === 'standard' ? 'untrusted' : 'never';
        if (
          message.params.sandbox !== expectedSandbox ||
          message.params.approvalPolicy !== expectedApprovals
        )
          throw Error('Unexpected native Codex permission configuration');
      }
      if (model === 'diagnostic-flood') await diagnostics();
      send({
        id: message.id,
        result: {
          thread: { id: message.params.threadId ?? session },
          model,
          modelProvider: 'openai',
        },
      });
    }
    if (message.method === 'turn/start') {
      if (model === 'effort-check' && message.params.effort !== 'high')
        throw Error('Missing native Codex effort');
      if (message.params.outputSchema?.properties?.result === undefined)
        throw Error('Missing result schema');
      send({
        id: message.id,
        result: { turn: { id: 'turn', status: 'inProgress' } },
      });
      if (model === 'transcript-steer') {
        send({
          method: 'item/started',
          params: {
            threadId: session,
            turnId: 'turn',
            item: {
              id: 'checks',
              type: 'commandExecution',
              command: 'pnpm test',
            },
          },
        });
        continue;
      }
      if (model === 'model-refusal') {
        end(false);
        continue;
      }
      if (model === 'permissions-full-access') {
        end(true);
        continue;
      }
      if (model === 'foreign-event')
        send({
          method: 'turn/completed',
          params: {
            threadId: 'foreign',
            turn: { id: 'foreign-turn', status: 'failed' },
          },
        });
      const file = model.startsWith('file-');
      if (model === 'file-approval')
        send({
          method: 'item/started',
          params: {
            threadId: session,
            turnId: 'turn',
            item: {
              id: 'tool',
              type: 'fileChange',
              changes: [
                {
                  path: 'example.txt',
                  kind: { type: 'update' },
                  diff: '-old\n+new',
                },
              ],
            },
          },
        });
      send({
        id: 900,
        method:
          model === 'secret-question'
            ? 'item/tool/requestUserInput'
            : file
              ? 'item/fileChange/requestApproval'
              : 'item/commandExecution/requestApproval',
        params: {
          threadId: session,
          turnId: 'turn',
          itemId: 'tool',
          ...(model === 'secret-question'
            ? {
                questions: [
                  {
                    id: 'key',
                    question: 'Enter a token',
                    isSecret: true,
                    options: null,
                    isOther: false,
                  },
                ],
              }
            : file
              ? {
                  reason: 'Update example file',
                  ...(model === 'file-grant' ? { grantRoot: '/private' } : {}),
                }
              : { command: 'test command' }),
        },
      });
      waiting = true;
    }
    if (message.id === 900 && message.result && waiting) {
      waiting = false;
      end(message.result.decision === 'accept');
    }
    if (message.method === 'turn/interrupt') {
      send({ id: message.id, result: {} });
      send({
        method: 'turn/completed',
        params: { turn: { id: 'turn', status: 'interrupted' } },
      });
    }
    if (message.method === 'turn/steer') {
      if (
        message.params.expectedTurnId !== 'turn' ||
        message.params.threadId !== session
      )
        throw Error('Incorrect steering identity');
      send({ id: message.id, result: { turnId: 'turn' } });
      send({
        method: 'item/completed',
        params: {
          threadId: session,
          turnId: 'turn',
          item: {
            id: 'checks',
            type: 'commandExecution',
            command: 'pnpm test',
            aggregatedOutput: 'Checks passed',
            exitCode: 0,
            status: 'completed',
          },
        },
      });
      end(true);
    }
  } else {
    if (message.type === 'control_request')
      send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: message.request_id,
          response: {
            commands: [],
            agents: [],
            models: [
              {
                value: 'fixture-model',
                supportsEffort: true,
                supportedEffortLevels: ['low', 'high'],
                displayName: 'Fixture Model',
                description: 'Native catalog fixture',
              },
            ],
            account: {},
            output_style: 'default',
            available_output_styles: [],
          },
        },
      });
    if (message.type === 'user') {
      if (awaitingGuidance) {
        awaitingGuidance = false;
        send({
          type: 'user',
          uuid: randomUUID(),
          session_id: session,
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'checks',
                content: 'Checks passed',
              },
            ],
          },
        });
        send({
          type: 'assistant',
          uuid: randomUUID(),
          session_id: session,
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Using your guidance.' }],
          },
        });
        model = 'test-model';
        end(true);
        continue;
      }
      if (process.argv.includes('--strict-mcp-config'))
        throw Error('Discovery must not send a user message');
      model = flag('--model') ?? model;
      if (model === 'effort-check' && flag('--effort') !== 'high')
        throw Error('Missing native Claude effort');
      send({
        type: 'system',
        subtype: 'init',
        session_id: session,
        model,
        tools: ['Bash'],
        mcp_servers: [],
        skills: [],
        apiKeySource: 'none',
        permissionMode: 'default',
      });
      if (model === 'transcript-message') {
        awaitingGuidance = true;
        send({
          type: 'assistant',
          uuid: randomUUID(),
          session_id: session,
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'checks',
                name: 'Bash',
                input: { command: 'pnpm test' },
              },
            ],
          },
        });
        continue;
      }
      if (model === 'model-refusal') {
        end(false);
        continue;
      }
      if (model.startsWith('permissions-')) {
        const mode = model.slice('permissions-'.length);
        const expected =
          mode === 'read-only'
            ? 'plan'
            : mode === 'full-access'
              ? 'bypassPermissions'
              : 'default';
        if (flag('--permission-mode') !== expected)
          throw Error('Unexpected native Claude permission configuration');
      }
      if (flag('--permission-mode') === 'bypassPermissions') {
        if (
          !process.argv.some(
            (value) =>
              value === '--allow-dangerously-skip-permissions' ||
              value === '--allow-dangerously-skip-permissions=true',
          )
        )
          throw Error('Missing explicit bypass enablement');
        end(true);
        continue;
      }
      send({
        type: 'control_request',
        request_id: 'permission',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Bash',
          input: { command: 'test command' },
          tool_use_id: 'tool',
        },
      });
      waiting = true;
    }
    if (
      message.type === 'control_response' &&
      message.response.request_id === 'permission' &&
      waiting
    ) {
      waiting = false;
      end(message.response.response?.behavior === 'allow');
    }
  }
}
