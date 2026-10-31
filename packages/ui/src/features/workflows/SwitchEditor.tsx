import { NativeSelect, TextInput, Textarea, Text } from '@mantine/core';
import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import {
  matchRouting,
  type Json,
  contractAtPath,
  outgoingPorts,
  type Contract,
  type WorkflowNode,
} from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { TypedValueEditor, suggestedMatchValue } from './TypedValueEditor';
import { InputPathInput } from './InputPathInput';
import styles from './SwitchEditor.module.css';

type SwitchNode = Extract<WorkflowNode, { kind: 'switch' }>;
export function SwitchEditor({
  node,
  onChange,
  connectedBranches = [],
  inputSchema = {},
  inputSource,
  dataSource = 'input',
  reservedPorts = [],
  showConnectionWarning = true,
}: {
  node: SwitchNode;
  onChange: (node: SwitchNode) => void;
  connectedBranches?: string[];
  inputSchema?: Contract;
  inputSource?: string;
  dataSource?: 'input' | 'result';
  reservedPorts?: string[];
  showConnectionWarning?: boolean;
}) {
  // Editor-only identities keep partially typed values with their row on removal.
  const [showTypes, setShowTypes] = useState(false);
  const [sample, setSample] = useState('');
  let sampleMessage = '',
    sampleError = false;
  if (sample.trim()) {
    try {
      const parsed = JSON.parse(sample) as Json;
      const port = matchRouting(node, parsed);
      sampleMessage =
        port === undefined
          ? 'No match. This step would fail.'
          : `Follow branch: ${port}`;
      sampleError = port === undefined;
    } catch (error) {
      sampleMessage =
        error instanceof Error ? error.message : 'Enter valid JSON.';
      sampleError = true;
    }
  }
  const [keys, setKeys] = useState(() =>
    node.cases.map(() => crypto.randomUUID()),
  );
  const [fallbackName, setFallbackName] = useState(() => {
    if (node.default !== undefined) return node.default;
    const ports = new Set(outgoingPorts(node));
    let name = 'fallback';
    let number = 2;
    while (ports.has(name)) name = `fallback-${number++}`;
    return name;
  });
  const patch = (value: Partial<SwitchNode>) => onChange({ ...node, ...value });
  const updateCase = (
    index: number,
    value: Partial<SwitchNode['cases'][number]>,
  ) =>
    patch({
      cases: node.cases.map((entry, i) =>
        i === index ? { ...entry, ...value } : entry,
      ),
    });
  const removed = connectedBranches.filter(
    (name) => !outgoingPorts(node).includes(name),
  );
  const portError = (port: string) =>
    !port.trim()
      ? 'Enter a branch name.'
      : reservedPorts.includes(port)
        ? `"${port}" is reserved for the lifecycle route.`
        : [
              ...node.cases.map((c) => c.port),
              ...(node.default === undefined ? [] : [node.default]),
            ].filter((p) => p === port).length > 1
          ? 'Each branch needs a unique name.'
          : '';
  return (
    <div className={styles.editor}>
      <div>
        <InputPathInput
          label={`Check this ${dataSource} field`}
          aria-label={`Check this ${dataSource} field`}
          value={node.path}
          schema={inputSchema}
          suggestionSource={inputSource}
          placeholder="e.g. route or request.category"
          onChange={(path) => {
            const schema = contractAtPath(inputSchema, path);
            const suggested = suggestedMatchValue(schema);
            if (
              (schema.type || schema.enum) &&
              node.cases.some(
                (c) =>
                  (c.equals === null ? 'null' : typeof c.equals) !==
                  (suggested === null ? 'null' : typeof suggested),
              )
            )
              setShowTypes(true);
            patch({ path });
          }}
        />
        <p className={styles.help}>
          Leave blank to check the whole {dataSource}. Missing fields fail the
          step.
        </p>
      </div>
      <div className={styles.cases}>
        <div className={styles.caseTools}>
          <Button variant="ghost" onClick={() => setShowTypes(!showTypes)}>
            {showTypes ? 'Hide value types' : 'Show value types'}
          </Button>
        </div>
        {node.cases.map((entry, index) => (
          <section
            className={styles.case}
            aria-label={`Case ${index + 1}`}
            key={keys[index]}
          >
            <div className={styles.caseFields}>
              <TypedValueEditor
                label={`Case ${index + 1} match value`}
                valueLabel="Match value"
                showType={showTypes}
                value={entry.equals}
                onChange={(equals) => updateCase(index, { equals })}
                suggestedSchema={contractAtPath(inputSchema, node.path)}
                suggestionSource={inputSource}
              />
              <TextInput
                label="Branch name"
                aria-label={`Case ${index + 1} branch name`}
                placeholder="e.g. create-ticket"
                value={entry.port}
                required
                error={portError(entry.port) || undefined}
                ref={(element) =>
                  element?.setCustomValidity(portError(entry.port))
                }
                onChange={(event) =>
                  updateCase(index, { port: event.target.value })
                }
              />
            </div>
            <Button
              variant="ghost"
              className={styles.remove}
              aria-label={`Remove case ${index + 1}`}
              title={`Remove case ${index + 1}`}
              onClick={() => {
                setKeys(keys.filter((_, i) => i !== index));
                patch({ cases: node.cases.filter((_, i) => i !== index) });
              }}
            >
              <Trash2 size={14} />
            </Button>
          </section>
        ))}
        <div>
          <Button
            onClick={() => {
              const ports = new Set(outgoingPorts(node));
              let number = 1;
              while (ports.has(`case-${number}`)) number++;
              setKeys([...keys, crypto.randomUUID()]);
              patch({
                cases: [
                  ...node.cases,
                  {
                    port: `case-${number}`,
                    equals: suggestedMatchValue(
                      contractAtPath(inputSchema, node.path),
                    ),
                  },
                ],
              });
            }}
          >
            <Plus size={14} />
            Add case
          </Button>
        </div>
      </div>
      <div className={styles.otherwise}>
        <NativeSelect
          label="When no case matches"
          aria-label="When no case matches"
          value={node.default === undefined ? 'fail' : 'fallback'}
          data={[
            { value: 'fail', label: 'Fail the run' },
            { value: 'fallback', label: 'Follow a fallback branch' },
          ]}
          onChange={(event) =>
            patch({
              default:
                event.target.value === 'fallback' ? fallbackName : undefined,
            })
          }
        />
        {node.default !== undefined && (
          <TextInput
            mt="md"
            label="Fallback branch name"
            description="Connect this branch to its next step on the canvas."
            value={node.default}
            required
            error={portError(node.default) || undefined}
            ref={(element) =>
              element?.setCustomValidity(portError(node.default!))
            }
            onChange={(event) => {
              setFallbackName(event.target.value);
              patch({ default: event.target.value });
            }}
          />
        )}
      </div>
      <details className={styles.tryRouting}>
        <summary>Try branch matching</summary>
        <Textarea
          mt="sm"
          label={`Sample ${dataSource} JSON`}
          value={sample}
          placeholder={`Paste a sample ${dataSource}`}
          rows={3}
          onChange={(event) => setSample(event.currentTarget.value)}
        />
        {sampleMessage && (
          <Text
            mt="xs"
            size="sm"
            c={sampleError ? 'yellow' : undefined}
            role="status"
          >
            {sampleMessage}
          </Text>
        )}
      </details>
      {showConnectionWarning && removed.length > 0 && (
        <p className={styles.warning}>
          Applying these changes removes connections for: {removed.join(', ')}.
          Reconnect renamed branches on the canvas.
        </p>
      )}
    </div>
  );
}
