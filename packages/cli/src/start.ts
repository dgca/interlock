import {
  runVersionPolicySchema,
  withNextCall,
  type RunStartRequest,
} from '@interlock/core';
import { engineClient } from './engineClient.js';
import { parse } from './json.js';
import { parseSummaryArgs, parseTags } from './args.js';

/** `start <workflow-id> <json|@file> [version] [options]`. */
export async function runStartCommand(args: string[]) {
  const client = engineClient();
  const { values, positionals } = parseSummaryArgs(args, true);
  if (positionals.length < 2 || positionals.length > 3)
    throw new Error(
      'Usage: start <workflow-id> <json|@file> [version] [--title TEXT] [--summary] [--budget json|@file] [--request-id key] [--external-task json|@file] [--tag KEY=VALUE ...] [--priority N] [--after json|@file] [--on-active-external-task allow|reuse|reject|cancel_previous] [--version-policy pinned|latest-compatible] [--hold REASON]',
    );
  const input = {
    title: typeof values.title === 'string' ? values.title : undefined,
    tags: parseTags(Array.isArray(values.tag) ? values.tag : undefined),
    versionPolicy:
      values['version-policy'] === undefined
        ? undefined
        : runVersionPolicySchema.parse(values['version-policy']),
    priority:
      typeof values.priority === 'string' ? Number(values.priority) : undefined,
    after:
      typeof values.after === 'string'
        ? ((await parse(values.after)) as RunStartRequest['after'])
        : undefined,
    onActiveExternalTask:
      typeof values['on-active-external-task'] === 'string'
        ? (values['on-active-external-task'] as
            'allow' | 'reuse' | 'reject' | 'cancel_previous')
        : undefined,
    requestId:
      typeof values['request-id'] === 'string'
        ? values['request-id']
        : undefined,
    externalTask:
      typeof values['external-task'] === 'string'
        ? ((await parse(
            values['external-task'],
          )) as RunStartRequest['externalTask'])
        : undefined,
    budget:
      typeof values.budget === 'string'
        ? ((await parse(values.budget)) as RunStartRequest['budget'])
        : undefined,
    workflowId: positionals[0],
    input: (await parse(positionals[1])) as RunStartRequest['input'],
    version: positionals[2] === undefined ? undefined : Number(positionals[2]),
  };
  return values.summary
    ? withNextCall(await client.runs.startSummary.mutate(input))
    : client.runs.start.mutate(input);
}
