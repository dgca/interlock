import { toolCallRequestSchema } from '@interlock/core';
import type { createMcpClient } from '../client.js';
import type { createProfileServer } from './register.js';

/** Tool calls for claimed assignments whose Agent has tool edges. */
export function registerAssignmentTools(
  tool: ReturnType<typeof createProfileServer>['tool'],
  client: ReturnType<typeof createMcpClient>,
) {
  tool(
    'call_work_tool',
    "Run a tool from a claimed assignment's tools under your active claim and return the step's output. arguments match its inputSchema. Waits up to waitMs, capped by your lease; if status is running or waiting, call again with callId. Rejects over-limit calls; does not renew.",
    toolCallRequestSchema.shape,
    (input, signal) => client.work.callTool(input, { signal }),
  );
}
