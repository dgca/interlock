import { workMemorySchema } from '@interlock/core';
import type { createMcpClient } from '../client.js';
import type { createProfileServer } from './register.js';

/** Workflow memory for the claimed assignment's step and workflow. */
export function registerMemoryTools(
  tool: ReturnType<typeof createProfileServer>['tool'],
  client: ReturnType<typeof createMcpClient>,
) {
  tool(
    'work_memory',
    "Workflow memory during a claim. Live notes are already in assignment.prompt. read lists this step's and workflow's notes; noteId returns its history. write saves one lasting fact for later runs; usually a person reviews it first. Fails when memory is off.",
    { request: workMemorySchema },
    ({ request }) => client.memory.work(request),
  );
}
