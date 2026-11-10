import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Group,
  NativeSelect,
  Skeleton,
  Textarea,
} from '../../design-system';
import type { MessageReceipt } from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import styles from './ManagedTranscript.module.css';

type Attempt = { id: string; attempt: number; state: string };
export function ManagedTranscript({
  current,
  history,
}: {
  current: Attempt;
  history: Attempt[];
}) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [selected, setSelected] = useState(current.id);
  useEffect(() => {
    setSelected(current.id);
  }, [current.id]);
  return (
    <details
      className={styles.section}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (e.currentTarget.open) setVisited(true);
      }}
    >
      <summary>Transcript</summary>
      {visited && (
        <>
          {history.length > 0 && (
            <NativeSelect
              label="Execution attempt"
              value={selected}
              onChange={(e) => setSelected(e.currentTarget.value)}
              data={[current, ...history].map((a) => ({
                value: a.id,
                label: `Attempt ${a.attempt} · ${a.state}`,
              }))}
            />
          )}
          <Transcript
            key={selected}
            executionId={selected}
            current={selected === current.id}
            opened={open}
          />
        </>
      )}
    </details>
  );
}
function Transcript({
  executionId,
  current,
  opened,
}: {
  executionId: string;
  current: boolean;
  opened: boolean;
}) {
  const [cursor, setCursor] = useState<{ before?: number; after?: number }>({});
  const query = useQuery({
    ...trpc.executors.transcript.queryOptions({
      executionId,
      ...cursor,
      limit: 50,
    }),
    enabled: opened,
    refetchInterval:
      opened &&
      current &&
      cursor.before === undefined &&
      cursor.after === undefined
        ? 5000
        : false,
  });
  const page = query.data,
    error = query.error ? errorMessage(query.error) : '',
    loading = query.isFetching;
  const latest = () => {
    setCursor({});
    if (cursor.before === undefined && cursor.after === undefined)
      void query.refetch();
  };
  return (
    <div className={styles.reader}>
      {error && (
        <div role="alert" className={styles.error}>
          {error}{' '}
          <Button variant="ghost" onClick={() => void query.refetch()}>
            Retry transcript
          </Button>
        </div>
      )}
      {!page && loading && (
        <Skeleton height={100} aria-label="Loading transcript" />
      )}
      {!page && (cursor.before !== undefined || cursor.after !== undefined) && (
        <Button variant="ghost" onClick={latest}>
          Latest
        </Button>
      )}
      {page && (
        <>
          <p className={styles.metadata}>
            {page.capability === 'conversation'
              ? 'Conversation capture'
              : page.capability === 'partial'
                ? 'Partial capture. This harness exposes progress and operator messages.'
                : 'Conversation recording was unavailable for this attempt.'}{' '}
            · {page.retainedEntries} retained entries ·{' '}
            {(page.retainedBytes / 1024).toFixed(1)} KiB
          </p>
          {(page.gap || page.reason) && (
            <p role="status" className={styles.notice}>
              {page.reason ?? 'Older content was removed by transcript limits.'}
              {page.omitted > 0
                ? ` At least ${page.omitted} entries omitted.`
                : ''}
            </p>
          )}
          <Group gap="xs" justify="space-between" className={styles.navigation}>
            <Button
              variant="secondary"
              disabled={!page.older || loading}
              onClick={() => setCursor({ before: page.older! })}
            >
              Older
            </Button>
            <Button variant="ghost" disabled={loading} onClick={latest}>
              Latest
            </Button>
            <Button
              variant="secondary"
              disabled={!page.newer || loading}
              onClick={() => setCursor({ after: page.newer! })}
            >
              Newer
            </Button>
          </Group>
        </>
      )}
      {current && (
        <Composer
          executionId={executionId}
          enabled={page?.messageAvailable ?? false}
          onRecorded={latest}
        />
      )}
      {page && (
        <>
          <ol className={styles.entries} aria-label="Transcript entries">
            {page.items.toReversed().map((entry) => (
              <li key={entry.sequence}>
                <div className={styles.entryHeading}>
                  <strong>
                    {entry.kind.replace('_', ' ')}
                    {entry.tool ? ` · ${entry.tool}` : ''}
                  </strong>
                  <time dateTime={entry.at}>
                    {new Date(entry.at).toLocaleTimeString()}
                  </time>
                </div>
                {entry.kind === 'tool_call' || entry.kind === 'tool_result' ? (
                  <details>
                    <summary>
                      {entry.callId
                        ? `Tool details · ${entry.callId}`
                        : 'Tool details'}
                    </summary>
                    <pre tabIndex={0}>{entry.text}</pre>
                  </details>
                ) : (
                  <pre tabIndex={0}>{entry.text}</pre>
                )}
                {entry.truncated && (
                  <p className={styles.notice}>
                    Truncated
                    {entry.originalBytes
                      ? ` from ${entry.originalBytes.toLocaleString()} bytes`
                      : ''}
                    .
                  </p>
                )}
              </li>
            ))}
          </ol>
          {!page.items.length && (
            <p className={styles.metadata}>
              {page.gap
                ? 'No transcript content remains within the retention policy.'
                : page.capability === 'unavailable'
                  ? 'Existing progress and native session links remain available in execution details.'
                  : 'No messages captured yet.'}
            </p>
          )}
          {(!current || !page.messageAvailable) && (
            <p className={styles.metadata}>
              {current
                ? page.messageReason
                : 'Messages can only be sent to the current active attempt.'}
            </p>
          )}
          <p className={styles.retention}>
            Transcripts retain up to 10 MiB and 2,000 entries per execution
            within a 256 MiB library budget. Entries expire 14 days after
            execution ends. Older content may be removed sooner.
          </p>
        </>
      )}
    </div>
  );
}
function Composer({
  executionId,
  enabled,
  onRecorded,
}: {
  executionId: string;
  enabled: boolean;
  onRecorded: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<MessageReceipt>();
  const [error, setError] = useState('');
  const pending = useRef<{ requestId: string; message: string } | undefined>(
    undefined,
  );
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const acknowledge = (value: MessageReceipt) => {
    if (!alive.current) return;
    setReceipt(value);
    if (value.status === 'accepted') {
      setText('');
      pending.current = undefined;
      onRecorded();
    }
    if (value.status === 'failed') pending.current = undefined;
  };
  const check = async () => {
    const request = pending.current;
    if (!request || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await api.executors.receipt.query({
        executionId,
        requestId: request.requestId,
      });
      if (!alive.current) return;
      if (result.receipt) acknowledge(result.receipt);
      else if (result.receiptsPruned) {
        setError(
          'Delivery receipts for this ended execution were pruned. This request cannot be resent.',
        );
      } else {
        pending.current = undefined;
        setError(
          'The server has no delivery receipt. The message was not dispatched.',
        );
      }
    } catch {
      if (alive.current)
        setError(
          'Delivery status is unavailable. Check again before sending another message.',
        );
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const send = async () => {
    if (!enabled || inFlight.current || pending.current || !text.trim()) return;
    const request = { requestId: crypto.randomUUID(), message: text };
    pending.current = request;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setReceipt(undefined);
    try {
      const value = (await api.executors.manage.mutate({
        action: 'message',
        executionId,
        ...request,
        source: 'ui',
        operator: 'local-user',
      })) as MessageReceipt;
      acknowledge(value);
    } catch {
      if (alive.current)
        setError(
          'Delivery is unconfirmed. Check its status before sending again.',
        );
      // Even a transport error after an accepted send cannot become an automatic resend.
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  if (!enabled && !receipt && !pending.current && !text) return null;
  return (
    <div className={styles.composer}>
      {(enabled || receipt || pending.current || text) && (
        <Textarea
          label="Message agent"
          value={text}
          maxLength={4000}
          minRows={3}
          autosize
          disabled={!enabled || busy || !!pending.current}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {receipt && (
        <p role="status" className={styles.metadata}>
          {receipt.status === 'accepted'
            ? 'Message accepted by the harness.'
            : receipt.status === 'unknown'
              ? 'Delivery is unknown. This request will not be resent.'
              : receipt.status === 'pending'
                ? 'Waiting for delivery confirmation.'
                : (receipt.reason ?? 'Message was not sent.')}
        </p>
      )}
      <Group gap="xs" justify="flex-end">
        {pending.current ? (
          <>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void check()}
            >
              Check delivery
            </Button>
            {receipt?.status === 'unknown' && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  pending.current = undefined;
                  setText('');
                  setReceipt(undefined);
                  setError('');
                }}
              >
                Write another message
              </Button>
            )}
          </>
        ) : (
          enabled && (
            <Button
              variant="primary"
              disabled={busy || !text.trim()}
              onClick={() => void send()}
            >
              {busy ? 'Sending…' : 'Send message'}
            </Button>
          )
        )}
      </Group>
    </div>
  );
}
