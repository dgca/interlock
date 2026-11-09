import { NativeSelect, Textarea } from '@mantine/core';
import { useEffect, useState, useRef } from 'react';
import { Play } from 'lucide-react';
import type {
  Json,
  Workflow,
  WorkflowVersion,
  RunVersionPolicy,
} from '@interlock/core';
import { Modal } from '../../components/Modal/Modal';
import { ModalBody, ModalFooter } from '../../components/Modal/ModalLayout';
import {
  FormPlaceholder,
  LoadingSkeleton,
} from '../../components/LoadingSkeleton/LoadingSkeleton';
import { Button } from '../../components/Button/Button';
import { SchemaInput } from '../../components/SchemaInput/SchemaInput';
import { api, errorMessage } from '../../lib/api';
import { TagFields, tagsFromRows, type TagRow } from './RunTags';
function sample(schema: Record<string, any>): Json {
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (Array.isArray(schema.examples) && schema.examples.length)
    return schema.examples[0];
  if (schema.type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [
        key,
        sample(value as Record<string, any>),
      ]),
    );
  if (schema.type === 'array') return [];
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'null') return null;
  return schema.type === 'string' ? '' : {};
}
export function RunDialog({
  workflow,
  onClose,
  onStarted,
}: {
  workflow: Workflow;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const fieldsRef = useRef<HTMLDivElement>(null);
  const tagsDetailsRef = useRef<HTMLDetailsElement>(null);
  const [raw, setRaw] = useState(false);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [tagsError, setTagsError] = useState('');
  const [versionPolicy, setVersionPolicy] =
    useState<RunVersionPolicy>('pinned');
  const [versions, setVersions] = useState<WorkflowVersion[]>([]),
    [version, setVersion] = useState(workflow.latestVersion),
    [input, setInput] = useState('{}'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api.workflows.versions
      .query({ id: workflow.id })
      .then((v) => {
        const latest = v.at(-1);
        if (!latest) {
          setError('This workflow has no published versions.');
          return;
        }
        setVersions(v);
        setInput(
          JSON.stringify(sample(latest.definition.inputSchema), null, 2),
        );
      })
      .catch((e) => setError(errorMessage(e)));
  }, [workflow.id]);
  const definition = versions.find((v) => v.version === version)?.definition;
  const schema = definition?.inputSchema;
  // Model aliases and diversity candidates can select local profiles at runtime.
  // Only describe connected work when the published definition makes it certain.
  const hasConnectedAgents = definition?.nodes.some(
    (node) =>
      node.kind === 'agent' &&
      (node.executor === null ||
        (!(node.executor ?? definition.executor) &&
          !node.model &&
          !definition.agentModel &&
          !node.candidateModels?.length &&
          !node.distinctProviderFrom?.length)),
  );
  let parsed: Json = null;
  try {
    parsed = JSON.parse(input);
  } catch {}
  const canForm =
    schema?.type === 'object' &&
    Boolean(schema.properties) &&
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed);
  return (
    <Modal title={`Run ${workflow.name}`} onClose={onClose}>
      <ModalBody>
        {versions.length > 0 ? (
          <>
            {hasConnectedAgents && (
              <p className="hint">
                Connected Agent steps wait for an agent to claim their
                assignments. Ask your agent to continue the run when it is
                waiting.
              </p>
            )}

            <NativeSelect
              mb="md"
              label="Published version"
              value={version}
              onChange={(e) => {
                const next = Number(e.target.value);
                setVersion(next);
                setInput(
                  JSON.stringify(
                    sample(
                      versions.find((v) => v.version === next)!.definition
                        .inputSchema,
                    ),
                    null,
                    2,
                  ),
                );
              }}
            >
              {[...versions]
                .sort((a, b) => b.version - a.version)
                .map((v) => (
                  <option key={v.version} value={v.version}>
                    Version {v.version}
                  </option>
                ))}
            </NativeSelect>

            <NativeSelect
              mb="md"
              label="Version policy"
              value={versionPolicy}
              onChange={(event) =>
                setVersionPolicy(event.currentTarget.value as RunVersionPolicy)
              }
              data={[
                { value: 'pinned', label: 'Keep the selected version' },
                {
                  value: 'latest-compatible',
                  label: 'Use newer compatible versions',
                },
              ]}
            />

            {canForm && (
              <div className="actions" style={{ marginBottom: 16 }}>
                <Button variant="ghost" onClick={() => setRaw(!raw)}>
                  {raw ? 'Use input fields' : 'Edit as JSON'}
                </Button>
              </div>
            )}
            <div ref={fieldsRef}>
              {canForm && !raw ? (
                <SchemaInput
                  schema={schema!}
                  value={parsed as Record<string, Json>}
                  onChange={(next) => setInput(JSON.stringify(next, null, 2))}
                />
              ) : (
                <Textarea
                  mb="md"
                  label="Workflow input"
                  aria-label="Workflow input"
                  styles={{ input: { fontFamily: 'var(--mono)' } }}
                  rows={12}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
              )}
              <details ref={tagsDetailsRef} style={{ marginBottom: 16 }}>
                <summary>Tags{tags.length ? ` (${tags.length})` : ''}</summary>
                <div style={{ marginTop: 12 }}>
                  <TagFields
                    rows={tags}
                    onChange={(rows) => {
                      setTags(rows);
                      setTagsError('');
                    }}
                    error={tagsError}
                    showLabel={false}
                  />
                </div>
              </details>
            </div>
            <details>
              <summary>Input contract</summary>
              <pre>{JSON.stringify(schema, null, 2)}</pre>
            </details>
          </>
        ) : (
          !error && (
            <LoadingSkeleton label="Loading workflow versions…">
              <FormPlaceholder />
            </LoadingSkeleton>
          )
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || !schema}
          onClick={async () => {
            let metadata: ReturnType<typeof tagsFromRows>;
            try {
              metadata = tagsFromRows(tags);
              setTagsError('');
            } catch (error) {
              if (tagsDetailsRef.current) tagsDetailsRef.current.open = true;
              setTagsError(errorMessage(error));
              return;
            }
            const invalid =
              fieldsRef.current?.querySelector<HTMLInputElement>(':invalid');
            if (invalid) {
              invalid.closest('details')?.setAttribute('open', '');
              invalid.reportValidity();
              return;
            }
            setError('');
            setBusy(true);
            try {
              const result = await api.runs.start.mutate({
                workflowId: workflow.id,
                version,
                versionPolicy,
                input: JSON.parse(input),
                tags: metadata,
              });
              onStarted(result.run.id);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Play />
          {busy ? 'Starting…' : 'Start run'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
