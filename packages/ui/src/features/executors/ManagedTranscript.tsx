import { useEffect, useRef, useState } from 'react';
import { Button, Group, Skeleton, Textarea } from '../../design-system';
import { ChevronRight } from 'lucide-react';
import type { MessageReceipt } from '@interlock/core';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import styles from './ManagedTranscript.module.css';

export function ManagedTranscript({
  executionId,
  current,
  opened = true,
}: {
  executionId: string;
  current: boolean;
  opened?: boolean;
}) {
  const [cursor, setCursor] = useState<{ before?: number; after?: number }>({});
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(true);
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
    loading = query.isFetching;
  const latest = () => {
    following.current = true;
    setCursor({});
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    if (cursor.before === undefined && cursor.after === undefined)
      void query.refetch();
  };
  useEffect(() => {
    const region = scroll.current;
    if (!region) return;
    const observer = new ResizeObserver(() => {
      if (following.current) region.scrollTop = region.scrollHeight;
    });
    observer.observe(region);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!opened || !scroll.current || !page) return;
    if (cursor.before !== undefined) scroll.current.scrollTop = 0;
    else if (following.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [page, opened, cursor]);
  return (
    <div className={styles.conversation}>
      <div
        className={styles.scroll}
        ref={scroll}
        role="region"
        aria-label="Conversation messages"
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget;
          following.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {query.error && (
          <div role="alert" className={styles.error}>
            {errorMessage(query.error)}{' '}
            <Button variant="ghost" onClick={() => void query.refetch()}>
              Retry transcript
            </Button>
          </div>
        )}
        {!page && loading && (
          <Skeleton height={100} aria-label="Loading transcript" />
        )}
        {!page &&
          (cursor.before !== undefined || cursor.after !== undefined) && (
            <Button variant="ghost" onClick={latest}>
              Latest
            </Button>
          )}
        {page && (
          <>
            {(page.gap || page.reason) && (
              <p role="status" className={styles.notice}>
                {page.reason ??
                  'Older content was removed by transcript limits.'}
                {page.omitted > 0
                  ? ` At least ${page.omitted} entries omitted.`
                  : ''}
              </p>
            )}
            {(page.older !== null ||
              page.newer !== null ||
              cursor.before !== undefined ||
              cursor.after !== undefined) && (
              <Group
                gap="xs"
                justify="space-between"
                className={styles.navigation}
              >
                <Button
                  variant="ghost"
                  disabled={!page.older || loading}
                  onClick={() => {
                    following.current = false;
                    setCursor({ before: page.older! });
                  }}
                >
                  Older
                </Button>
                <Button variant="ghost" disabled={loading} onClick={latest}>
                  Latest
                </Button>
                <Button
                  variant="ghost"
                  disabled={!page.newer || loading}
                  onClick={() => {
                    following.current = true;
                    setCursor({ after: page.newer! });
                  }}
                >
                  Newer
                </Button>
              </Group>
            )}
            <ol className={styles.entries} aria-label="Transcript entries">
              {page.items.map((entry) => (
                <li key={entry.sequence} data-kind={entry.kind}>
                  {entry.kind === 'tool_call' ||
                  entry.kind === 'tool_result' ? (
                    <details className={styles.tool}>
                      <summary>
                        <ChevronRight
                          className={styles.toolChevron}
                          size={14}
                          aria-hidden="true"
                        />
                        <span className={styles.toolName}>
                          {entry.tool ?? 'Tool'}
                          <span>
                            {entry.kind === 'tool_call' ? 'Call' : 'Result'}
                          </span>
                        </span>
                        <time dateTime={entry.at}>
                          {new Date(entry.at).toLocaleTimeString()}
                        </time>
                      </summary>
                      {entry.callId && (
                        <p className={styles.metadata}>Call {entry.callId}</p>
                      )}
                      <pre tabIndex={0}>{entry.text}</pre>
                    </details>
                  ) : (
                    <>
                      <div className={styles.entryHeading}>
                        <strong>
                          {entry.kind === 'assistant'
                            ? 'Assistant'
                            : entry.kind === 'operator'
                              ? 'You'
                              : entry.kind === 'user'
                                ? 'User'
                                : 'Activity'}
                        </strong>
                        <time dateTime={entry.at}>
                          {new Date(entry.at).toLocaleTimeString()}
                        </time>
                      </div>
                      <div className={styles.message}>{entry.text}</div>
                    </>
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
              <p className={styles.empty}>
                {page.gap
                  ? 'No transcript content remains within the retention policy.'
                  : page.capability === 'unavailable'
                    ? 'Conversation recording was unavailable for this attempt. Session links and progress are in Details.'
                    : 'Waiting for the agent’s first message…'}
              </p>
            )}
            {(!current || !page.messageAvailable) && (
              <p className={styles.metadata}>
                {current
                  ? page.messageReason
                  : 'Messages can only be sent to the current active attempt.'}
              </p>
            )}
          </>
        )}
      </div>
      {current && (
        <Composer
          executionId={executionId}
          enabled={page?.messageAvailable ?? false}
          onRecorded={latest}
        />
      )}
    </div>
  );
}

export function TranscriptRecordingDetails({
  executionId,
  opened,
}: {
  executionId: string;
  opened: boolean;
}) {
  const query = useQuery({
    ...trpc.executors.transcript.queryOptions({ executionId, limit: 50 }),
    enabled: opened,
  });
  const page = query.data;
  return (
    <section className={styles.recording} aria-label="Transcript storage">
      <h3>Transcript storage</h3>
      {query.error && (
        <p role="alert" className={styles.error}>
          {errorMessage(query.error)}
        </p>
      )}
      {page && (
        <p className={styles.metadata}>
          {page.capability === 'conversation'
            ? 'Conversation capture'
            : page.capability === 'partial'
              ? 'Partial capture'
              : 'Recording unavailable'}{' '}
          · {page.retainedEntries.toLocaleString()} retained entries ·{' '}
          {(page.retainedBytes / 1024).toFixed(1)} KiB
        </p>
      )}
      <p className={styles.metadata}>
        Up to 2,000 entries and 10 MiB per execution, within a 256 MiB library
        budget. Entries expire 14 days after execution ends. Older content may
        be removed sooner.
      </p>
    </section>
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
          minRows={2}
          maxRows={5}
          placeholder="Send guidance to this agent…"
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
