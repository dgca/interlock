import {
  TextInput,
  Textarea,
  NativeSelect,
  Input,
  SegmentedControl,
} from '@mantine/core';
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
import { workflowTargets } from './workflowTargets';
import { NodeInspector } from './NodeInspector';
import { api, download } from '../../lib/api';
import { newNodePosition, separateNodes } from './workflowLayout';
import styles from './SettingsDialog.module.css';

export type Settings = {
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
  onCreateChild,
  onOpenWorkflow,
  workflowId,
  canExport = true,
}: Settings & {
  workflowId?: string;
  canExport?: boolean;
  onCreateChild?: (
    name: string,
    settings: Settings,
    nodeId: string,
  ) => Promise<void>;
  onOpenWorkflow?: (id: string) => void;
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
  const [newNodeId] = useState(() => crypto.randomUUID());
  const [nodeDraft, setNodeDraft] = useState(() =>
    node
      ? structuredClone(node)
      : creating
        ? nodeSchema.parse({
            id: newNodeId,
            kind: 'agent',
            batchId: parentBatchId,
            label: 'New agent',
            prompt: 'Describe the assignment.',
          })
        : undefined,
  );
  const [contract, setContract] = useState<ContractPage>();
  const [error, setError] = useState('');
  const [childName, setChildName] = useState('');
  const [targetMode, setTargetMode] = useState('existing');
  const [creatingChild, setCreatingChild] = useState(false);
  const variants = useRef<Record<string, WorkflowNode>>({});
  const chooseType = (kind: string) => {
    if (!kind) return;
    if (nodeDraft) variants.current[nodeDraft.kind] = nodeDraft;
    const reference = workflowTargets(workflows, workflowId)[0];
    setNodeDraft(
      variants.current[kind] ??
        nodeSchema.parse({
          id: newNodeId,
          kind,
          batchId: parentBatchId,
          label: kind === 'batch' ? 'Batch' : `New ${kind}`,
          prompt: 'Describe the assignment.',
          url: '',
          language: 'javascript',
          command: 'return input;',
          path: '',
          equals: true,
          workflowId: reference?.id ?? 'choose-workflow',
          version: reference?.latestVersion ?? null,
        }),
    );
    setError('');
  };
  const form = useRef<HTMLDivElement>(null);
  const patchDefinition = (patch: Partial<WorkflowDefinition>) =>
    setSettings((s) => ({ ...s, definition: { ...s.definition, ...patch } }));
  const back = () => setContract(undefined);
  const apply = async () => {
    if (creating && !nodeDraft) return;
    const invalid = form.current?.querySelector<HTMLInputElement>(':invalid');
    if (invalid) {
      invalid.reportValidity();
      return;
    }
    try {
      if (nodeDraft) {
        const parsed = nodeSchema.parse(nodeDraft);
        if (
          creating &&
          parsed.kind === 'workflow' &&
          targetMode === 'child' &&
          onCreateChild
        ) {
          parsed.workflowId = 'new-child';
          parsed.version = null;
          if (parsed.label === 'New workflow')
            parsed.label = childName.trim() || parsed.label;
        }
        if (creating)
          parsed.position = newNodePosition(settings.definition, parsed);
        const nextDefinition = {
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
                    port: 'item' as const,
                    target: parsed.id,
                  },
                ]
              : settings.definition.edges.filter(
                  (e) =>
                    !(
                      e.source === parsed.id &&
                      e.port === 'timeout' &&
                      parsed.kind === 'agent' &&
                      parsed.unclaimedTimeoutMs === undefined
                    ),
                ),
          nodes: creating
            ? [...settings.definition.nodes, parsed]
            : settings.definition.nodes.map((n) =>
                n.id === parsed.id ? parsed : n,
              ),
        };
        const next = {
          ...settings,
          definition: creating ? separateNodes(nextDefinition) : nextDefinition,
        };
        if (
          creating &&
          parsed.kind === 'workflow' &&
          targetMode === 'child' &&
          onCreateChild
        ) {
          if (!childName.trim())
            throw new Error('Give the child workflow a name.');
          setCreatingChild(true);
          await onCreateChild(childName.trim(), next, parsed.id);
        } else onApply(next);
      } else {
        if (!settings.name.trim()) throw new Error('Give the workflow a name.');
        onApply(settings);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreatingChild(false);
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
      onClose={creatingChild ? () => {} : contract ? back : onClose}
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
          <fieldset
            disabled={creatingChild}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <ContractNavigation.Provider value={setContract}>
              {creating && (
                <NativeSelect
                  mb="md"
                  label="Node type"
                  value={nodeDraft?.kind ?? ''}
                  onChange={(e) => chooseType(e.target.value)}
                >
                  <option value="agent">Agent</option>
                  <option value="script">Script</option>
                  <option value="fetch">Fetch</option>
                  <option value="wait">Wait</option>
                  <option value="condition">Condition</option>
                  <option value="workflow">Workflow</option>
                  <option value="batch">Batch</option>
                </NativeSelect>
              )}
              {creating && nodeDraft?.kind === 'workflow' && onCreateChild && (
                <>
                  <Input.Wrapper label="Workflow source" mb="md">
                    <SegmentedControl
                      mt={4}
                      style={{ display: 'flex', width: 'fit-content' }}
                      aria-label="Workflow source"
                      value={targetMode}
                      onChange={setTargetMode}
                      disabled={creatingChild}
                      data={[
                        { value: 'existing', label: 'Use existing workflow' },
                        { value: 'child', label: 'Create child workflow' },
                      ]}
                    />
                  </Input.Wrapper>
                  {targetMode === 'child' && (
                    <TextInput
                      label="Child workflow name"
                      mb="md"
                      required
                      maxLength={120}
                      value={childName}
                      disabled={creatingChild}
                      onChange={(e) => setChildName(e.target.value)}
                    />
                  )}
                </>
              )}
              {nodeDraft ? (
                <NodeInspector
                  node={nodeDraft}
                  workflowId={workflowId}
                  hideWorkflowTarget={
                    creating && targetMode === 'child' && Boolean(onCreateChild)
                  }
                  onOpenWorkflow={
                    JSON.stringify(nodeDraft) === JSON.stringify(node)
                      ? onOpenWorkflow
                      : undefined
                  }
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
                  Choose the type of step you want to add, then configure it
                  here.
                </p>
              ) : (
                <>
                  <p className="hint">
                    Configure the workflow's inputs, outputs, and execution
                    limit.
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
                    onChange={(outputSchema) =>
                      patchDefinition({ outputSchema })
                    }
                  />

                  <TextInput
                    mb="md"
                    label="Maximum steps per run"
                    description="Each Batch item has its own budget. Waiting uses one step, regardless of duration. Entry, Exit, and repeated visits count too."
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
                    disabled={!canExport}
                    title={
                      !canExport
                        ? 'Export with owned children is not available yet'
                        : undefined
                    }
                    onClick={() => {
                      if (!workflowId) {
                        download(`${settings.name}.json`, settings);
                        return;
                      }
                      void api.workflows.exportDraft
                        .mutate({
                          id: workflowId,
                          name: settings.name,
                          description: settings.description,
                          draft: settings.definition,
                        })
                        .then((bundle) => {
                          download(`${settings.name}.json`, bundle);
                        })
                        .catch((error) => setError(error.message));
                    }}
                  >
                    <Download />
                    Export workflow
                  </Button>
                </>
              )}
            </ContractNavigation.Provider>
          </fieldset>
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
          <Button onClick={onClose} disabled={creatingChild}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={apply}
            disabled={creatingChild || (creating && !nodeDraft)}
          >
            {creatingChild
              ? 'Creating…'
              : creating &&
                  nodeDraft?.kind === 'workflow' &&
                  targetMode === 'child' &&
                  onCreateChild
                ? 'Save and create child'
                : creating
                  ? 'Add node'
                  : 'Apply changes'}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
