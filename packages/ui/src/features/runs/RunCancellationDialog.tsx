import {
  Anchor,
  Checkbox,
  Group,
  Stack,
  Text,
  Textarea,
  Modal,
  ModalBody,
  ModalFooter,
  Button,
  ActionError,
} from '../../design-system';

import { useEffect, useRef, useState } from 'react';

import { StatusBadge } from '../../components/StatusBadge/StatusBadge';

import { api, errorMessage } from '../../lib/api';
import { trpc, useQueryClient } from '../../lib/query';
import styles from './RunCancellationDialog.module.css';

type Preview = Awaited<ReturnType<typeof api.runs.previewCancellation.query>>;
const pageSize = 20;

export function RunCancellationDialog({
  runId,
  onClose,
  onCancelled,
  onOpen,
}: {
  runId: string;
  onClose: () => void;
  onCancelled: () => void;
  onOpen: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [includeDetached, setIncludeDetached] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void api.runs.previewCancellation
      .query({ id: runId, includeDetached, offset, limit: pageSize })
      .then(
        (result) => {
          if (current) {
            if (result.offset > 0 && result.offset >= result.total) {
              setOffset(
                Math.floor(Math.max(0, result.total - 1) / pageSize) * pageSize,
              );
              return;
            }
            setPreview(result);
            setLoading(false);
          }
        },
        (failure) => {
          if (current) {
            setPreview(undefined);
            setError(errorMessage(failure));
            setLoading(false);
          }
        },
      );
    return () => {
      current = false;
    };
  }, [runId, includeDetached, offset, reload]);

  const invalidatePreview = () => {
    setPreview(undefined);
    setLoading(true);
    setError('');
  };
  const cancel = async () => {
    if (submitting.current || loading || !preview?.total || !reason.trim())
      return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await api.runs.cancelTree.mutate({
        id: runId,
        includeDetached,
        reason: reason.trim(),
      });
      // Supersede reads that could have captured the tree before cancellation.
      await Promise.all([
        queryClient.cancelQueries(trpc.runs.pathFilter()),
        queryClient.cancelQueries(trpc.work.pathFilter()),
      ]);
      void queryClient.invalidateQueries(trpc.runs.pathFilter());
      void queryClient.invalidateQueries(trpc.work.pathFilter());
      onCancelled();
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setPreview(undefined);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal title="Cancel run tree" onClose={onClose} busy={busy} size={600}>
      <ModalBody>
        <Stack gap="lg">
          <Checkbox
            data-autofocus
            label="Include detached descendants"
            description="Also cancel independent runs started by this tree."
            checked={includeDetached}
            disabled={busy}
            onChange={(event) => {
              invalidatePreview();
              setOffset(0);
              setIncludeDetached(event.currentTarget.checked);
            }}
          />
          <section aria-label="Affected active runs" aria-busy={loading}>
            {loading ? (
              <Text size="sm" role="status">
                Loading affected runs…
              </Text>
            ) : preview ? (
              <Stack gap="sm">
                <Text size="sm" fw={500} role="status">
                  {preview.total === 0
                    ? 'No active runs in this selection.'
                    : `${preview.total} active ${preview.total === 1 ? 'run' : 'runs'} will be cancelled.`}
                </Text>
                {preview.items.length > 0 && (
                  <ul className={styles.runs}>
                    {preview.items.map((run) => (
                      <li key={run.id}>
                        <div className={styles.identity}>
                          <Anchor
                            component="button"
                            type="button"
                            className={styles.runLink}
                            disabled={busy}
                            onClick={() => {
                              onClose();
                              onOpen(run.id);
                            }}
                          >
                            {run.workflowName} · {run.id.slice(0, 8)}
                          </Anchor>
                          {run.parentMode === 'detached' && (
                            <Text size="xs" c="dimmed">
                              Started independently
                            </Text>
                          )}
                        </div>
                        <span className={styles.status}>
                          <StatusBadge status={run.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {preview.total > pageSize && (
                  <Group justify="space-between" gap="sm">
                    <Text size="xs" c="dimmed">
                      {preview.offset + 1}–
                      {preview.offset + preview.items.length} of {preview.total}
                    </Text>
                    <Group gap="xs">
                      <Button
                        disabled={busy || preview.offset === 0}
                        onClick={() => {
                          invalidatePreview();
                          setOffset(Math.max(0, preview.offset - pageSize));
                        }}
                      >
                        Previous runs
                      </Button>
                      <Button
                        disabled={busy || preview.nextOffset === null}
                        onClick={() => {
                          if (preview.nextOffset === null) return;
                          invalidatePreview();
                          setOffset(preview.nextOffset);
                        }}
                      >
                        Next runs
                      </Button>
                    </Group>
                  </Group>
                )}
              </Stack>
            ) : null}
          </section>
          <Textarea
            label="Cancellation reason"
            required
            maxLength={1000}
            minRows={3}
            autosize
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <Text size="sm" c="dimmed">
            Selection is checked again when you cancel. External work may still
            need stop confirmation before its resources can be released.
          </Text>
          <ActionError message={error} />
          {error && (
            <Button
              disabled={busy || loading}
              onClick={() => {
                invalidatePreview();
                setReload((value) => value + 1);
              }}
            >
              Reload affected runs
            </Button>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button disabled={busy} onClick={onClose}>
          Close
        </Button>
        <Button
          variant="danger"
          disabled={busy || loading || !preview?.total || !reason.trim()}
          onClick={() => void cancel()}
        >
          {busy ? 'Cancelling…' : 'Cancel run tree'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
