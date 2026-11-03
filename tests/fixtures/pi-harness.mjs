#!/usr/bin/env node
// Exercise the real generated permission extension, without a provider or tool execution.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
if (process.argv.includes('--version')) {
  console.log('pi fixture 1.1.0');
  process.exit(0);
}
const flag = (name) => process.argv[process.argv.indexOf(name) + 1];
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const commands = [],
  handlers = {},
  answers = new Map();
if (process.argv.includes('--extension')) {
  const extension = await import(pathToFileURL(flag('--extension')).href);
  extension.default({
    registerCommand: (name) => commands.push({ name, source: 'extension' }),
    on: (name, handler) => {
      handlers[name] = handler;
    },
  });
} else if (
  !process.argv.includes('--no-session') ||
  !process.argv.includes('--no-mcp')
) {
  throw Error('Discovery must be ephemeral and disable MCP');
}
const sessionId = flag(
  process.argv.includes('--session') ? '--session' : '--session-id',
);
let model = { provider: 'fixture', id: 'model', name: 'Fixture Model' },
  thinkingLevel = 'off';
const response = (message, data) =>
  send({
    type: 'response',
    id: message.id,
    command: message.type,
    success: true,
    data,
  });
async function run(message) {
  if (message.type === 'extension_ui_response') {
    answers.get(message.id)?.(message);
    return;
  }
  if (message.type === 'get_available_models')
    response(message, {
      models: [{ provider: 'fixture', id: 'model', name: 'Fixture Model' }],
    });
  else if (message.type === 'get_available_thinking_levels')
    response(message, { levels: ['off', 'low', 'high'] });
  else if (message.type === 'get_commands') response(message, { commands });
  else if (message.type === 'get_state')
    response(message, { sessionId, model, thinkingLevel });
  else if (message.type === 'set_model') {
    model = { provider: message.provider, id: message.modelId };
    response(message, model);
  } else if (message.type === 'set_thinking_level') {
    thinkingLevel = message.level;
    response(message);
  } else if (message.type === 'prompt') {
    if (!handlers.tool_call) throw Error('Discovery sent an assignment');
    if (!message.message.includes('Result envelope schema:'))
      throw Error('Missing result schema');
    response(message, { disposition: 'started' });
    if (message.message.includes('MALFORMED_MODEL_EVENT')) {
      process.stdout.write('model_not_found\n');
      return;
    }
    if (message.message.includes('MODEL_REFUSAL')) {
      if (message.message.includes('LATE_MODEL_REFUSAL'))
        send({ type: 'tool_execution_start', toolName: 'write' });
      send({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'OpenAI API error (400): {"code":"model_not_found"}',
          content: [],
        },
      });
      send({ type: 'agent_settled', aborted: false });
      return;
    }
    const blocked = await handlers.tool_call(
      { toolName: 'bash', input: { command: 'test command' } },
      {
        hasUI: true,
        ui: {
          confirm: (title, detail) =>
            new Promise((resolve) => {
              answers.set('permission', (answer) => resolve(answer.confirmed));
              send({
                type: 'extension_ui_request',
                id: 'permission',
                method: 'confirm',
                title,
                message: detail,
              });
            }),
        },
      },
    );
    if (message.message.includes('WAIT_FOREVER')) return;
    if (message.message.includes('QUESTION')) {
      const answer = await new Promise((resolve) => {
        answers.set('question', resolve);
        send({
          type: 'extension_ui_request',
          id: 'question',
          method: 'select',
          title: 'Pick one',
          options: ['One', 'Two'],
        });
      });
      if (answer.value !== 'Two') throw Error('Question answer lost');
    }
    const assistant = (text, stopReason = 'stop') =>
      send({
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: model.provider,
          model: model.id,
          stopReason,
          content: [{ type: 'text', text }],
          usage: {
            input: 10,
            output: 4,
            cacheRead: 2,
            cacheWrite: 1,
            reasoning: 1,
            cost: { total: 0.00004 },
          },
        },
      });
    assistant('Retrying', 'error');
    send({ type: 'agent_end', willRetry: true });
    // Never accept the intermediate agent_end as completion.
    await new Promise((resolve) => setTimeout(resolve, 20));
    assistant(
      message.message.includes('BAD_JSON')
        ? 'invalid'
        : JSON.stringify({ result: { ok: !blocked?.block } }),
      message.message.includes('PROVIDER_ERROR') ? 'error' : 'stop',
    );
    send({ type: 'agent_settled', aborted: false });
  } else
    send({
      type: 'response',
      id: message.id,
      command: message.type,
      success: false,
      error: 'Unknown command',
    });
}
for await (const line of createInterface({ input: process.stdin })) {
  void run(JSON.parse(line));
}
