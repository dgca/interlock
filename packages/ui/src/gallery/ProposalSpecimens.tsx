import { blankDefinition } from '@interlock/core';
import { ProposalSimulation } from '../features/proposals/ProposalSimulation';
import { ProposalConflictNotice } from '../features/proposals/ProposalView';
import { compareWorkflow } from '../features/workflows/workflowDiff';
import { WorkflowDiffList } from '../features/workflows/WorkflowDiffList';
import { Section, Specimen } from './GalleryLayout';

const before = blankDefinition();
const after = {
  ...before,
  nodes: before.nodes.map((node) =>
    node.kind === 'agent'
      ? {
          ...node,
          prompt: `${node.prompt} Add a changelog entry for user-visible changes.`,
        }
      : node,
  ),
};
const coverage = (coveredEdges: number) => ({ coveredEdges, totalEdges: 4 });

export function Proposals() {
  return (
    <Section id="proposals" title="Workflow proposals">
      <Specimen name="WorkflowDiffList" wide>
        <WorkflowDiffList
          diff={compareWorkflow(after, before)}
          before="Current draft"
          after="Proposed"
        />
      </Specimen>
      <Specimen name="ProposalSimulation with a failing case" wide>
        <ProposalSimulation
          simulation={{
            state: 'completed',
            draftRevision: 4,
            omittedCases: 0,
            finishedAt: '2026-03-02T10:15:00Z',
            coverage: { before: coverage(4), after: coverage(3) },
            cases: [
              {
                suiteId: 'suite',
                suiteName: 'Release checks',
                caseId: 'happy',
                caseName: 'Accepts a change with a changelog entry',
                before: 'passed',
                after: 'passed',
              },
              {
                suiteId: 'suite',
                suiteName: 'Release checks',
                caseId: 'score',
                caseName: 'Routes a low score to review',
                before: 'passed',
                after: 'failed',
                error:
                  'Fixture 1: expected agent node review; received script node lint',
              },
            ],
          }}
        />
      </Specimen>
      <Specimen name="ProposalSimulation unavailable and running">
        <ProposalSimulation
          simulation={{
            state: 'unavailable',
            draftRevision: 4,
            reason: 'This workflow has no saved test suite.',
            finishedAt: '2026-03-02T10:15:00Z',
          }}
        />
        <ProposalSimulation
          simulation={{
            state: 'running',
            draftRevision: 4,
            startedAt: '2026-03-02T10:15:00Z',
          }}
        />
      </Specimen>
      <Specimen name="ProposalConflictNotice" wide>
        <ProposalConflictNotice
          conflict={{ state: 'reapplicable', draftRevision: 6 }}
          baseDraftRevision={4}
          onReapply={() => {}}
        />
        <ProposalConflictNotice
          conflict={{
            state: 'conflicting',
            draftRevision: 6,
            diagnostics: [
              {
                severity: 'error',
                category: 'save',
                code: 'invalid_edit',
                path: 'edits.0',
                message: 'Node not found: review',
              },
            ],
          }}
          baseDraftRevision={4}
        />
      </Specimen>
    </Section>
  );
}
