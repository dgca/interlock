import { jsonSchema, type ModelUsage } from '@interlock/core';
import {
  assignmentPrompt,
  resultEnvelope,
  type HarnessAdapter,
  type HarnessRun,
} from './contracts.js';
import { detectExecutable, JsonLinesProcess } from './process.js';

export const codexAdapter: HarnessAdapter = {
  id: 'codex',
  detect: (override) => detectExecutable('codex', override),
  async run(input: HarnessRun) {
    const rpc = new JsonLinesProcess(
      input.command,
      ['app-server', '--listen', 'stdio://'],
      input.cwd,
    );
    let turnId: string | undefined,
      threadId: string | undefined,
      finalText: string | undefined;
    let usage: ModelUsage[] | undefined,
      model = input.profile.model ?? '',
      provider = 'openai';
    let complete!: (value: any) => void;
    const completed = new Promise<any>((r) => {
      complete = r;
    });
    const abort = () => {
      if (threadId && turnId)
        void rpc
          .request('turn/interrupt', { threadId, turnId }, 2000)
          .catch(() => {});
      void rpc.close();
    };
    input.signal.addEventListener('abort', abort, { once: true });
    rpc.onMessage = (message) => {
      const params = message.params ?? {};
      if (message.id !== undefined && message.method) {
        void (async () => {
          let result: unknown;
          if (
            message.method === 'item/commandExecution/requestApproval' ||
            message.method === 'item/fileChange/requestApproval'
          ) {
            const detail =
              params.command ??
              params.reason ??
              JSON.stringify(params.changes ?? {}, null, 2);
            const answer = await input.request({
              kind: 'permission',
              title: message.method.includes('commandExecution')
                ? 'Codex requests a command'
                : 'Codex requests file changes',
              detail: String(detail),
            });
            result = { decision: answer.allow ? 'accept' : 'decline' };
          } else if (message.method === 'item/tool/requestUserInput') {
            const answer = await input.request({
              kind: 'question',
              title: 'Codex needs your input',
              detail: '',
              questions: (params.questions ?? []).map((q: any) => ({
                id: q.id,
                text: q.question,
                options: q.options?.map((o: any) => o.label),
              })),
            });
            result = {
              answers: Object.fromEntries(
                Object.entries(answer.answers ?? {}).map(([id, answers]) => [
                  id,
                  { answers },
                ]),
              ),
            };
          } else if (message.method === 'item/permissions/requestApproval') {
            // Additional sandbox grants require a separately designed scope UI. Never grant them implicitly.
            result = { permissions: {}, scope: 'turn' };
            input.onProgress(
              'Declined an unsupported additional-permissions request',
            );
          } else if (message.method === 'mcpServer/elicitation/request') {
            result = { action: 'decline', content: null };
            input.onProgress(
              'Declined an MCP elicitation that requires the native client',
            );
          } else {
            rpc.send({
              id: message.id,
              error: { code: -32601, message: 'Unsupported host request' },
            });
            return;
          }
          if (!input.signal.aborted) rpc.send({ id: message.id, result });
        })().catch(() => {
          if (!input.signal.aborted) {
            try {
              rpc.send({
                id: message.id,
                error: {
                  code: -32603,
                  message: 'Interlock could not answer this request',
                },
              });
            } catch {}
          }
        });
        return;
      }
      if (
        message.method === 'item/completed' &&
        params.item?.type === 'agentMessage'
      )
        finalText = params.item.text;
      if (
        message.method === 'item/started' &&
        !['agentMessage', 'reasoning', 'userMessage'].includes(
          params.item?.type,
        )
      )
        input.onProgress(`Using ${params.item?.type ?? 'tool'}`);
      if (
        message.method === 'thread/tokenUsage/updated' &&
        model &&
        params.tokenUsage?.total
      ) {
        const t = params.tokenUsage.total;
        usage = [
          {
            provider,
            model,
            inputTokens: t.inputTokens,
            outputTokens: t.outputTokens,
            cachedInputTokens: t.cachedInputTokens,
            reasoningOutputTokens: t.reasoningOutputTokens,
          },
        ];
      }
      if (message.method === 'turn/completed') complete(params.turn);
    };
    try {
      if (input.signal.aborted) throw new Error('Execution stopped');
      await rpc.request('initialize', {
        clientInfo: { name: 'interlock', title: 'Interlock', version: '1' },
        capabilities: { experimentalApi: false },
      });
      rpc.send({ method: 'initialized' });
      const options = {
        cwd: input.cwd,
        approvalPolicy: 'untrusted',
        approvalsReviewer: 'user',
        sandbox:
          input.profile.permissions === 'read-only'
            ? 'read-only'
            : 'workspace-write',
        ...(input.profile.model ? { model: input.profile.model } : {}),
      };
      const thread = await rpc.request(
        input.sessionId ? 'thread/resume' : 'thread/start',
        input.sessionId ? { threadId: input.sessionId, ...options } : options,
      );
      threadId = thread.thread.id;
      model = thread.model;
      provider = thread.modelProvider ?? 'openai';
      input.onSession(threadId!, model);
      const turn = await rpc.request('turn/start', {
        threadId,
        input: [
          {
            type: 'text',
            text: assignmentPrompt(input.work),
            text_elements: [],
          },
        ],
        outputSchema: resultEnvelope(input.work),
      });
      turnId = turn.turn.id;
      const finished = await Promise.race([completed, rpc.ended()]);
      if (input.signal.aborted || finished.status !== 'completed')
        throw new Error(
          finished.error?.message ?? `Codex turn ${finished.status}`,
        );
      if (!finalText)
        throw new Error(
          'Codex completed without a structured assignment result',
        );
      const envelope = JSON.parse(finalText);
      if (!envelope || !Object.hasOwn(envelope, 'result'))
        throw new Error('Codex returned an invalid result envelope');
      return { output: jsonSchema.parse(envelope.result), usage };
    } finally {
      input.signal.removeEventListener('abort', abort);
      await rpc.close();
    }
  },
};
