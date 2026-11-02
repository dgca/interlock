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
const session = randomUUID();
let waiting = false,
  model = 'test-model';
const end = (allowed) => {
  if (model === 'wait') return;
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
    if (['thread/start', 'thread/resume'].includes(message.method)) {
      model = message.params.model ?? model;
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
      if (message.params.outputSchema?.properties?.result === undefined)
        throw Error('Missing result schema');
      send({
        id: message.id,
        result: { turn: { id: 'turn', status: 'inProgress' } },
      });
      send({
        id: 900,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: session,
          turnId: 'turn',
          itemId: 'tool',
          command: 'test command',
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
            models: [],
            account: {},
            output_style: 'default',
            available_output_styles: [],
          },
        },
      });
    if (message.type === 'user') {
      const index = process.argv.indexOf('--model');
      if (index >= 0) model = process.argv[index + 1];
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
