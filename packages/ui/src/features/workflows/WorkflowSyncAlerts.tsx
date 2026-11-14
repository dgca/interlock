import { Alert, Text } from '../../design-system';

import { trpc, useQuery } from '../../lib/query';

export interface WorkflowSyncAlert {
  file: string;
  workflowId?: string;
  reason: string;
}

/** Files in the repository sync folder that changed nothing; empty when sync is off. */
export function useWorkflowSyncAlerts(workflowId?: string) {
  const result = useQuery({
    ...trpc.system.workflowSync.queryOptions(),
    // Folder changes raise no engine events, so this read polls on its own
    // while sync is on and stays out of the engine refresh cycle.
    meta: { engineRefresh: false },
    refetchInterval: (query) => (query.state.data ? 5000 : false),
  });
  const status = result.data;
  return {
    folder: status?.folder,
    items: (status?.items ?? []).filter(
      (item) => !workflowId || item.workflowId === workflowId,
    ),
  };
}

export function WorkflowSyncAlertList({
  folder,
  items,
}: {
  folder?: string;
  items: WorkflowSyncAlert[];
}) {
  if (!folder || !items.length) return null;
  return (
    <section aria-label="Workflow sync alerts">
      <Text fw={600} size="sm">
        Workflow sync · {items.length}
      </Text>
      <Text size="sm" c="dimmed" mb="sm">
        Files in {folder}. Fixing a file clears its alert.
      </Text>
      {items.map((item) => (
        <Alert
          key={`${item.file}:${item.workflowId ?? ''}`}
          color="yellow"
          mb="md"
          title={item.file}
        >
          <Text size="sm">{item.reason}</Text>
        </Alert>
      ))}
    </section>
  );
}
