import { useEffect, useRef, useState } from 'react';
import {
  Checkbox,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { Modal } from '../../components/Modal/Modal';
import { Button } from '../../components/Button/Button';
import { api, errorMessage } from '../../lib/api';
import type { Action } from '../../lib/useActionFeedback';

type Preview = Awaited<ReturnType<typeof api.workflows.discoverGithub.query>>;
export function ImportWorkflowDialog({
  onClose,
  onLocalFile,
  act,
}: {
  onClose: () => void;
  onLocalFile: () => void;
  act: Action;
}) {
  const [source, setSource] = useState('github');
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const importing = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const reset = () => {
    generation.current++;
    setPreview(undefined);
    setSelected([]);
    setError('');
    setLoading(false);
  };
  const discover = async () => {
    const current = ++generation.current;
    setPreview(undefined);
    setSelected([]);
    setError('');
    setLoading(true);
    try {
      const result = await api.workflows.discoverGithub.query({
        url: url.trim(),
      });
      if (generation.current === current) setPreview(result);
    } catch (error) {
      if (generation.current === current) setError(errorMessage(error));
    } finally {
      if (generation.current === current) setLoading(false);
    }
  };
  const importSelected = async () => {
    if (!preview || !selected.length || importing.current || loading) return;
    importing.current = true;
    setBusy(true);
    setError('');
    try {
      await act(async () => {
        try {
          await api.workflows.importGithub.mutate({
            source: preview.source,
            files: selected,
          });
        } catch (error) {
          setError(errorMessage(error));
          throw error;
        }
        onClose();
      }, 'Selected workflows imported.');
    } finally {
      importing.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Import workflows"
      size={700}
      onClose={() => {
        if (!importing.current) {
          generation.current++;
          onClose();
        }
      }}
    >
      <Stack gap="md">
        <SegmentedControl
          aria-label="Import source"
          value={source}
          disabled={busy}
          data={[
            { value: 'github', label: 'GitHub folder' },
            { value: 'local', label: 'Local file' },
          ]}
          onChange={(value) => {
            reset();
            setSource(value);
          }}
        />
        {source === 'local' ? (
          <>
            <Text size="sm">
              Choose a legacy workflow JSON file or a portable bundle with its
              dependencies.
            </Text>
            <div className="actions">
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={onLocalFile}>
                Choose JSON file
              </Button>
            </div>
          </>
        ) : (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!loading && !busy && url.trim()) void discover();
              }}
            >
              <Stack gap="sm">
                <TextInput
                  data-autofocus
                  label="Public GitHub folder URL"
                  placeholder="https://github.com/owner/repo/tree/branch/folder"
                  value={url}
                  disabled={busy}
                  onChange={(event) => {
                    reset();
                    setUrl(event.currentTarget.value);
                  }}
                />
                <div className="actions">
                  <Button
                    disabled={busy || loading || !url.trim()}
                    type="submit"
                  >
                    {loading
                      ? 'Loading workflows…'
                      : error && !preview
                        ? 'Retry discovery'
                        : 'Find workflows'}
                  </Button>
                </div>
              </Stack>
            </form>
            {error && (
              <Text role="alert" c="red" size="sm">
                {error}
              </Text>
            )}
            {loading && (
              <Text role="status" size="sm">
                Reading direct JSON files from GitHub…
              </Text>
            )}
            {preview && (
              <>
                <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
                  Commit {preview.source.commit.slice(0, 12)} ·{' '}
                  {preview.source.folder}
                </Text>
                {!preview.items.some((item) => item.valid) && (
                  <Text role="status">
                    No importable workflows were found in this folder's direct
                    JSON files.
                  </Text>
                )}
                <Stack gap="sm">
                  {preview.items.map((item) => (
                    <div
                      key={item.file}
                      style={{
                        border: '1px solid var(--mantine-color-dark-4)',
                        borderRadius: 6,
                        padding: 12,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {item.valid ? (
                        <>
                          <Checkbox
                            disabled={busy}
                            label={item.name}
                            checked={selected.includes(item.file)}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked;
                              setSelected((current) =>
                                checked
                                  ? [...current, item.file]
                                  : current.filter(
                                      (file) => file !== item.file,
                                    ),
                              );
                            }}
                          />
                          {item.description && (
                            <Text size="sm" mt={8}>
                              {item.description}
                            </Text>
                          )}
                          <Text size="xs" c="dimmed" mt={6}>
                            {item.file}
                          </Text>
                          <Text size="xs" mt={6}>
                            {item.workflows.length} workflow{' '}
                            {item.workflows.length === 1
                              ? 'dependency'
                              : 'dependencies'}{' '}
                            · {item.prompts.length} saved{' '}
                            {item.prompts.length === 1 ? 'prompt' : 'prompts'}
                          </Text>
                          {item.workflows.map((w) => (
                            <Text key={w.id} size="xs">
                              {w.name}
                              {w.owned ? ' (owned child)' : ''} · {w.id}
                            </Text>
                          ))}
                          {item.prompts.map((p) => (
                            <Text key={p.id} size="xs">
                              Saved prompt: {p.name} · {p.id}
                            </Text>
                          ))}
                        </>
                      ) : (
                        <>
                          <Text size="sm">{item.file}</Text>
                          <details>
                            <summary>Cannot import this file</summary>
                            <Text
                              size="xs"
                              c="dimmed"
                              style={{ whiteSpace: 'pre-wrap' }}
                            >
                              {item.error}
                            </Text>
                          </details>
                        </>
                      )}
                    </div>
                  ))}
                </Stack>
                {preview.items.some((item) => item.valid) && (
                  <Text size="sm">
                    {selected.length} selected. Bundles include their
                    dependencies. A conflict rejects the whole selection.
                  </Text>
                )}
              </>
            )}
            <div className="actions">
              <Button
                disabled={busy}
                onClick={() => {
                  generation.current++;
                  onClose();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy || loading || !preview || !selected.length}
                onClick={() => void importSelected()}
              >
                {busy ? 'Importing…' : 'Import selected'}
              </Button>
            </div>
          </>
        )}
      </Stack>
    </Modal>
  );
}
