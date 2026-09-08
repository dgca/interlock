import { createClient } from '@interlock/client';

// Match the server caller so both transports use the same tool registrations.
export function createMcpClient(url?: string) {
  const client = createClient(url);
  return {
    workflows: {
      list: client.workflows.list.query,
      get: client.workflows.get.query,
      create: client.workflows.create.mutate,
      update: client.workflows.update.mutate,
      publish: client.workflows.publish.mutate,
    },
    runs: {
      start: client.runs.start.mutate,
      get: client.runs.get.query,
      retry: client.runs.retry.mutate,
      cancel: client.runs.cancel.mutate,
    },
    work: {
      list: client.work.list.query,
      claim: client.work.claim.mutate,
      submit: client.work.submit.mutate,
      renew: client.work.renew.mutate,
      fail: client.work.fail.mutate,
    },
  };
}
