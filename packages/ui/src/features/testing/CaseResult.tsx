import { VisuallyHidden } from '../../design-system';
import { CircleCheck, CircleHelp, CircleX } from 'lucide-react';
import type { api } from '../../lib/api';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import { describeCheck } from './suiteDraft';
import styles from './Testing.module.css';

export type SuiteResults = Awaited<
  ReturnType<typeof api.testbench.suiteSimulations.query>
>;
export type CaseSimulation = NonNullable<
  SuiteResults['cases'][number]['simulation']
>;

const checkIcons = {
  pass: { Icon: CircleCheck, label: 'Passed' },
  fail: { Icon: CircleX, label: 'Failed' },
  unknown: { Icon: CircleHelp, label: 'Unknown' },
};

function routeSummary(coverage: CaseSimulation['coverage']) {
  if (!coverage) return undefined;
  return `${coverage.coveredEdges} of ${coverage.totalEdges} routes (${Math.round(coverage.percentage)}%)`;
}

/** One saved case with its latest fixture simulation, if any. */
export function CaseResult({
  name,
  caseId,
  simulation,
  suiteRevision,
  running = false,
}: {
  name: string;
  caseId: string;
  simulation: CaseSimulation | null;
  suiteRevision: number;
  running?: boolean;
}) {
  const passed = simulation?.checks.filter((c) => c.status === 'pass').length;
  const untested = simulation?.coverage?.untested ?? [];
  return (
    <li className={styles.result} aria-busy={running || undefined}>
      <div className={styles.resultHeading}>
        <h3>{name}</h3>
        <StatusBadge
          status={running ? 'running' : (simulation?.state ?? 'not_run')}
        />
      </div>
      <p className={styles.meta}>
        <code>{caseId}</code>
        {simulation && (
          <>
            <span>Version {simulation.version}</span>
            <time dateTime={simulation.createdAt}>
              {new Date(simulation.createdAt).toLocaleString()}
            </time>
            {simulation.suiteRevision !== suiteRevision && (
              <span className={styles.stale}>
                From suite revision {simulation.suiteRevision}
              </span>
            )}
          </>
        )}
      </p>
      {simulation && simulation.state !== 'unsupported' && (
        <dl className={styles.facts}>
          <div>
            <dt>Checks</dt>
            <dd>
              {simulation.checks.length
                ? `${passed} of ${simulation.checks.length} passed`
                : 'None'}
            </dd>
          </div>
          {simulation.coverage && (
            <div>
              <dt>Route coverage</dt>
              <dd>{routeSummary(simulation.coverage)}</dd>
            </div>
          )}
        </dl>
      )}
      {simulation?.error && (
        <p className={styles.resultError}>{simulation.error}</p>
      )}
      {!!simulation?.unsupported.length && (
        <ul className={styles.reasons} aria-label="Unsupported">
          {simulation.unsupported.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
          {simulation.unsupportedCount > simulation.unsupported.length && (
            <li>
              {simulation.unsupportedCount - simulation.unsupported.length} more
            </li>
          )}
        </ul>
      )}
      {!!simulation?.checks.length && simulation.state !== 'unsupported' && (
        <ul className={styles.checkResults} aria-label="Check results">
          {simulation.checks.map((check) => {
            const { Icon, label } = checkIcons[check.status];
            return (
              <li key={check.index} data-status={check.status}>
                <Icon size={16} aria-hidden="true" />
                <span>
                  <VisuallyHidden>{label}: </VisuallyHidden>
                  <span className={styles.checkText}>
                    {describeCheck(check.assertion, check.expectedOmitted)}
                  </span>
                  <small>{check.reason}</small>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {untested.length > 0 && (
        <details className={styles.untested}>
          <summary>Untested routes ({untested.length})</summary>
          <ul>
            {untested.map((edge) => (
              <li key={edge.edgeId}>
                <code>
                  {edge.source}
                  {edge.port ? `.${edge.port}` : ''} → {edge.target}
                </code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
