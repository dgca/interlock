import { createClient } from '@interlock/client';

// Match the server caller so both transports use the same tool registrations.
export function createMcpClient(url?: string) {
  const client = createClient(url);
  return {
    prompts: {
      list: client.prompts.list.query,
      get: client.prompts.get.query,
      create: client.prompts.create.mutate,
      update: client.prompts.update.mutate,
      delete: client.prompts.delete.mutate,
    },
    workflows: {
      versions: client.workflows.versions.query,
      previewVersionDeletion: client.workflows.previewVersionDeletion.query,
      deleteVersions: client.workflows.deleteVersions.mutate,
      delete: client.workflows.delete.mutate,
      export: client.workflows.export.query,
      import: client.workflows.import.mutate,
      list: client.workflows.list.query,
      get: client.workflows.get.query,
      create: client.workflows.create.mutate,
      update: client.workflows.update.mutate,
      edit: client.workflows.edit.mutate,
      validate: client.workflows.validate.query,
      publish: client.workflows.publish.mutate,
    },
    runs: {
      briefing: client.runs.briefing.query,
      wait: client.runs.wait.query,
      result: client.runs.result.query,
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
