import { createClient } from '@interlock/client';

// Match the server caller so both transports use the same tool registrations.
export function createMcpClient(url?: string) {
  const client = createClient(url);
  return {
    workflows: {
      delete: client.workflows.delete.mutate,
      export: client.workflows.export.query,
      import: client.workflows.import.mutate,
      list: client.workflows.list.query,
      get: client.workflows.get.query,
      create: client.workflows.create.mutate,
      update: client.workflows.update.mutate,
      publish: client.workflows.publish.mutate,
    },
    runs: {
      find: client.runs.find.query,
      start: client.runs.start.mutate,
      get: client.runs.get.query,
      retry: client.runs.retry.mutate,
      cancel: client.runs.cancel.mutate,
    },
    work: {
      summaries: client.work.summaries.query,
      list: client.work.list.query,
      claim: client.work.claim.mutate,
      submit: client.work.submit.mutate,
      renew: client.work.renew.mutate,
      fail: client.work.fail.mutate,
    },
  };
}
