import { Radio, Stack, TextInput } from '@mantine/core';
import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import {
  contractAtPath,
  outgoingPorts,
  type Contract,
  type WorkflowNode,
} from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { MatchValueEditor } from './MatchValueEditor';
import { InputPathInput } from './InputPathInput';
import { suggestedMatchValue } from './MatchValueEditor';
import styles from './SwitchEditor.module.css';

type SwitchNode = Extract<WorkflowNode, { kind: 'switch' }>;
export function SwitchEditor({
  node,
  onChange,
  connectedBranches = [],
  inputSchema = {},
  inputSource,
}: {
  node: SwitchNode;
  onChange: (node: SwitchNode) => void;
  connectedBranches?: string[];
  inputSchema?: Contract;
  inputSource?: string;
}) {
  // Editor-only identities keep partially typed values with their row on removal.
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
  return (
    <div className={styles.editor}>
      <div>
        <InputPathInput
          label="Check this input field"
          aria-label="Check this input field"
          value={node.path}
          schema={inputSchema}
          suggestionSource={inputSource}
          placeholder="e.g. route or request.category"
          onChange={(path) => patch({ path })}
        />
        <p className={styles.help}>
          Use dots for nested fields. Leave blank to check the whole input. A
          missing field fails the run.
        </p>
      </div>
      <div className={styles.cases}>
        <div>
          <h3 className={styles.sectionHeading}>Cases</h3>
          <p className={styles.help}>
            The first match wins. Connect each named branch to its next step on
            the canvas.
          </p>
        </div>
        {node.cases.map((entry, index) => (
          <section
            className={styles.case}
            aria-label={`Case ${index + 1}`}
            key={keys[index]}
          >
            <span className={styles.caseNumber} aria-hidden="true">
              {index + 1}
            </span>
            <div className={styles.caseFields}>
              <MatchValueEditor
                label={`Case ${index + 1} match value`}
                value={entry.equals}
                onChange={(equals) => updateCase(index, { equals })}
                suggestedSchema={contractAtPath(inputSchema, node.path)}
              />
              <TextInput
                label="Branch name"
                aria-label={`Case ${index + 1} branch name`}
                placeholder="e.g. create-ticket"
                value={entry.port}
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
        <Radio.Group
          label="When no case matches"
          value={node.default === undefined ? 'fail' : 'fallback'}
          onChange={(value) =>
            patch({ default: value === 'fallback' ? fallbackName : undefined })
          }
        >
          <Stack gap="sm" mt="xs">
            <Radio
              value="fail"
              label="Fail the run"
              description="Stop with an error showing the unmatched value."
            />
            <Radio
              value="fallback"
              label="Follow a fallback branch"
              description="Send unmatched values to another step."
            />
          </Stack>
        </Radio.Group>
        {node.default !== undefined && (
          <TextInput
            mt="md"
            label="Fallback branch name"
            description="Connect this branch to its next step on the canvas."
            value={node.default}
            onChange={(event) => {
              setFallbackName(event.target.value);
              patch({ default: event.target.value });
            }}
          />
        )}
      </div>
      {removed.length > 0 && (
        <p className={styles.warning}>
          Applying these changes removes connections for: {removed.join(', ')}.
          Reconnect renamed branches on the canvas.
        </p>
      )}
    </div>
  );
}
