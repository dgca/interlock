import { TextInput, Textarea, NativeSelect } from '@mantine/core';
import { useRef, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import {
  nodeSchema,
  type Workflow,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@interlock/core';
import { Modal } from '../../components/Modal/Modal';
import { Button } from '../../components/Button/Button';
import {
  ContractEditor,
  ContractForm,
  ContractNavigation,
  type ContractPage,
} from '../../components/ContractEditor/ContractEditor';
import { NodeInspector } from './NodeInspector';
import { download } from '../../lib/api';
import styles from './SettingsDialog.module.css';

type Settings = {
  name: string;
  description: string;
  definition: WorkflowDefinition;
};
export function SettingsDialog({
  node,
  creating = false,
  parentBatchId,
  name,
  description,
  definition,
  workflows,
  onClose,
  onApply,
  onDelete,
}: Settings & {
  node?: WorkflowNode;
  creating?: boolean;
  parentBatchId?: string;
  workflows: Workflow[];
  onClose: () => void;
  onApply: (settings: Settings) => void;
  onDelete?: () => void;
}) {
  const [settings, setSettings] = useState(() =>
    structuredClone({ name, description, definition }),
  );
  const [nodeDraft, setNodeDraft] = useState(
    () => node && structuredClone(node),
  );
  const [contract, setContract] = useState<ContractPage>();
  const [error, setError] = useState('');
  const [newNodeId] = useState(() => crypto.randomUUID());
  const variants = useRef<Record<string, WorkflowNode>>({});
  const chooseType = (kind: string) => {
    if (!kind) return;
    if (nodeDraft) variants.current[nodeDraft.kind] = nodeDraft;
    const reference = workflows.find((w) => w.latestVersion);
    setNodeDraft(
      variants.current[kind] ??
        nodeSchema.parse({
          id: newNodeId,
          kind,
          batchId: parentBatchId,
          label: kind === 'batch' ? 'Batch' : `New ${kind}`,
          position: parentBatchId
            ? {
                x:
                  130 +
                  definition.nodes.filter((n) => n.batchId === parentBatchId)
                    .length *
                    290,
                y: 160,
              }
            : { x: 150 + definition.nodes.length * 90, y: 360 },
          prompt: 'Describe the assignment.',
          url: '',
          language: 'javascript',
          command: 'return input;',
          path: '',
          equals: true,
          workflowId: reference?.id ?? 'choose-workflow',
          version: reference?.latestVersion ?? 1,
        }),
    );
    setError('');
  };
  const form = useRef<HTMLDivElement>(null);
  const patchDefinition = (patch: Partial<WorkflowDefinition>) =>
    setSettings((s) => ({ ...s, definition: { ...s.definition, ...patch } }));
  const back = () => setContract(undefined);
  const apply = () => {
    if (creating && !nodeDraft) return;
    const invalid = form.current?.querySelector<HTMLInputElement>(':invalid');
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    try {
      if (nodeDraft) {
        const parsed = nodeSchema.parse(nodeDraft);
        onApply({
          ...settings,
          definition: {
            ...settings.definition,
            edges:
              creating &&
              parsed.batchId &&
              !settings.definition.edges.some(
                (e) => e.source === parsed.batchId && e.port === 'item',
              )
                ? [
                    ...settings.definition.edges,
                    {
                      id: crypto.randomUUID(),
                      source: parsed.batchId,
                      port: 'item',
                      target: parsed.id,
                    },
                  ]
                : settings.definition.edges,
            nodes: creating
              ? [...settings.definition.nodes, parsed]
              : settings.definition.nodes.map((n) =>
                  n.id === parsed.id ? parsed : n,
                ),
          },
        });
      } else {
        if (!settings.name.trim()) throw new Error('Give the workflow a name.');
        onApply(settings);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={
        contract
          ? `${contract.label} contract`
          : creating
            ? 'Add node'
            : nodeDraft
              ? nodeDraft.label
              : 'Workflow settings'
      }
      onClose={contract ? back : onClose}
      size={960}
    >
      {contract && (
        <>
          <Button variant="ghost" onClick={back}>
            <ArrowLeft />
            Back to settings
          </Button>
          <ContractForm
            value={contract.value}
            onClose={back}
            onApply={(schema) => {
              contract.onApply(schema);
              back();
            }}
          />
        </>
      )}
      <div hidden={Boolean(contract)}>
        <div ref={form} className={styles.content}>
          <ContractNavigation.Provider value={setContract}>
            {creating && (
              <NativeSelect
                mb="md"
                label="Node type"
                value={nodeDraft?.kind ?? ''}
                onChange={(e) => chooseType(e.target.value)}
              >
                <option value="" disabled>
                  Choose a node type
                </option>
                <option value="agent">Agent</option>
                <option value="script">Script</option>
                <option value="fetch">Fetch</option>
                <option value="condition">Condition</option>
                <option value="workflow">Workflow</option>
                <option value="batch">Batch</option>
              </NativeSelect>
            )}
            {nodeDraft ? (
              <NodeInspector
                node={nodeDraft}
                workflows={workflows}
                definition={settings.definition}
                onBoundaryChange={(schema) =>
                  patchDefinition(
                    nodeDraft.kind === 'entry'
                      ? { inputSchema: schema }
                      : { outputSchema: schema },
                  )
                }
                onChange={setNodeDraft}
                onDelete={onDelete}
              />
            ) : creating ? (
              <p className="hint">
                Choose the type of step you want to add, then configure it here.
              </p>
            ) : (
              <>
                <p className="hint">
                  Configure the workflow's inputs, outputs, and execution limit.
                </p>

                <TextInput
                  mb="md"
                  label="Name"
                  required
                  value={settings.name}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, name: e.target.value }))
                  }
                />

                <Textarea
                  mb="md"
                  label="Description"
                  rows={4}
                  value={settings.description}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      description: e.target.value,
                    }))
                  }
                />

                <ContractEditor
                  label="Workflow input"
                  value={settings.definition.inputSchema}
                  onChange={(inputSchema) => patchDefinition({ inputSchema })}
                />
                <ContractEditor
                  label="Workflow output"
                  value={settings.definition.outputSchema}
                  onChange={(outputSchema) => patchDefinition({ outputSchema })}
                />

                <TextInput
                  mb="md"
                  label="Maximum steps per run"
                  type="number"
                  min={2}
                  max={1000}
                  required
                  value={settings.definition.maxSteps}
                  onChange={(e) =>
                    patchDefinition({ maxSteps: Number(e.target.value) })
                  }
                />

                <Button
                  onClick={() => download(`${settings.name}.json`, settings)}
                >
                  <Download />
                  Export workflow
                </Button>
              </>
            )}
          </ContractNavigation.Provider>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <footer className={styles.footer}>
          <p className="hint">
            Changes apply to the draft. Save and publish from the workflow
            toolbar.
          </p>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={apply}
            disabled={creating && !nodeDraft}
          >
            {creating ? 'Add node' : 'Apply changes'}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
