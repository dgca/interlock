import { TextInput } from '@mantine/core';
import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { outgoingPorts, type WorkflowNode } from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { MatchValueEditor } from './MatchValueEditor';
import styles from './SwitchEditor.module.css';

type SwitchNode = Extract<WorkflowNode, { kind: 'switch' }>;
export function SwitchEditor({
  node,
  onChange,
  connectedBranches = [],
}: {
  node: SwitchNode;
  onChange: (node: SwitchNode) => void;
  connectedBranches?: string[];
}) {
  // Editor-only identities keep partially typed values with their row on removal.
  const [keys, setKeys] = useState(() =>
    node.cases.map(() => crypto.randomUUID()),
  );
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
        <TextInput
          label="Check this input field"
          value={node.path}
          placeholder="e.g. route or request.category"
          onChange={(event) => patch({ path: event.target.value })}
        />
        <p className={styles.help}>
          Input is JSON data, usually from the previous step. For{' '}
          <code>{'{"route":"ticket"}'}</code>, enter <code>route</code>. Use
          dots for nested fields, or leave blank to check the whole input.
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
                cases: [...node.cases, { port: `case-${number}`, equals: '' }],
              });
            }}
          >
            <Plus size={14} />
            Add case
          </Button>
        </div>
      </div>
      <div className={styles.otherwise}>
        <TextInput
          label="Default branch"
          description="Used when no case matches. Connect this branch on the canvas too."
          value={node.default}
          onChange={(event) => patch({ default: event.target.value })}
        />
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
