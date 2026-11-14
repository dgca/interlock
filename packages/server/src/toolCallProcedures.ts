import { toolCallRequestSchema } from '@interlock/core';
import { p } from './trpc.js';

/** An Agent tool call under the caller's claim. The wait ends early when the request is cancelled. */
export const callTool = p
  .input(toolCallRequestSchema)
  .mutation(({ ctx, input, signal }) =>
    ctx.engine.callTool(
      input,
      ctx.signal && signal
        ? AbortSignal.any([ctx.signal, signal])
        : (ctx.signal ?? signal),
    ),
  );
