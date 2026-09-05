import { Textarea } from '@mantine/core';
import { useState, useEffect } from 'react';
import { Bot, Copy } from 'lucide-react';
import { Button } from '../../components/Button/Button';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { api, errorMessage } from '../../lib/api';
import type { WorkRequest } from '@interlock/core';
export function WorkPanel({
  work,
  onRefresh,
}: {
  work: Omit<WorkRequest, 'token'>;
  onRefresh: () => void;
}) {
  const [claim, setClaim] = useState<WorkRequest>(() => {
      try {
        return (
          JSON.parse(sessionStorage.getItem(`claim:${work.id}`) ?? 'null') ??
          undefined
        );
      } catch {
        return undefined;
      }
    }),
    [output, setOutput] = useState('{}'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (claim)
      sessionStorage.setItem(`claim:${work.id}`, JSON.stringify(claim));
  }, [claim, work.id]);
  useEffect(() => {
    if (['completed', 'failed', 'cancelled'].includes(work.status))
      sessionStorage.removeItem(`claim:${work.id}`);
  }, [work.id, work.status]);
  const perform = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onRefresh();
    } catch (e) {
      setError(errorMessage(e));
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
          ? 'Ready for a connected harness to claim.'
          : work.status === 'claimed'
            ? `Claimed by ${work.workerId}. Lease ends ${new Date(work.leaseUntil!).toLocaleTimeString()}.`
            : `Assignment ${work.status}.`}
      </p>
      <div className="actions">
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
        <p className="assignment-prompt">{work.prompt}</p>
        <JsonEditor label="Context policy" value={work.context} rows={6} />
        <JsonEditor label="Assignment input" value={work.input} rows={6} />
        <JsonEditor
          label="Expected output schema"
          value={work.outputSchema}
          rows={6}
        />
      </details>
      {work.status === 'available' &&
        work.context.mode === 'current' &&
        !work.context.tools.length &&
        !work.context.skills.length && (
          <Button
            disabled={busy}
            onClick={() =>
              void perform(async () =>
                setClaim(
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
      {work.status === 'available' &&
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
                void perform(() =>
                  api.work.renew.mutate({
                    workId: work.id,
                    token: claim.token!,
                  }),
                )
              }
            >
              Renew claim
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  api.work.submit.mutate({
                    workId: work.id,
                    token: claim.token!,
                    output: JSON.parse(output),
                  }),
                )
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
