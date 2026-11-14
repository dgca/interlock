import { pauseRequestSchema } from '@interlock/core';
import type { createMcpClient } from '../client.js';
import type { createProfileServer } from './register.js';

/** Pause holds, plus holding and releasing one queued start. */
export function registerPauseTools(
  tool: ReturnType<typeof createProfileServer>['tool'],
  client: ReturnType<typeof createMcpClient>,
) {
  tool(
    'manage_pause',
    'Create, release and list persistent, independent pause holds. pause requires target {scope:"library"} or {scope:"workflow",workflowId}, an actor label and a reason; keep the returned ID. resume releases one exact ID and is idempotent when it is already released. Release only your own record; work continues only when all applicable holds clear. list without workflowId returns library holds, and with workflowId returns library holds plus that workflow\'s; an optional scope filter of workflow requires workflowId. offset and limit default to 0 and 20, with a maximum of 100, exact total and nextOffset. Pauses gate claims and launches, graph boundaries and input acceptance. Submissions, revisions, completion of in-flight work, reads, cancellation and cleanup continue. Manual starts may wait while paused. actor is only a label. list never mutates. hold {runId,reason} parks a queued start until release {runId}.',
    { request: pauseRequestSchema },
    ({ request }) =>
      request.action === 'list'
        ? client.pauses.list({
            workflowId: request.workflowId,
            scope: request.scope,
            offset: request.offset,
            limit: request.limit,
          })
        : request.action === 'pause'
          ? client.pauses.pause({
              target: request.target,
              actor: request.actor,
              reason: request.reason,
            })
          : request.action === 'resume'
            ? client.pauses.resume({ id: request.id })
            : request.action === 'hold'
              ? client.boards.hold({
                  runId: request.runId,
                  reason: request.reason,
                })
              : client.boards.release({ runId: request.runId }),
  );
}
