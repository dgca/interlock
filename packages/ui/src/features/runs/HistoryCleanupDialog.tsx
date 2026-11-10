import {
  Alert,
  Button,
  Checkbox,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Modal,
  ModalBody,
  ModalFooter,
} from '../../design-system';

import { useEffect, useRef, useState } from 'react';

import { api, errorMessage } from '../../lib/api';
import type { Action } from '../../lib/useActionFeedback';
import styles from './HistoryCleanupDialog.module.css';

type Preview = Awaited<
  ReturnType<typeof api.runs.previewHistoryDeletion.query>
>;
type Removed = Awaited<ReturnType<typeof api.runs.deleteHistory.mutate>>;
const bytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KiB`
      : `${(size / 1024 / 1024).toFixed(1)} MiB`;

export function HistoryCleanupDialog({
  workflowId,
  workflows,
  act,
  onClose,
}: {
  workflowId?: string;
  workflows: { value: string; label: string }[];
  act: Action;
  onClose: () => void;
}) {
  const [workflow, setWorkflow] = useState<string | null>(workflowId ?? null);
  const [before, setBefore] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [removed, setRemoved] = useState<Removed>();
  const [selected, setSelected] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const invalidate = () => {
    generation.current++;
    setPreview(undefined);
    setSelected([]);
    setAcknowledged(false);
    setRemoved(undefined);
    setError('');
  };
  const load = async (offset = 0) => {
    const request = ++generation.current;
    setBusy(true);
    setError('');
    setSelected([]);
    setAcknowledged(false);
    setRemoved(undefined);
    try {
      const result = await api.runs.previewHistoryDeletion.query({
        workflowId: workflow ?? undefined,
        before: before ? new Date(before).toISOString() : undefined,
        offset,
        limit: 20,
      });
      if (request === generation.current) setPreview(result);
    } catch (e) {
      if (request === generation.current) {
        setPreview(undefined);
        setError(errorMessage(e));
      }
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const remove = async () => {
    if (!preview || !acknowledged || !selected.length) return;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    await act(
      async () => {
        const result = await api.runs.deleteHistory.mutate({
          roots: preview.items
            .filter((item) => selected.includes(item.rootRunId))
            .map((item) => ({
              runId: item.rootRunId,
              confirmation: item.confirmation!,
            })),
          acknowledgeHistoryLoss: true,
        });
        if (request === generation.current) {
          setRemoved(result);
          setPreview(undefined);
          setSelected([]);
          setAcknowledged(false);
        }
        return result;
      },
      undefined,
      (message) => {
        if (request === generation.current) {
          setError(message);
          setPreview(undefined);
          setSelected([]);
        }
      },
    );
    if (request === generation.current) setBusy(false);
  };
  return (
    <Modal onClose={onClose} title="Clean up run history" size="xl" busy={busy}>
      <ModalBody>
        <Stack>
          <Text size="sm">
            Remove selected run trees and their values, assignments, usage, and
            audit history. Workflows and published versions remain.
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Root workflow"
              placeholder="All workflows"
              clearable
              data={workflows}
              value={workflow}
              disabled={busy || Boolean(workflowId)}
              onChange={(value) => {
                invalidate();
                setWorkflow(value);
              }}
            />
            <TextInput
              label="Last updated before"
              type="datetime-local"
              value={before}
              disabled={busy}
              onChange={(event) => {
                invalidate();
                setBefore(event.currentTarget.value);
              }}
            />
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            Filters apply to whole trees, including detached descendants and
            rollover chains. Protected history cannot be selected.
          </Text>
          <Group>
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void load()}
            >
              Preview history
            </Button>
          </Group>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          {preview && (
            <>
              <Text size="sm">
                Showing {preview.items.length ? preview.offset + 1 : 0}–
                {preview.offset + preview.items.length} of {preview.total}{' '}
                trees. {selected.length} selected.
              </Text>
              {preview.items.length ? (
                <Table
                  className={styles.table}
                  role="table"
                  verticalSpacing="sm"
                >
                  <Table.Thead role="rowgroup">
                    <Table.Tr role="row">
                      <Table.Th role="columnheader">Select</Table.Th>
                      <Table.Th role="columnheader">Run tree</Table.Th>
                      <Table.Th role="columnheader">Last updated</Table.Th>
                      <Table.Th role="columnheader">Runs</Table.Th>
                      <Table.Th role="columnheader">JSON data</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody role="rowgroup">
                    {preview.items.map((item) => (
                      <Table.Tr role="row" key={item.rootRunId}>
                        <Table.Td role="cell">
                          <Checkbox
                            aria-label={`Select run tree ${item.rootRunId}`}
                            disabled={!item.canDelete || busy}
                            checked={selected.includes(item.rootRunId)}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setAcknowledged(false);
                              setSelected((ids) =>
                                checked
                                  ? [...ids, item.rootRunId]
                                  : ids.filter((id) => id !== item.rootRunId),
                              );
                            }}
                          />
                        </Table.Td>
                        <Table.Td role="cell">
                          <Text size="sm" fw={500}>
                            {item.workflowName}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {item.rootRunId.slice(0, 8)} · {item.status}
                          </Text>
                          {item.blockers.map((reason) => (
                            <Text size="xs" key={reason}>
                              {reason}
                            </Text>
                          ))}
                        </Table.Td>
                        <Table.Td role="cell">
                          <Text size="xs">
                            <span
                              className={styles.mobileLabel}
                              aria-hidden="true"
                            >
                              Last updated ·{' '}
                            </span>
                            {new Date(item.updatedAt).toLocaleString()}
                          </Text>
                        </Table.Td>
                        <Table.Td role="cell">
                          <span
                            className={styles.mobileLabel}
                            aria-hidden="true"
                          >
                            Runs ·{' '}
                          </span>
                          {item.runCount}
                        </Table.Td>
                        <Table.Td role="cell">
                          <span
                            className={styles.mobileLabel}
                            aria-hidden="true"
                          >
                            JSON data ·{' '}
                          </span>
                          {bytes(item.documentBytes)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <Text size="sm">No run trees match these filters.</Text>
              )}
              {(preview.offset > 0 || preview.nextOffset !== null) && (
                <Group>
                  <Button
                    variant="ghost"
                    disabled={busy || preview.offset === 0}
                    onClick={() => void load(Math.max(0, preview.offset - 20))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy || preview.nextOffset === null}
                    onClick={() => void load(preview.nextOffset!)}
                  >
                    Next
                  </Button>
                </Group>
              )}
              <Checkbox
                label="I understand that deleting the selected history is permanent."
                checked={acknowledged}
                disabled={busy || !selected.length}
                onChange={(event) =>
                  setAcknowledged(event.currentTarget.checked)
                }
              />
              <Text size="xs" c="dimmed">
                Deleted space becomes reusable inside SQLite. The database file
                may need offline compaction to shrink. Start-request tombstones
                remain; backups, native harness files and trial files are
                separate.
              </Text>
            </>
          )}
          {removed && (
            <Alert color="green" title="History removed" role="status">
              <Text size="sm">
                Deleted {removed.deletedRuns} runs from {removed.deletedRoots}{' '}
                trees and {bytes(removed.removedDocumentBytes)} of JSON data.
              </Text>
              <Text size="sm">
                Database allocation: {bytes(removed.storage.databaseBytes)}.
                Reusable pages: {bytes(removed.storage.reusableBytes)}. File
                size may not shrink until offline compaction. Workflows,
                versions, and {removed.retainedStartReceipts} start-request
                tombstones remain.
              </Text>
            </Alert>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {removed ? 'Done' : 'Cancel'}
        </Button>
        {preview && (
          <Button
            variant="danger"
            disabled={busy || !acknowledged || !selected.length}
            loading={busy}
            onClick={() => void remove()}
          >
            Delete selected history
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
