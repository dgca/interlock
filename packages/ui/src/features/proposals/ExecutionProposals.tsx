import { Anchor } from '../../design-system';
import { Link } from 'react-router';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import { trpc, useQuery } from '../../lib/query';
import { paths } from '../../routes/paths';
import styles from './Proposals.module.css';

/** Workflow change proposals made by one execution, beside it in the run inspector. */
export function ExecutionProposals({
  runId,
  executionId,
}: {
  runId: string;
  executionId: string;
}) {
  const query = useQuery(
    trpc.proposals.list.queryOptions({ runId, limit: 100 }),
  );
  const items =
    query.data?.items.filter((p) => p.executionId === executionId) ?? [];
  if (!items.length) return null;
  return (
    <section
      className={styles.inspector}
      aria-labelledby={`proposals-${executionId}`}
    >
      <h3 id={`proposals-${executionId}`}>Proposed workflow changes</h3>
      <ul>
        {items.map((p) => (
          <li key={p.id}>
            <Anchor
              component={Link}
              to={paths.workflowProposals(p.workflowId, p.id)}
              underline="hover"
            >
              {p.title}
            </Anchor>
            <StatusBadge status={p.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}
