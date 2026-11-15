import { trpc, useQuery } from '../../lib/query';

/**
 * The agent an owned helper without its own executor uses when its owner
 * invokes it: the owner's latest published executor, or its draft's before the
 * first publication. Undefined for library workflows and while loading.
 */
export function useOwnerAgent(workflowId: string | undefined, enabled = true) {
  const helper = useQuery({
    ...trpc.workflows.get.queryOptions({ id: workflowId ?? '' }),
    enabled: enabled && !!workflowId,
  }).data;
  const id = helper?.ownerWorkflowId ?? '';
  const owner = useQuery({
    ...trpc.workflows.get.queryOptions({ id }),
    enabled: enabled && !!id,
  }).data;
  const versions = useQuery({
    ...trpc.workflows.versions.queryOptions({ id }),
    enabled: enabled && !!id && !!owner?.latestVersion,
  }).data;
  if (!id || !owner) return undefined;
  if (!owner.latestVersion)
    return { name: owner.name, executor: owner.draft.executor };
  const published = versions?.find((v) => v.version === owner.latestVersion);
  return published
    ? { name: owner.name, executor: published.definition.executor }
    : undefined;
}
