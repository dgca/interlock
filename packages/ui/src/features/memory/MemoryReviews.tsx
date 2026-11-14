import { Link } from 'react-router';
import type { MemoryReviews } from '@interlock/core';
import { Alert, Anchor, Text } from '../../design-system';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';

/** Workflow memory notes waiting for review, library-wide or for one workflow. */
export function useMemoryReviews(workflowId?: string) {
  const query = useQuery(
    trpc.memory.read.queryOptions({ action: 'reviews', workflowId }),
  );
  const data = query.data as MemoryReviews | undefined;
  const total = data?.total ?? 0;
  // A tab count is shown only when notes wait for review.
  return { items: data?.items ?? [], total, count: total || undefined };
}

/** Needs attention entries linking to each workflow's review queue. */
export function MemoryReviewList({ items }: Pick<MemoryReviews, 'items'>) {
  if (!items.length) return null;
  return (
    <section aria-label="Memory notes waiting for review">
      <Text fw={600} size="sm" mb="sm">
        Memory notes waiting for review
      </Text>
      {items.map((item) => (
        <Alert key={item.workflowId} color="yellow" mb="md" title={item.name}>
          <Text size="sm">
            {item.count} {item.count === 1 ? 'note waits' : 'notes wait'} for
            review. Later runs use agent notes only after approval.{' '}
            <Anchor
              component={Link}
              to={`${paths.workflow(item.workflowId)}?view=memory`}
              underline="always"
              inherit
            >
              Review notes
            </Anchor>
          </Text>
        </Alert>
      ))}
    </section>
  );
}
