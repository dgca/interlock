import { engineClient } from './engineClient.js';
import { parseArgs } from 'node:util';
import { parse } from './json.js';
import type { SaveBoardType } from '@interlock/core';

const usage =
  'Usage: board view [board-id] [--workflow ID] [--lane LANE] [--offset N] [--limit N] | board types | board save-type <json|@file>';

/** Board views and board types. */
export async function runBoardCommand(args: string[]) {
  const client = engineClient();
  const [action, ...rest] = args;
  if (action === 'types' && !rest.length) return client.boardTypes.list.query();
  if (action === 'save-type' && rest.length === 1)
    return client.boardTypes.save.mutate(
      (await parse(rest[0])) as SaveBoardType,
    );
  if (action !== 'view') throw new Error(usage);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      workflow: { type: 'string' },
      lane: { type: 'string' },
      offset: { type: 'string' },
      limit: { type: 'string' },
    },
  });
  if (positionals.length > 1) throw new Error(usage);
  const number = (value?: string) =>
    value === undefined ? undefined : Number(value);
  return client.boards.view.query({
    id: positionals[0],
    workflowId: values.workflow,
    lane: values.lane,
    offset: number(values.offset),
    limit: number(values.limit),
  });
}
