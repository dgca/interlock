import { NativeSelect, Textarea } from '@mantine/core';
import { useEffect, useState, useRef } from 'react';
import { Play } from 'lucide-react';
import type { Json, Workflow, WorkflowVersion } from '@interlock/core';
import { Modal } from '../../components/Modal/Modal';
import { Button } from '../../components/Button/Button';
import { SchemaInput } from '../../components/SchemaInput/SchemaInput';
import { api, errorMessage } from '../../lib/api';
function sample(schema: Record<string, any>): Json {
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [
        key,
        key === 'protocols'
          ? [{ name: 'Aave' }, { name: 'Uniswap' }, { name: 'Morpho' }]
          : sample(value as Record<string, any>),
      ]),
    );
  if (schema.type === 'array') return [];
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  if (schema.type === 'boolean') return false;
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
  const [raw, setRaw] = useState(false);
  const [versions, setVersions] = useState<WorkflowVersion[]>([]),
    [version, setVersion] = useState(workflow.latestVersion),
    [input, setInput] = useState('{}'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api.workflows.versions
      .query({ id: workflow.id })
      .then((v) => {
        setVersions(v);
        setInput(
          JSON.stringify(sample(v.at(-1)!.definition.inputSchema), null, 2),
        );
      })
      .catch((e) => setError(errorMessage(e)));
  }, [workflow.id]);
  const schema = versions.find((v) => v.version === version)?.definition
    .inputSchema;
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
      <p className="hint">
        Script and Fetch steps run automatically. Agent steps wait for a
        connected agent to pick up their assignments. Starting a run does not
        launch an agent; ask your agent to continue the run when it is waiting.
      </p>

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
        {versions.map((v) => (
          <option key={v.version} value={v.version}>
            Version {v.version}
          </option>
        ))}
      </NativeSelect>

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
      </div>
      <details>
        <summary>Input contract</summary>
        <pre>{JSON.stringify(schema, null, 2)}</pre>
      </details>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || !schema}
          onClick={async () => {
            const invalid =
              fieldsRef.current?.querySelector<HTMLInputElement>(':invalid');
            if (invalid) {
              invalid.reportValidity();
              return;
            }
            setBusy(true);
            try {
              const result = await api.runs.start.mutate({
                workflowId: workflow.id,
                version,
                input: JSON.parse(input),
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
      </div>
    </Modal>
  );
}
