import { engineClient } from './engineClient.js';
import { parse } from './json.js';

const usage =
  'Usage: launcher <json|@file> (action: credential, poll, complete or fail)';

/**
 * Pull launcher client calls and credential rotation. The credential may come
 * from INTERLOCK_LAUNCHER_CREDENTIAL so it stays out of the argument list.
 */
export async function runLauncherCommand(args: string[]) {
  if (args.length !== 1) throw new Error(usage);
  const { action, ...request } = (await parse(args[0])) as {
    action?: string;
    credential?: string;
  } & Record<string, unknown>;
  const client = engineClient().launcher;
  if (action === 'credential')
    return client.rotateCredential.mutate(request as never);
  const input = {
    ...request,
    credential:
      request.credential ?? process.env.INTERLOCK_LAUNCHER_CREDENTIAL ?? '',
  } as never;
  if (action === 'poll') return client.poll.mutate(input);
  if (action === 'complete') return client.complete.mutate(input);
  if (action === 'fail') return client.fail.mutate(input);
  throw new Error(usage);
}
