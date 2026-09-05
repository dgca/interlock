import { readFile } from 'node:fs/promises';
import { createClient } from '@interlock/client';
const parse = async (value: string | undefined) => {
  if (value === undefined) throw new Error('Missing JSON argument');
  return JSON.parse(
    value.startsWith('@') ? await readFile(value.slice(1), 'utf8') : value,
  );
};
export async function runCommand(argv: string[]) {
  const client = createClient(process.env.INTERLOCK_URL);
  const [command, ...args] = argv;
  switch (command) {
    case 'workflows':
      return client.workflows.list.query();
    case 'workflow':
      return client.workflows.get.query({ id: args[0] });
    case 'import': {
      const input = await parse(args[0]);
      return client.workflows.create.mutate(input);
    }
    case 'publish':
      return client.workflows.publish.mutate({ id: args[0] });
    case 'start':
      return client.runs.start.mutate({
        workflowId: args[0],
        input: await parse(args[1]),
        version: args[2] ? Number(args[2]) : undefined,
      });
    case 'runs':
      return client.runs.list.query();
    case 'run':
      return client.runs.get.query({ id: args[0] });
    case 'work':
      return client.work.list.query({ runId: args[0] });
    case 'claim':
      return client.work.claim.mutate({
        workId: args[0],
        workerId: args[1] ?? 'cli',
        ...(args[2] ? await parse(args[2]) : {}),
      });
    case 'submit':
      return client.work.submit.mutate({
        workId: args[0],
        token: args[1],
        output: await parse(args[2]),
      });
    case 'fail':
      return client.work.fail.mutate({
        workId: args[0],
        token: args[1],
        error: args[2],
      });
    case 'renew':
      return client.work.renew.mutate({ workId: args[0], token: args[1] });
    case 'cancel':
      return client.runs.cancel.mutate({ id: args[0] });
    case 'retry':
      return client.runs.retry.mutate({ id: args[0] });
    default:
      return {
        usage: [
          'workflows',
          'workflow <id>',
          'import <json|@file>',
          'publish <id>',
          'start <workflow-id> <json|@file> [version]',
          'runs',
          'run <id>',
          'work [run-id]',
          'claim <work-id> [worker-id] [capabilities-json]',
          'submit <work-id> <token> <json|@file>',
          'fail <work-id> <token> <error>',
          'renew <work-id> <token>',
          'cancel <run-id>',
          'retry <run-id>',
        ],
      };
  }
}
