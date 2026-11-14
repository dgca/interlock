import { lazy, Suspense, type ComponentProps } from 'react';
import { trpc, useQuery } from '../../lib/query';
import { ProposalsViewSkeleton } from './ProposalsSkeleton';

const ProposalsView = lazy(() =>
  import('./ProposalsView').then((m) => ({ default: m.ProposalsView })),
);

/** The workflow page's Proposals section, loaded on demand. */
export function ProposalsSection(props: ComponentProps<typeof ProposalsView>) {
  return (
    <Suspense fallback={<ProposalsViewSkeleton />}>
      <ProposalsView {...props} />
    </Suspense>
  );
}

/** Open proposals for the workflow tab count; unknown while loading or failed. */
export function useOpenProposalCount(workflowId: string) {
  return useQuery(
    trpc.proposals.list.queryOptions({ workflowId, status: 'open', limit: 1 }),
  ).data?.total;
}
