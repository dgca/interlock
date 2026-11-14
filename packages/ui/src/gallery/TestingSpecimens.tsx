import {
  CaseResult,
  type CaseSimulation,
} from '../features/testing/CaseResult';
import { CheckFields } from '../features/testing/CheckFields';
import resultStyles from '../features/testing/Testing.module.css';
import { Section, Specimen } from './GalleryLayout';

const simulation = (
  state: string,
  checks: CaseSimulation['checks'],
  extra: Partial<CaseSimulation> = {},
) =>
  ({
    id: state,
    mode: 'simulation',
    workflowId: 'workflow',
    suiteId: 'suite',
    suiteRevision: 2,
    caseId: state,
    version: 3,
    definitionHash: '',
    caseHash: '',
    state,
    createdAt: '2026-03-02T10:15:00Z',
    updatedAt: '2026-03-02T10:15:00Z',
    substitutionCount: 1,
    executionCount: 3,
    checkCount: checks.length,
    unsupportedCount: 0,
    unsupported: [],
    checks,
    coverage: {
      totalEdges: 5,
      coveredEdges: 4,
      percentage: 80,
      untested: [
        { edgeId: 'e4', source: 'review', target: 'escalate', port: 'false' },
      ],
    },
    ...extra,
  }) as CaseSimulation;
const answerCheck = {
  index: 0,
  kind: 'output' as const,
  assertion: {
    kind: 'output' as const,
    path: 'answer',
    visit: 1,
    operator: 'equals' as const,
    expected: '42',
  },
  expectedOmitted: false,
};
const routeCheck = {
  index: 1,
  kind: 'route' as const,
  assertion: {
    kind: 'route' as const,
    nodeId: 'review',
    visit: 1,
    port: 'true',
  },
  expectedOmitted: false,
};

export function Testing() {
  return (
    <Section id="testing" title="Test suites">
      <Specimen name="CaseResult" wide>
        <ul className={resultStyles.results}>
          <CaseResult
            name="Confident answer"
            caseId="confident"
            suiteRevision={2}
            simulation={simulation('passed', [
              {
                ...answerCheck,
                status: 'pass',
                reason: 'Output satisfies check',
              },
              { ...routeCheck, status: 'pass', reason: 'Expected route taken' },
            ])}
          />
          <CaseResult
            name="Escalates a low-confidence answer"
            caseId="escalates"
            suiteRevision={3}
            simulation={simulation('failed', [
              {
                ...routeCheck,
                status: 'fail',
                reason: 'Recorded route differs from expected port',
              },
            ])}
          />
          <CaseResult
            name="Fixture for a removed step"
            caseId="stale-fixture"
            suiteRevision={2}
            simulation={simulation('unsupported', [], {
              coverage: undefined,
              unsupported: [
                'Fixture 0: node or kind does not match the pinned definition',
              ],
              unsupportedCount: 1,
            })}
          />
          <CaseResult
            name="Not run yet"
            caseId="new-case"
            suiteRevision={2}
            simulation={null}
          />
        </ul>
      </Specimen>
      <Specimen name="CheckFields" wide>
        <CheckFields
          checks={[
            answerCheck.assertion,
            { ...routeCheck.assertion, port: '' },
          ]}
          onChange={() => {}}
          targets={[
            { id: 'review', label: 'Review', ports: ['true', 'false'] },
          ]}
          problems={new Map([['cases.0.assertions.1.port', 'Required']])}
          prefix="cases.0.assertions"
          validityPrefix="case.assertions"
          onValidityChange={() => {}}
        />
      </Specimen>
    </Section>
  );
}
