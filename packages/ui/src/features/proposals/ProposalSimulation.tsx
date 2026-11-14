import { LoadingSkeleton } from '../../design-system';
import type { ProposalSimulation as Simulation } from '@interlock/core/proposals';
import { ListTable, ListTableRow } from '../../components/ListTable/ListTable';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import styles from './Proposals.module.css';

const caseTable = {
  columns: [
    { label: 'Case', width: '44%' },
    { label: 'Current draft', width: '28%' },
    { label: 'With proposal', width: '28%' },
  ],
  minWidth: 340,
} as const;

const routes = ({
  coveredEdges,
  totalEdges,
}: {
  coveredEdges: number;
  totalEdges: number;
}) => `${coveredEdges} of ${totalEdges}`;

/** Saved cases simulated against the current draft and with the proposal applied. */
export function ProposalSimulation({
  simulation,
}: {
  simulation?: Simulation;
}) {
  if (!simulation || simulation.state === 'running')
    return <LoadingSkeleton label="Simulating saved cases…" />;
  if (simulation.state === 'unavailable')
    return <p className={styles.secondary}>{simulation.reason}</p>;
  const failing = simulation.cases.filter((c) => c.after !== 'passed').length;
  const regressions = simulation.cases.filter(
    (c) => c.before === 'passed' && c.after !== 'passed',
  ).length;
  return (
    <>
      <dl className={styles.facts}>
        <div>
          <dt>With proposal</dt>
          <dd>
            {simulation.cases.length - failing} of {simulation.cases.length}{' '}
            cases pass
            {regressions > 0 && ` · ${regressions} newly failing`}
          </dd>
        </div>
        <div>
          <dt>Routes covered</dt>
          <dd>
            {routes(simulation.coverage.before)} →{' '}
            {routes(simulation.coverage.after)}
          </dd>
        </div>
      </dl>
      <ListTable {...caseTable} label="Simulated cases">
        {simulation.cases.map((c) => (
          <ListTableRow key={`${c.suiteId}:${c.caseId}`}>
            <span className={styles.identity}>
              <strong>{c.caseName}</strong>
              <small>{c.suiteName}</small>
            </span>
            <span>
              <StatusBadge status={c.before} />
            </span>
            <span>
              <StatusBadge status={c.after} />
              {c.after !== 'passed' && c.error && (
                <small className={styles.caseError}>{c.error}</small>
              )}
            </span>
          </ListTableRow>
        ))}
      </ListTable>
      {simulation.omittedCases > 0 && (
        <p className={styles.secondary}>
          {simulation.omittedCases} more cases were not simulated. Run the suite
          from Tests after approving.
        </p>
      )}
    </>
  );
}
