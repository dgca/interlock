import { Textarea } from '@mantine/core';
import { useState, useEffect, useSyncExternalStore } from 'react';
import { Bot, Copy } from 'lucide-react';
import { Button } from '../../components/Button/Button';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { api, errorMessage } from '../../lib/api';
import type { WorkRequest } from '@interlock/core';
import { manualClaims } from './manualClaims';
export function WorkPanel({
  work,
  onRefresh,
}: {
  work: Omit<WorkRequest, 'token'>;
  onRefresh: () => void;
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
  const [output, setOutput] = useState('{}'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
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
      <p className="hint">
        {work.status === 'available'
          ? work.budgetBlocked
            ? 'Budget blocked. Adjust the governing run budget through MCP or the CLI to resume claims.'
            : 'Waiting for an agent to pick up this assignment.'
          : work.status === 'held'
            ? 'Held for an external blocker. Resume explicitly, then obtain a fresh claim.'
            : work.status === 'claimed'
              ? `Claimed by ${work.workerId}. Lease ends ${new Date(work.leaseUntil!).toLocaleTimeString()}.`
              : work.status === 'timed_out'
                ? 'Nobody claimed this assignment before its deadline. The run followed Timeout with the original input.'
                : `Assignment ${work.status}.`}
      </p>
      {work.hold && (
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
        !work.budgetBlocked &&
        work.availableUntil && (
          <p className="hint">
            Timeout at {new Date(work.availableUntil).toLocaleString()} if
            nobody claims it.
          </p>
        )}
      <div className="actions">
        {work.status === 'held' && (
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
        <Button
          onClick={() =>
            void navigator.clipboard
              .writeText(JSON.stringify(work, null, 2))
              .catch((e) => setError(errorMessage(e)))
          }
        >
          <Copy />
          Copy assignment
        </Button>
      </div>
      <details open>
        <summary>Prompt and context</summary>
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
      {work.status === 'available' &&
        !work.budgetBlocked &&
        work.context.mode === 'current' &&
        !work.context.continuityGroup &&
        !work.context.tools.length &&
        !work.context.skills.length && (
          <Button
            disabled={busy}
            onClick={() =>
              void perform(async () =>
                manualClaims.remember(
                  await api.work.claim.mutate({
                    workId: work.id,
                    workerId: 'manual-ui',
                  }),
                ),
              )
            }
          >
            Claim for manual completion
          </Button>
        )}
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
            styles={{ input: { fontFamily: 'var(--mono)' } }}
            rows={8}
            value={output}
            onChange={(e) => setOutput(e.target.value)}
          />

          <div className="actions">
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
                  manualClaims.forget(work.id);
                })
              }
            >
              Submit result
            </Button>
          </div>
        </>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
