import {
  ActionError,
  Anchor,
  Button,
  JsonEditor,
  LoadingSkeleton,
  Modal,
  ModalBody,
  ModalFooter,
  Textarea,
} from '../../design-system';
import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { applyWorkflowEdits, type Workflow } from '@interlock/core';
import type { ProposalConflict } from '@interlock/core/proposals';
import { StatusBadge } from '../../components/StatusBadge/StatusBadge';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import { api } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import type { Action } from '../../lib/useActionFeedback';
import { paths } from '../../routes/paths';
import { compareWorkflow } from '../workflows/workflowDiff';
import { WorkflowDiffList } from '../workflows/WorkflowDiffList';
import { ProposalSimulation } from './ProposalSimulation';
import styles from './Proposals.module.css';

type Proposal = Awaited<ReturnType<typeof api.proposals.get.query>>;

type Applied = {
  applied: boolean;
  diagnostics?: { severity: string; message: string }[];
};
const firstError = (diagnostics: { severity: string; message: string }[]) =>
  diagnostics.find((d) => d.severity === 'error')?.message;

/** Explains a proposal made against an older draft and offers the next step. */
export function ProposalConflictNotice({
  conflict,
  baseDraftRevision,
  pending,
  onReapply,
}: {
  conflict: ProposalConflict;
  baseDraftRevision: number;
  pending?: boolean;
  onReapply?: () => void;
}) {
  if (conflict.state === 'current') return null;
  if (conflict.state === 'reapplicable')
    return (
      <div role="status" className={`${styles.notice} ${styles.attention}`}>
        <p>
          The draft changed since this proposal (revision {baseDraftRevision} →{' '}
          {conflict.draftRevision}). Its edits still apply. Re-apply it to the
          current draft, then review the changes and simulation again.
        </p>
        {onReapply && (
          <Button loading={pending} onClick={onReapply}>
            Re-apply to current draft
          </Button>
        )}
      </div>
    );
  return (
    <div role="alert" className={`${styles.notice} ${styles.conflict}`}>
      <div>
        <p>
          The draft changed since this proposal (revision {baseDraftRevision} →{' '}
          {conflict.draftRevision}) and its edits no longer apply. Reject it and
          ask for a new proposal.
        </p>
        <ul>
          {conflict.diagnostics
            .filter((d) => d.severity === 'error')
            .slice(0, 5)
            .map((d, index) => (
              <li key={index}>{d.message}</li>
            ))}
        </ul>
      </div>
    </div>
  );
}

function Decision({
  proposal,
  workflowId,
}: {
  proposal: Proposal;
  workflowId: string;
}) {
  const { decision } = proposal;
  if (!decision) return null;
  const at = new Date(decision.at).toLocaleString();
  return proposal.status === 'approved' ? (
    <div role="status" className={styles.notice}>
      <p>
        Approved {at} into draft revision {decision.draftRevision}
        {decision.edited ? ', with edited operations' : ''}. Publish from the
        Editor when the draft is ready.
      </p>
      <Button component={Link} to={paths.workflow(workflowId)}>
        Open editor
      </Button>
    </div>
  ) : (
    <div role="status" className={styles.notice}>
      <p>
        Rejected {at}: {decision.reason}
      </p>
    </div>
  );
}

function RejectDialog({
  pending,
  error,
  onClose,
  onReject,
}: {
  pending: boolean;
  error: string;
  onClose: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Reject proposal" busy={pending} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (reason.trim()) onReject(reason.trim());
        }}
      >
        <ModalBody>
          <Textarea
            label="Reason"
            description="The author and later reviewers see this."
            required
            autosize
            minRows={3}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
        </ModalBody>
        <ModalFooter aside={<ActionError message={error} />}>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={pending}
            disabled={!reason.trim()}
          >
            Reject proposal
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** One proposal: rationale, changes against the current draft, simulation and decision. */
export function ProposalView({
  workflow,
  proposalId,
  act,
}: {
  workflow: Workflow;
  proposalId: string;
  act: Action;
}) {
  const query = useQuery(
    trpc.proposals.get.queryOptions(
      { id: proposalId },
      {
        refetchInterval: (q) =>
          q.state.data?.status === 'open' &&
          q.state.data.simulation?.state !== 'completed' &&
          q.state.data.simulation?.state !== 'unavailable'
            ? 1000
            : false,
      },
    ),
  );
  const proposal = query.data;
  const [edits, setEdits] = useState<unknown[]>();
  const [editing, setEditing] = useState(false);
  const [editsValid, setEditsValid] = useState(true);
  const [pending, setPending] = useState<'approve' | 'reject' | 'reapply'>();
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const back = (
    <Anchor
      component={Link}
      to={paths.workflowProposals(workflow.id)}
      className={styles.back}
    >
      <ArrowLeft size={14} aria-hidden="true" /> All proposals
    </Anchor>
  );
  if (!proposal)
    return (
      <div className={styles.content}>
        {back}
        <WorkspaceReadWarning
          inline
          reads={[workspaceRead('proposal', query)]}
        />
        {!query.error && <LoadingSkeleton label="Loading proposal…" />}
      </div>
    );
  const open = proposal.status === 'open';
  const draft = 'draft' in proposal ? proposal.draft : undefined;
  const current = edits ?? proposal.edits;
  const applied = draft ? applyWorkflowEdits(draft, current) : undefined;
  const diff =
    draft && applied?.definition
      ? compareWorkflow(applied.definition, draft)
      : undefined;
  const edited =
    edits !== undefined &&
    JSON.stringify(edits) !== JSON.stringify(proposal.edits);
  const decide = (
    kind: 'approve' | 'reject' | 'reapply',
    call: () => Promise<object>,
    success: string,
  ) => {
    setPending(kind);
    setError('');
    return act(
      async () => {
        const outcome = await call();
        const result =
          'result' in outcome ? (outcome.result as Applied) : undefined;
        if (result && !result.applied)
          throw new Error(
            firstError(result.diagnostics ?? []) ??
              'The edits could not be applied.',
          );
        if (kind !== 'reapply') {
          setEditing(false);
          setEdits(undefined);
        }
        setRejecting(false);
        return outcome;
      },
      success,
      setError,
    ).finally(() => setPending(undefined));
  };
  const author =
    proposal.author.kind === 'agent'
      ? `Agent${proposal.author.workerId ? ` ${proposal.author.workerId}` : ''}`
      : 'Person';
  return (
    <div className={styles.content}>
      {back}
      <WorkspaceReadWarning inline reads={[workspaceRead('proposal', query)]} />
      <div className={styles.heading}>
        <div className={styles.title}>
          <h2>{proposal.title}</h2>
          <p className={styles.meta}>
            <StatusBadge status={proposal.status} />
            <span>{author}</span>
            <time dateTime={proposal.createdAt}>
              {new Date(proposal.createdAt).toLocaleString()}
            </time>
            <span>Draft revision {proposal.baseDraftRevision}</span>
          </p>
        </div>
        {open && (
          <div className={styles.actions}>
            <Button
              variant="ghost"
              color="red"
              disabled={Boolean(pending)}
              onClick={() => {
                setError('');
                setRejecting(true);
              }}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              loading={pending === 'approve'}
              disabled={
                Boolean(pending) ||
                proposal.conflict.state !== 'current' ||
                !editsValid ||
                !applied?.definition
              }
              title={
                proposal.conflict.state !== 'current'
                  ? 'Re-apply the proposal to the current draft first'
                  : undefined
              }
              onClick={() =>
                void decide(
                  'approve',
                  () =>
                    api.proposals.decide.mutate({
                      action: 'approve',
                      id: proposal.id,
                      ...(edited ? { edits: edits as never } : {}),
                    }),
                  'Proposal approved into the draft. Publishing stays a separate step.',
                )
              }
            >
              {edited ? 'Approve edited' : 'Approve'}
            </Button>
          </div>
        )}
      </div>
      {!rejecting && <ActionError message={error} />}
      <Decision proposal={proposal} workflowId={workflow.id} />
      {open && (
        <ProposalConflictNotice
          conflict={proposal.conflict}
          baseDraftRevision={proposal.baseDraftRevision}
          pending={pending === 'reapply'}
          onReapply={() =>
            void decide(
              'reapply',
              () =>
                api.proposals.decide.mutate({
                  action: 'reapply',
                  id: proposal.id,
                }),
              'Proposal moved onto the current draft.',
            )
          }
        />
      )}
      <section className={styles.section} aria-labelledby="proposal-rationale">
        <h3 id="proposal-rationale">Rationale</h3>
        <p className={styles.rationale}>{proposal.rationale}</p>
        {proposal.sources.length > 0 && (
          <ul className={styles.sources} aria-label="Source runs">
            {proposal.sources.map((source) => (
              <li key={`${source.runId}:${source.executionId ?? ''}`}>
                <Anchor
                  component={Link}
                  to={paths.run(source.runId, {
                    workflowId: workflow.id,
                    executionId: source.executionId,
                  })}
                  underline="hover"
                >
                  Run <code>{source.runId.slice(0, 8)}</code>
                  {source.executionId && (
                    <>
                      {' '}
                      · step <code>{source.executionId.slice(0, 8)}</code>
                    </>
                  )}
                </Anchor>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.section} aria-labelledby="proposal-changes">
        <h3 id="proposal-changes">
          {open ? 'Changes to the current draft' : 'Operations'}
        </h3>
        {diff && (
          <WorkflowDiffList
            diff={diff}
            before="Current draft"
            after={edited ? 'Edited proposal' : 'Proposed'}
          />
        )}
        {open && draft && proposal.conflict.state === 'current' && (
          <div className={styles.editor}>
            <div>
              <Button
                variant="ghost"
                aria-expanded={editing}
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? 'Hide operations' : 'Edit before approving'}
              </Button>
              {edited && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEdits(undefined);
                    setEditsValid(true);
                  }}
                >
                  Discard edits
                </Button>
              )}
            </div>
            {editing && (
              <JsonEditor
                label="Operations (edit_workflow edits)"
                rows={14}
                value={current}
                onValidityChange={setEditsValid}
                validate={(value) =>
                  !Array.isArray(value) || !value.length
                    ? 'Enter a list of at least one edit.'
                    : firstError(applyWorkflowEdits(draft, value).diagnostics)
                }
                onChange={(value: unknown[]) => setEdits(value)}
              />
            )}
          </div>
        )}
        {(!open || !diff) && !editing && (
          <JsonEditor
            label={
              proposal.status === 'approved'
                ? 'Applied operations'
                : 'Proposed operations'
            }
            rows={8}
            value={proposal.decision?.edits ?? proposal.edits}
          />
        )}
      </section>
      <section className={styles.section} aria-labelledby="proposal-simulation">
        <h3 id="proposal-simulation">Simulation</h3>
        {open &&
          'draftRevision' in proposal &&
          proposal.simulation &&
          proposal.simulation.state !== 'running' &&
          proposal.simulation.draftRevision !== proposal.draftRevision && (
            <p className={styles.secondary}>
              Simulated against draft revision{' '}
              {proposal.simulation.draftRevision}. Re-apply the proposal to
              simulate the current draft.
            </p>
          )}
        {open || proposal.simulation ? (
          <ProposalSimulation simulation={proposal.simulation} />
        ) : (
          <p className={styles.secondary}>Not simulated.</p>
        )}
      </section>
      {rejecting && (
        <RejectDialog
          pending={pending === 'reject'}
          error={error}
          onClose={() => !pending && setRejecting(false)}
          onReject={(reason) =>
            void decide(
              'reject',
              () =>
                api.proposals.decide.mutate({
                  action: 'reject',
                  id: proposal.id,
                  reason,
                }),
              'Proposal rejected.',
            )
          }
        />
      )}
    </div>
  );
}
