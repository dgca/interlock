import { Alert, Checkbox, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Modal } from '../../components/Modal/Modal';
import { Button } from '../../components/Button/Button';
import { api, errorMessage } from '../../lib/api';
import { paths } from '../../routes/paths';
import styles from './GithubImportDialog.module.css';

type Preview = Awaited<
  ReturnType<typeof api.workflows.discoverGithubFolder.query>
>;
type Outcome = Awaited<
  ReturnType<typeof api.workflows.importGithubSelection.mutate>
>;
export function GithubImportDialog({
  onClose,
  refresh,
}: {
  onClose: () => void;
  refresh: () => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false),
    [importing, setImporting] = useState(false);
  const [error, setError] = useState(''),
    [outcome, setOutcome] = useState<Outcome>();
  const [refreshError, setRefreshError] = useState('');
  const generation = useRef(0),
    input = useRef<HTMLInputElement>(null),
    success = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    input.current?.focus();
    return () => {
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (outcome) success.current?.focus();
  }, [outcome]);
  const invalidate = () => {
    generation.current++;
    setPreview(undefined);
    setSelected([]);
    setLoading(false);
    setError('');
  };
  const load = async () => {
    const id = ++generation.current;
    setPreview(undefined);
    setSelected([]);
    setError('');
    setLoading(true);
    try {
      const result = await api.workflows.discoverGithubFolder.query({ url });
      if (id === generation.current) setPreview(result);
    } catch (e) {
      if (id === generation.current) setError(errorMessage(e));
    } finally {
      if (id === generation.current) setLoading(false);
    }
  };
  const commit = async () => {
    if (!preview || !selected.length || loading || importing) return;
    setImporting(true);
    setError('');
    try {
      const result = await api.workflows.importGithubSelection.mutate({
        previewId: preview.previewId,
        fileIds: selected,
      });
      setOutcome(result);
      try {
        await refresh();
      } catch (e) {
        setRefreshError(
          `Import completed, but the library could not refresh: ${errorMessage(e)}. Reload the page to inspect it.`,
        );
      }
    } catch (e) {
      const message = errorMessage(e);
      // Only the explicit server rollback message establishes that nothing committed.
      setError(
        message.startsWith('Nothing imported:')
          ? message
          : `The import result could not be confirmed. Inspect the library before retrying, especially for legacy files. ${message}`,
      );
    } finally {
      setImporting(false);
    }
  };
  return (
    <Modal
      title="Import from GitHub"
      size={780}
      onClose={onClose}
      closeDisabled={importing}
    >
      <Stack gap="md" className={styles.body}>
        {outcome ? (
          <>
            <h2 ref={success} tabIndex={-1}>
              Import completed
            </h2>
            <Text>
              {outcome.results.filter((r) => r.rootChanged).length} workflows
              changed. {outcome.results.filter((r) => !r.rootChanged).length}{' '}
              unchanged portable workflows.
            </Text>
            <Text size="sm">
              {outcome.changedWorkflowIds.length} workflow records and{' '}
              {outcome.changedPromptIds.length} saved prompts changed, including
              dependencies.
            </Text>
            {outcome.results.map((r) => (
              <Link
                key={r.fileId}
                to={paths.workflow(r.rootId)}
                onClick={onClose}
              >
                {r.filename}
              </Link>
            ))}
            {refreshError && (
              <Alert color="orange" role="alert">
                {refreshError}
              </Alert>
            )}
            <div className={styles.actions}>
              <Button onClick={onClose} disabled={importing}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.source}>
              <TextInput
                ref={input}
                data-autofocus
                label="GitHub folder URL"
                description="Public repository folders only. Includes direct files."
                placeholder="https://github.com/owner/repo/tree/main/workflows"
                value={url}
                disabled={importing}
                onChange={(e) => {
                  invalidate();
                  setUrl(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (url.trim() && !importing) void load();
                  }
                }}
              />
              <Button
                disabled={!url.trim() || importing}
                onClick={() => void load()}
              >
                {error && !preview ? 'Retry' : 'Load workflows'}
              </Button>
            </div>
            <div role="status" aria-live="polite">
              {importing
                ? 'Importing workflows... Import has started. Wait for the result.'
                : loading
                  ? 'Loading workflows...'
                  : preview
                    ? `${preview.choices.length} workflows available. ${selected.length} selected.`
                    : ''}
            </div>
            {loading && <Button onClick={invalidate}>Cancel loading</Button>}
            {preview && (
              <>
                <Text size="sm" className={styles.identity}>
                  {preview.source.owner}/{preview.source.repository} ·{' '}
                  {preview.source.requestedRef}
                  <br />
                  {preview.source.folder} · {preview.source.resolvedCommit}
                </Text>
                {!preview.choices.length && (
                  <div>
                    <Text>No importable workflows found in this folder.</Text>
                    <Text size="sm">
                      Choose another folder. Only direct files are checked.
                    </Text>
                  </div>
                )}
                {preview.choices.map((choice) => (
                  <article key={choice.fileId} className={styles.choice}>
                    <Checkbox
                      checked={selected.includes(choice.fileId)}
                      disabled={importing}
                      aria-label={`${choice.name}, ${choice.filename}`}
                      aria-describedby={`description-${choice.fileId}`}
                      label={choice.name}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked
                            ? [...ids, choice.fileId]
                            : ids.filter((id) => id !== choice.fileId),
                        )
                      }
                    />
                    <div
                      id={`description-${choice.fileId}`}
                      className={styles.description}
                    >
                      {choice.description && (
                        <Text size="sm">{choice.description}</Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {choice.filename}
                      </Text>
                      <Text size="xs">
                        {choice.format === 'legacy'
                          ? 'Creates a new workflow'
                          : `Portable bundle · Includes ${choice.workflows.length} workflow dependencies and ${choice.prompts.length} saved prompts`}
                      </Text>
                    </div>
                    {choice.format === 'portable' && (
                      <details className={styles.description}>
                        <summary>Details for {choice.name}</summary>
                        <Text size="xs">
                          Root {choice.rootId} · Published versions:{' '}
                          {choice.versions.join(', ') || 'none'}
                        </Text>
                        {choice.workflows.map((w) => (
                          <Text key={w.id} size="xs">
                            {w.name} · {w.id} ·{' '}
                            {w.ownerWorkflowId
                              ? `Owned by ${w.ownerWorkflowId}`
                              : 'Library dependency'}{' '}
                            · Versions: {w.versions.join(', ') || 'none'}
                          </Text>
                        ))}
                        {choice.prompts.map((p) => (
                          <Text key={p.id} size="xs">
                            Saved prompt: {p.name} · {p.id}
                          </Text>
                        ))}
                      </details>
                    )}
                  </article>
                ))}
                {!!preview.diagnostics.length && (
                  <details>
                    <summary>
                      Files not available for import (
                      {preview.diagnostics.length})
                    </summary>
                    {preview.diagnostics.map((d) => (
                      <Text key={d.filename} size="sm">
                        {d.filename}: {d.reason}
                      </Text>
                    ))}
                  </details>
                )}
                {!!preview.ignoredCount && (
                  <Text size="xs" c="dimmed">
                    {preview.ignoredCount} unrelated files ignored.
                  </Text>
                )}
              </>
            )}
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            <div className={styles.actions}>
              <Text size="sm">
                {selected.length
                  ? `${selected.length} selected`
                  : 'Select workflows to import'}
              </Text>
              <Button onClick={onClose} disabled={importing}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!preview || !selected.length || loading || importing}
                onClick={() => void commit()}
              >
                Import {selected.length || ''} workflows
              </Button>
            </div>
          </>
        )}
      </Stack>
    </Modal>
  );
}
