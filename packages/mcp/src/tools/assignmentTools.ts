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
    "Call a tool from a claimed assignment's tools with your claim; returns the step's output. Waits up to waitMs within your lease; if status is running or waiting, call again with callId.",
    toolCallRequestSchema.shape,
    (input, signal) => client.work.callTool(input, { signal }),
  );
}
