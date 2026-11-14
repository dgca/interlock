import {
  launcherCompleteSchema,
  launcherCredentialSchema,
  launcherFailSchema,
  launcherPollSchema,
} from '@interlock/core/launcherClient';
import { p, t } from './trpc.js';

/** Pull launcher clients lease and complete operations; operators rotate the credential. */
export const launcherRouter = t.router({
  poll: p
    .input(launcherPollSchema)
    .mutation(({ ctx, input }) =>
      ctx.engine.executors.launcher.pull.poll(input, ctx.signal),
    ),
  complete: p
    .input(launcherCompleteSchema)
    .mutation(({ ctx, input }) =>
      ctx.engine.executors.launcher.pull.complete(input),
    ),
  fail: p
    .input(launcherFailSchema)
    .mutation(({ ctx, input }) =>
      ctx.engine.executors.launcher.pull.fail(input),
    ),
  rotateCredential: p
    .input(launcherCredentialSchema)
    .mutation(({ ctx, input }) =>
      ctx.engine.executors.launcher.pull.rotateCredential(input),
    ),
});
