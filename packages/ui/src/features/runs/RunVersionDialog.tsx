import {
  Checkbox,
  Divider,
  Group,
  NativeSelect,
  Stack,
  Text,
  Textarea,
  Modal,
  ModalBody,
  ModalFooter,
  Button,
  ActionError,
} from '../../design-system';

import { useEffect, useState } from 'react';

import type { RunVersionPolicy } from '@interlock/core';

import styles from './RunForms.module.css';
import { api, errorMessage } from '../../lib/api';

type VersionState = Awaited<ReturnType<typeof api.runs.versionPolicy.query>>;
type Preview = Awaited<ReturnType<typeof api.runs.previewVersionMove.query>>;

export function RunVersionDialog({
  runId,
  workflowId,
  active,
  onClose,
  onChanged,
  returnFocusTo,
}: {
  runId: string;
  workflowId: string;
  active: boolean;
  onClose: () => void;
  onChanged: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const [data, setData] = useState<VersionState>();
  const [versions, setVersions] = useState<number[]>([]);
  const [policy, setPolicy] = useState<RunVersionPolicy>('pinned');
  const [version, setVersion] = useState('');
  const [recapturePrompts, setRecapturePrompts] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setError('');
    void Promise.all([
      api.runs.versionPolicy.query({ runId, offset, limit: 20 }),
      api.workflows.versions.query({ id: workflowId }),
    ]).then(
      ([state, published]) => {
        if (!current) return;
        setData(state);
        setPolicy(state.policy);
        setVersions(published.map((entry) => entry.version));
      },
      (e) => {
        if (current) setError(errorMessage(e));
      },
    );
    return () => {
      current = false;
    };
  }, [runId, workflowId, offset, reload]);
  const perform = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (e) {
      setPreview(undefined);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const newer = versions.filter((entry) => entry > (data?.version ?? 0));
  return (
    <Modal
      title="Run version"
      onClose={onClose}
      busy={busy}
      size={600}
      returnFocusTo={returnFocusTo}
    >
      <ModalBody>
        <Stack gap="lg">
          {data ? (
            <>
              <Stack gap="sm">
                <Text size="sm">Bound to version {data.version}</Text>
                <NativeSelect
                  data-autofocus
                  label="Version policy"
                  value={policy}
                  disabled={busy || !active}
                  onChange={(event) => {
                    setPolicy(event.currentTarget.value as RunVersionPolicy);
                    setPreview(undefined);
                    setNotice('');
                  }}
                  data={[
                    { value: 'pinned', label: 'Keep the current version' },
                    {
                      value: 'latest-compatible',
                      label: 'Use newer compatible versions',
                    },
                  ]}
                />
                <Text size="sm" c="dimmed">
                  Available assignments and steps already executing finish on
                  their captured version. Policy changes affect future steps.
                </Text>
                <Group justify="flex-end">
                  <Button
                    disabled={busy || !active || policy === data.policy}
                    onClick={() =>
                      void perform(async () => {
                        const next = await api.runs.setVersionPolicy.mutate({
                          runId,
                          expectedRevision: data.revision,
                          policy,
                        });
                        setData(next);
                        setPreview(undefined);
                        setNotice('Version policy saved.');
                        onChanged();
                      })
                    }
                  >
                    Save policy
                  </Button>
                </Group>
                {data.blocker && (
                  <div role="status">
                    <Text size="sm" fw={500}>
                      Version {data.blocker.version} was skipped at{' '}
                      {data.blocker.nodeId}
                    </Text>
                    <ul>
                      {data.blocker.reasons.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Stack>
              {active && (
                <>
                  <Divider className={styles.divider} />
                  <Stack gap="sm">
                    <NativeSelect
                      label="Move to a published version"
                      value={version}
                      disabled={busy || !newer.length}
                      onChange={(event) => {
                        setVersion(event.currentTarget.value);
                        setPreview(undefined);
                        setNotice('');
                      }}
                    >
                      <option value="">
                        {newer.length
                          ? 'Choose a newer version'
                          : 'No newer published version'}
                      </option>
                      {[...newer].reverse().map((entry) => (
                        <option key={entry} value={entry}>
                          Version {entry}
                        </option>
                      ))}
                    </NativeSelect>
                    <Checkbox
                      label="Recapture saved prompts from the target version"
                      description="Uses published prompt pins when configured, otherwise current revisions. Leave off to preserve this run's prompt capture."
                      checked={recapturePrompts}
                      disabled={busy}
                      onChange={(event) => {
                        setRecapturePrompts(event.currentTarget.checked);
                        setPreview(undefined);
                        setNotice('');
                      }}
                    />
                    <Group justify="flex-end">
                      <Button
                        disabled={busy || !version}
                        onClick={() =>
                          void perform(async () => {
                            setPreview(
                              await api.runs.previewVersionMove.query({
                                runId,
                                version: Number(version),
                                recapturePrompts,
                              }),
                            );
                          })
                        }
                      >
                        Preview move
                      </Button>
                    </Group>
                    {preview && (
                      <div role="status">
                        <Text size="sm" fw={500}>
                          Version {preview.fromVersion} to {preview.toVersion}{' '}
                          at {preview.nodeId}
                        </Text>
                        {preview.blockers.length ? (
                          <ul>
                            {preview.blockers.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <Text size="sm">Compatible at this boundary.</Text>
                        )}
                      </div>
                    )}
                    {preview?.canApply && (
                      <>
                        <Textarea
                          label="Reason for this move"
                          value={reason}
                          maxLength={1000}
                          autosize
                          minRows={2}
                          disabled={busy}
                          onChange={(event) =>
                            setReason(event.currentTarget.value)
                          }
                        />
                        <Group justify="flex-end">
                          <Button
                            variant="primary"
                            disabled={busy || !reason.trim()}
                            onClick={() =>
                              void perform(async () => {
                                const next =
                                  await api.runs.applyVersionMove.mutate({
                                    runId,
                                    version: preview.toVersion,
                                    recapturePrompts,
                                    confirmation: preview.confirmation,
                                    reason: reason.trim(),
                                  });
                                setData(next);
                                setVersion('');
                                setPreview(undefined);
                                setReason('');
                                setOffset(0);
                                setNotice('Run version changed.');
                                onChanged();
                              })
                            }
                          >
                            Apply version {preview.toVersion}
                          </Button>
                        </Group>
                      </>
                    )}
                  </Stack>
                </>
              )}
              <Divider className={styles.divider} />
              <Stack gap="sm">
                <Text fw={500} size="sm">
                  Version changes · {data.history.total}
                </Text>
                {data.history.items.length ? (
                  data.history.items.map((item, index) => (
                    <div key={`${item.at}-${offset + index}`}>
                      <Text size="sm" fw={500}>
                        Version {item.fromVersion} to {item.toVersion}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {new Date(item.at).toLocaleString()}
                        {item.recapturePrompts ? ' · Prompts recaptured' : ''}
                      </Text>
                      <Text size="sm">{item.reason}</Text>
                    </div>
                  ))
                ) : (
                  <Text size="sm" c="dimmed">
                    This run has not changed versions.
                  </Text>
                )}
                {data.history.total > 20 && (
                  <Group justify="space-between">
                    <Button
                      disabled={busy || offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 20))}
                    >
                      Previous changes
                    </Button>
                    <Button
                      disabled={
                        busy ||
                        offset + data.history.items.length >= data.history.total
                      }
                      onClick={() => setOffset(offset + 20)}
                    >
                      Next changes
                    </Button>
                  </Group>
                )}
              </Stack>
            </>
          ) : (
            !error && <Text role="status">Loading run version…</Text>
          )}
          {notice && <Text role="status">{notice}</Text>}
          <ActionError message={error} />
          {error && (
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(undefined);
                setReload((value) => value + 1);
              }}
            >
              Reload run version
            </Button>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button disabled={busy} onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}
