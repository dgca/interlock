import { parseArgs } from 'node:util';
import type { ProposalCreate } from '@interlock/core/proposals';
import { engineClient } from './engineClient.js';
import { parse } from './json.js';

const usage =
  'Usage: proposals list [--workflow ID] [--run ID] [--status open|approved|rejected|all] [--offset N] [--limit N] | proposals get <id> | proposals create <json|@file> | proposals approve <id> [--edits json|@file] | proposals reject <id> <reason> | proposals reapply <id> | proposals settings <workflow-id> [json|@file]';

/** Workflow change proposals: review, decide and configure. */
export async function runProposalsCommand(args: string[]) {
  const client = engineClient();
  const [action, ...rest] = args;
  if (action === 'get' && rest.length === 1)
    return client.proposals.get.query({ id: rest[0] });
  if (action === 'create' && rest.length === 1)
    return client.proposals.create.mutate(
      (await parse(rest[0])) as ProposalCreate,
    );
  if (action === 'reject' && rest.length === 2)
    return client.proposals.decide.mutate({
      action: 'reject',
      id: rest[0],
      reason: rest[1],
    });
  if (action === 'reapply' && rest.length === 1)
    return client.proposals.decide.mutate({ action: 'reapply', id: rest[0] });
  if (action === 'settings' && rest.length === 1)
    return client.proposals.settings.query({ workflowId: rest[0] });
  if (action === 'settings' && rest.length === 2)
    return client.proposals.saveSettings.mutate({
      workflowId: rest[0],
      settings: (await parse(rest[1])) as { agents: boolean },
    });
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      edits: { type: 'string' },
      workflow: { type: 'string' },
      run: { type: 'string' },
      status: { type: 'string' },
      offset: { type: 'string' },
      limit: { type: 'string' },
    },
  });
  if (action === 'approve' && positionals.length === 1)
    return client.proposals.decide.mutate({
      action: 'approve',
      id: positionals[0],
      ...(values.edits
        ? { edits: (await parse(values.edits)) as unknown[] as never }
        : {}),
    });
  if (action !== 'list' || positionals.length) throw new Error(usage);
  const number = (value?: string) =>
    value === undefined ? undefined : Number(value);
  return client.proposals.list.query({
    workflowId: values.workflow,
    runId: values.run,
    status: values.status as 'open' | undefined,
    offset: number(values.offset),
    limit: number(values.limit),
  });
}
