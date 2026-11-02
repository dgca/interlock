import { VERSION } from '../../../core/src/version.js';
import { jsonSchema, type ModelUsage } from '@interlock/core';
import {
  HarnessResultError,
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
    const fileChanges = new Map<string, unknown>();
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
      void rpc.close().catch(() => {});
    };
    input.signal.addEventListener('abort', abort, { once: true });
    rpc.onMessage = (message) => {
      const params = message.params ?? {};
      const foreign =
        (threadId && params.threadId && params.threadId !== threadId) ||
        (turnId &&
          (params.turnId ?? params.turn?.id) &&
          (params.turnId ?? params.turn?.id) !== turnId);
      if (foreign) {
        if (message.id !== undefined)
          rpc.send({
            id: message.id,
            error: {
              code: -32602,
              message: 'Request does not belong to this assignment',
            },
          });
        return;
      }
      if (
        message.method === 'item/started' &&
        params.item?.type === 'fileChange'
      ) {
        if (fileChanges.size >= 20)
          fileChanges.delete(fileChanges.keys().next().value!);
        if (JSON.stringify(params.item.changes ?? null).length <= 16000)
          fileChanges.set(params.item.id, params.item.changes);
      }
      if (message.id !== undefined && message.method) {
        void (async () => {
          let result: unknown;
          if (
            message.method === 'item/commandExecution/requestApproval' ||
            message.method === 'item/fileChange/requestApproval'
          ) {
            if (input.profile.permissions === 'read-only') {
              rpc.send({ id: message.id, result: { decision: 'decline' } });
              return;
            }
            const commandRequest = message.method.includes('commandExecution');
            const changes = fileChanges.get(params.itemId);
            if (
              params.grantRoot ||
              (commandRequest ? !params.command : !changes)
            ) {
              rpc.send({ id: message.id, result: { decision: 'decline' } });
              input.onProgress(
                'Declined an approval with missing action details or a broader write grant',
              );
              return;
            }
            const detail = commandRequest
              ? [
                  params.kind ? `Action: ${params.kind}` : '',
                  `Working directory: ${params.cwd ?? input.cwd}`,
                  params.environmentId
                    ? `Environment: ${params.environmentId}`
                    : '',
                  params.reason ?? '',
                  params.command,
                  params.networkApprovalContext
                    ? JSON.stringify(params.networkApprovalContext, null, 2)
                    : '',
                ]
                  .filter(Boolean)
                  .join('\n\n')
              : JSON.stringify({ reason: params.reason, changes }, null, 2);
            const answer = await input.request({
              kind: 'permission',
              title: message.method.includes('commandExecution')
                ? 'Codex requests a command'
                : 'Codex requests file changes',
              detail: String(detail),
            });
            result = { decision: answer.allow ? 'accept' : 'decline' };
          } else if (message.method === 'item/tool/requestUserInput') {
            if (params.questions?.some((q: any) => q.isSecret)) {
              rpc.send({ id: message.id, result: { answers: {} } });
              input.onProgress(
                'Declined a secret-input request; use native authentication outside this workflow',
              );
              return;
            }
            const answer = await input.request({
              kind: 'question',
              title: 'Codex needs your input',
              detail: '',
              questions: (params.questions ?? []).map((q: any) => ({
                id: q.id,
                allowOther: !!q.isOther,
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
        clientInfo: { name: 'interlock', title: 'Interlock', version: VERSION },
        capabilities: { experimentalApi: false },
      });
      rpc.send({ method: 'initialized' });
      const options = {
        cwd: input.cwd,
        approvalPolicy:
          input.profile.permissions === 'read-only' ||
          input.profile.permissions === 'full-access'
            ? 'never'
            : 'untrusted',
        approvalsReviewer: 'user',
        sandbox:
          input.profile.permissions === 'read-only'
            ? 'read-only'
            : input.profile.permissions === 'full-access'
              ? 'danger-full-access'
              : 'workspace-write',
        ...(input.profile.model ? { model: input.profile.model } : {}),
      };
      const thread = await rpc.request(
        input.sessionId ? 'thread/resume' : 'thread/start',
        input.sessionId ? { threadId: input.sessionId, ...options } : options,
      );
      threadId = thread.thread.id;
      if (input.sessionId && threadId !== input.sessionId)
        throw new Error('Codex did not resume the required native session');
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
      if (input.signal.aborted) throw new Error('Execution stopped');
      if (finished.id !== turnId)
        throw new Error('Codex completed an unexpected native turn');
      if (finished.status !== 'completed')
        throw new HarnessResultError(
          finished.error?.message ?? `Codex turn ${finished.status}`,
        );
      if (!finalText)
        throw new HarnessResultError(
          'Codex completed without a structured assignment result',
        );
      let envelope;
      try {
        envelope = JSON.parse(finalText);
      } catch {
        throw new HarnessResultError('Codex returned invalid result JSON');
      }
      if (!envelope || !Object.hasOwn(envelope, 'result'))
        throw new HarnessResultError(
          'Codex returned an invalid result envelope',
        );
      return { output: jsonSchema.parse(envelope.result), usage };
    } finally {
      input.signal.removeEventListener('abort', abort);
      await rpc.close();
    }
  },
};
