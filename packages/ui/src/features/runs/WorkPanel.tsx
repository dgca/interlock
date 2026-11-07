import { ManagedExecutionPanel } from '../executors/ManagedExecutionPanel';
import { Checkbox, Textarea } from '@mantine/core';
import { Link } from 'react-router';
import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Bot, Copy } from 'lucide-react';
import { Button } from '../../components/Button/Button';
import { ActionError } from '../../components/ActionError/ActionError';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { api, errorMessage } from '../../lib/api';
import type { WorkRequest } from '@interlock/core';
import { manualClaims } from './manualClaims';
export function WorkPanel({
  work,
  onRefresh,
  draft,
  onDraftChange,
}: {
  work: Omit<WorkRequest, 'token'>;
  onRefresh: () => void;
  draft?: string;
  onDraftChange: (value?: string) => void;
}) {
  const stored = useSyncExternalStore(manualClaims.subscribe, () =>
    manualClaims.get(work.id),
  );
  const claim =
    stored &&
    work.status === 'claimed' &&
    stored.attempt === work.attempt &&
    stored.workerId === work.workerId
      ? stored
      : undefined;
  const [stopped, setStopped] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyAssignment = () => {
    setCopied(false);
    void navigator.clipboard
      .writeText(JSON.stringify(work, null, 2))
      .then(() => setCopied(true))
      .catch((e) => setError(errorMessage(e)));
  };
  const hasManagedExecution =
    !!work.executor && !!work.managedExecution?.executionId;
  const managedRecovery = ['interrupted', 'needs_model'].includes(
    work.managedExecution?.state ?? '',
  );
  const uncertain =
    work.resourceReservations?.filter((r) => r.state === 'uncertain') ?? [];
  useEffect(() => {
    setStopped(false);
    setCopied(false);
  }, [work.id, work.attempt]);
  const [entered, setEntered] = useState<{ attempt: number; value: string }>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const output =
    entered?.attempt === work.attempt ? entered.value : (draft ?? '{}');
  const resultInput = useRef<HTMLTextAreaElement>(null);
  const focusResult = useRef(false);
  useEffect(() => {
    if (claim && !busy && focusResult.current) {
      focusResult.current = false;
      resultInput.current?.focus();
    }
  }, [claim, busy]);
  useEffect(() => {
    manualClaims.observe(work);
  }, [work, stored]);
  const perform = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onRefresh();
    } catch (e) {
      setError(errorMessage(e));
      onRefresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="work-panel">
      <div className="section-heading">
        <Bot size={17} />
        <h3>Agent assignment</h3>
      </div>
      {!hasManagedExecution && (
        <p className="hint">
          {work.status === 'available'
            ? work.pauseBlocked
              ? 'Execution paused. Review the applicable pause holds above before claiming.'
              : work.budgetBlocked
                ? 'Budget blocked. Adjust the governing run budget through MCP or the CLI to resume claims.'
                : work.resourceBlocked
                  ? 'Waiting for a shared resource.'
                  : (work.managedExecution?.reason ??
                    (work.executor
                      ? 'Queued for automatic execution.'
                      : 'Waiting for an agent to pick up this assignment.'))
            : work.status === 'held'
              ? 'Held for an external blocker. Resume explicitly, then obtain a fresh claim.'
              : work.status === 'claimed'
                ? `Claimed by ${work.workerId}. Lease ends ${new Date(work.leaseUntil!).toLocaleTimeString()}.`
                : work.status === 'timed_out'
                  ? 'Nobody claimed this assignment before its deadline. The run followed Timeout with the original input.'
                  : `Assignment ${work.status}.`}
        </p>
      )}
      {hasManagedExecution && work.status === 'available' && (
        <p className="hint">
          {work.budgetBlocked
            ? 'Budget blocked. Adjust the governing run budget to resume claims.'
            : (work.managedExecution?.reason ??
              'Queued for automatic execution.')}
        </p>
      )}
      {hasManagedExecution && (
        <ManagedExecutionPanel work={work} onRefresh={onRefresh} />
      )}
      {work.resourceBlocked && (
        <ul style={{ overflowWrap: 'anywhere' }}>
          {work.resourceBlocked.owners.map((owner) => (
            <li key={owner.name}>
              <code>{owner.name}</code> ·{' '}
              <Link to={'/runs/' + owner.runId}>Owning run</Link>
              {owner.state === 'uncertain'
                ? ' · confirmation that the owner stopped is required'
                : ' · in use'}
            </li>
          ))}
        </ul>
      )}
      {uncertain.length > 0 && !managedRecovery && (
        <div>
          <p style={{ overflowWrap: 'anywhere' }}>
            Attempt {uncertain[0].attempt} ended, but these resources remain
            reserved: {uncertain.map((r) => r.name).join(', ')}.
          </p>
          <Checkbox
            label="This attempt and its subprocesses have stopped using these resources"
            checked={stopped}
            onChange={(e) => setStopped(e.currentTarget.checked)}
            mb="sm"
          />
        </div>
      )}
      {work.hold && !managedRecovery && (
        <div style={{ overflowWrap: 'anywhere' }}>
          <p>
            <strong>{work.hold.category.replaceAll('_', ' ')}</strong> · held
            since {new Date(work.hold.heldAt).toLocaleString()}
          </p>
          <p>{work.hold.reason}</p>
          <p>
            Checkpoint: <code>{work.hold.checkpointRef}</code>
          </p>
        </div>
      )}
      {work.holdHistory && work.holdHistory.total > 0 && (
        <details style={{ overflowWrap: 'anywhere' }}>
          <summary>External holds · {work.holdHistory.total}</summary>
          <p className="hint">
            Wall time: {(work.holdHistory.wallMs / 1000).toFixed(1)}s · Declared
            holds: {(work.holdHistory.declaredHeldMs / 1000).toFixed(1)}s · Time
            excluding holds:{' '}
            {(work.holdHistory.elapsedExcludingHoldsMs / 1000).toFixed(1)}s
          </p>
          <ul>
            {work.holdHistory.items.map((hold) => (
              <li key={hold.id}>
                {hold.category.replaceAll('_', ' ')} ·{' '}
                {new Date(hold.heldAt).toLocaleString()} ·{' '}
                {hold.endedAt
                  ? `${hold.endReason} ${new Date(hold.endedAt).toLocaleString()}`
                  : 'Still held'}
              </li>
            ))}
          </ul>
          {work.holdHistory.nextOffset !== null && (
            <p className="hint">
              Older intervals are available through manage_work_hold history or
              the work-hold CLI command.
            </p>
          )}
        </details>
      )}
      {work.status === 'claimed' && work.workerId === 'manual-ui' && !claim && (
        <p className="hint">
          This page does not hold the claim token. Continue in the page that
          claimed this assignment, or wait for the lease to expire. Reclaim it
          only when it becomes available; expiry consumes the configured
          recovery budget and may fail the run.
        </p>
      )}
      {work.status === 'available' &&
        !work.pauseBlocked &&
        !work.budgetBlocked &&
        !work.resourceBlocked &&
        work.availableUntil && (
          <p className="hint">
            Timeout at {new Date(work.availableUntil).toLocaleString()} if
            nobody claims it.
          </p>
        )}
      <div className="actions">
        {uncertain.length > 0 && !managedRecovery && (
          <Button
            variant="primary"
            disabled={busy || !stopped}
            onClick={() =>
              void perform(() =>
                api.work.resources.mutate({
                  action: 'release',
                  workId: work.id,
                  expectedAttempt: uncertain[0].attempt,
                  confirmStopped: true,
                  actor: 'manual-ui',
                }),
              )
            }
          >
            Release resources
          </Button>
        )}
        {work.status === 'held' && !managedRecovery && (
          <Button
            disabled={busy}
            onClick={() =>
              void perform(() =>
                api.work.hold.mutate({
                  action: 'resume',
                  workId: work.id,
                  expectedAttempt: work.attempt,
                  expectedRevision: work.holdRevision ?? 0,
                  actor: 'manual-ui',
                }),
              )
            }
          >
            Resume assignment
          </Button>
        )}
        {!work.executor && (
          <Button onClick={copyAssignment}>
            <Copy />
            {copied ? 'Assignment copied' : 'Copy assignment'}
          </Button>
        )}
        {work.status === 'available' &&
          !work.budgetBlocked &&
          !work.resourceBlocked &&
          work.context.mode === 'current' &&
          !work.context.continuityGroup &&
          !work.context.tools.length &&
          !work.context.skills.length && (
            <Button
              disabled={busy || !!work.pauseBlocked}
              onClick={() =>
                void perform(async () => {
                  const claimed = await api.work.claim.mutate({
                    workId: work.id,
                    workerId: 'manual-ui',
                  });
                  focusResult.current = true;
                  manualClaims.remember(claimed);
                })
              }
            >
              Claim for manual completion
            </Button>
          )}
      </div>
      <details>
        <summary>Prompt and context</summary>
        {work.executor && (
          <Button onClick={copyAssignment}>
            <Copy />
            {copied ? 'Assignment copied' : 'Copy assignment'}
          </Button>
        )}
        {work.executionInstructions && (
          <p className="assignment-prompt">{work.executionInstructions}</p>
        )}
        <p className="assignment-prompt">{work.prompt}</p>
        {!!work.savedPrompts?.length && (
          <ul>
            {work.savedPrompts.map((prompt) => (
              <li key={prompt.id}>
                {prompt.name} · revision {prompt.revision}
              </li>
            ))}
          </ul>
        )}
        <JsonEditor label="Context policy" value={work.context} rows={6} />
        <JsonEditor label="Assignment input" value={work.input} rows={6} />
        <JsonEditor
          label="Expected output schema"
          value={work.outputSchema}
          rows={6}
        />
      </details>
      {work.context.continuityGroup && (
        <p className="hint">
          Continuity group: {work.context.continuityGroup}.{' '}
          {work.continuity?.session
            ? `Expected session: ${work.continuity.session.executorId} / ${work.continuity.session.sessionId}.`
            : 'The first executor claim binds a session.'}{' '}
          The manual UI cannot claim grouped work.
        </p>
      )}
      {work.status === 'available' &&
        !work.context.continuityGroup &&
        (work.context.mode === 'fresh' ||
          work.context.tools.length > 0 ||
          work.context.skills.length > 0) && (
          <p className="hint">
            This assignment needs an executor with the declared capabilities.
            The manual UI cannot claim it.
          </p>
        )}
      {claim && work.status === 'claimed' && (
        <>
          <p className="hint">
            You can navigate within Interlock while keeping this claim.
            Reloading or closing this page loses the token; the lease remains
            active until it expires.
          </p>
          <Textarea
            mb="md"
            label="Result JSON"
            ref={resultInput}
            styles={{ input: { fontFamily: 'var(--mono)' } }}
            rows={8}
            value={output}
            onChange={(e) => {
              const value = e.target.value;
              setEntered({ attempt: work.attempt, value });
              onDraftChange(value);
            }}
          />

          <div className="actions">
            {uncertain.length > 0 && !managedRecovery && (
              <Button
                variant="primary"
                disabled={busy || !stopped}
                onClick={() =>
                  void perform(() =>
                    api.work.resources.mutate({
                      action: 'release',
                      workId: work.id,
                      expectedAttempt: uncertain[0].attempt,
                      confirmStopped: true,
                      actor: 'manual-ui',
                    }),
                  )
                }
              >
                Release resources
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                void perform(async () =>
                  manualClaims.remember(
                    await api.work.renew.mutate({
                      workId: work.id,
                      token: manualClaims.token(work.id),
                    }),
                  ),
                )
              }
            >
              Renew claim
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api.work.submit.mutate({
                    workId: work.id,
                    token: manualClaims.token(work.id),
                    output: JSON.parse(output),
                  });
                  onDraftChange();
                  manualClaims.forget(work.id);
                })
              }
            >
              Submit result
            </Button>
          </div>
        </>
      )}
      <ActionError message={error} />
    </section>
  );
}
