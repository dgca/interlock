import { parseArgs } from 'node:util';
import { runQuerySchema, runTagsSchema } from '@interlock/core';
import type { engineClient } from './engineClient.js';
import { parse } from './json.js';

export function parseTags(values: string[] | undefined) {
  if (!values) return undefined;
  const entries = values.map((value) => {
    const equals = value.indexOf('=');
    if (equals < 1) throw new Error('Use --tag KEY=VALUE with a nonempty key');
    return [value.slice(0, equals), value.slice(equals + 1)] as const;
  });
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw new Error('Supply each --tag key once');
  return runTagsSchema.parse(Object.fromEntries(entries));
}

/** A full page leaves later runs unread; say how to continue, outside the JSON. */
function hintAtLimit<T extends { id: string }>(runs: T[], limit: number) {
  if (runs.length === limit && runs.length)
    process.stderr.write(
      `Stopped at ${limit} runs; continue with --after-run ${runs.at(-1)!.id}\n`,
    );
  return runs;
}

/**
 * Without filters, `runs` prints full records through `runs.list`, and
 * `--after-run` pages that same list. Filters select summaries through `runs.find`.
 */
export async function runsCommand(
  client: ReturnType<typeof engineClient>,
  args: string[],
) {
  const { values } = parseArgs({
    args,
    options: {
      tag: { type: 'string', multiple: true },
      workflow: { type: 'string' },
      status: { type: 'string' },
      'root-only': { type: 'boolean' },
      chain: { type: 'string' },
      limit: { type: 'string' },
      'after-run': { type: 'string' },
      'request-id': { type: 'string' },
      'external-task': { type: 'string' },
      'input-path': { type: 'string' },
      equals: { type: 'string' },
    },
  });
  const afterRunId = values['after-run'];
  if (Object.keys(values).every((key) => key === 'after-run'))
    return hintAtLimit(await client.runs.list.query({ afterRunId }), 1000);
  if ((values['input-path'] === undefined) !== (values.equals === undefined))
    throw new Error('--input-path and --equals must be supplied together');
  const query = runQuerySchema.parse({
    tags: parseTags(values.tag),
    workflowId: values.workflow,
    requestId: values['request-id'],
    externalTask:
      values['external-task'] === undefined
        ? undefined
        : ((await parse(values['external-task'])) as unknown),
    chainRootRunId: values.chain,
    status: values.status,
    rootOnly: values['root-only'],
    limit: values.limit === undefined ? undefined : Number(values.limit),
    afterRunId,
    inputMatch:
      values['input-path'] === undefined
        ? undefined
        : {
            path: values['input-path'],
            equals: (await parse(values.equals)) as unknown,
          },
  });
  return hintAtLimit(await client.runs.find.query(query), query.limit);
}
