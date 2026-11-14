import {
  Button,
  TextInput,
  Textarea,
  NativeSelect,
  Select,
  Text,
  Input,
  SegmentedControl,
  Switch,
  Modal,
  ModalBody,
  ModalFooter,
} from '../../design-system';

import { StallPolicyEditor } from '../executors/StallSettings';
import { ExecutorSelect } from '../executors/ExecutorSelect';

import { useEffect, useRef, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import {
  nodeSchema,
  outgoingPorts,
  parallelBranchPort,
  type Workflow,
  type WorkflowCatalogEntry,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@interlock/core';

import {
  ContractEditor,
  ContractForm,
  ContractNavigation,
  type ContractPage,
} from '../../components/ContractEditor/ContractEditor';
import { workflowTargets } from './workflowTargets';
import type { WorkspaceRead } from '../../components/WorkspaceReads';
import { NodeInspector } from './NodeInspector';
import { WorkspaceSettings } from './WorkspaceSettings';
import { PermissionPolicySettings } from './PermissionPolicySettings';
import { nodeDescriptions } from './nodeDescriptions';
import type { NodeSectionName } from './NodeSettingsSections';
import { api, download } from '../../lib/api';
import {
  CANVAS_GAP,
  canvasGeometry,
  newNodePosition,
  separateNodes,
} from '@interlock/core/layout';
import styles from './SettingsDialog.module.css';
import { parallelTail, withParallelReturns } from './parallelReturns';

export type Settings = {
  name: string;
  description: string;
  definition: WorkflowDefinition;
};
export function SettingsDialog({
  node,
  creating = false,
  parentBatchId,
  parentParallel,
  name,
  description,
  definition,
  workflows,
  workflowsRead,
  onClose,
  onApply,
  onBoardSaved,
  onDelete,
  onCreateChild,
  onOpenWorkflow,
  workflowId,
  workflowBoardId,
  boardStageColumns,
  canExport = true,
  returnFocusTo,
}: Settings & {
  workflowId?: string;
  workflowBoardId?: string;
  boardStageColumns?: Workflow['boardStageColumns'];
  canExport?: boolean;
  returnFocusTo?: () => HTMLElement | null;
  onCreateChild?: (
    name: string,
    settings: Settings,
    nodeId: string,
  ) => Promise<void>;
  onOpenWorkflow?: (id: string) => void;
  node?: WorkflowNode;
  creating?: boolean;
  parentBatchId?: string;
  parentParallel?: { parallelId: string; parallelBranchId: string };
  workflows: WorkflowCatalogEntry[];
  workflowsRead?: WorkspaceRead;
  onClose: () => void;
  onApply: (settings: Settings) => void;
  onBoardSaved?: (workflow: Workflow) => void;
  onDelete?: () => void;
}) {
  const [settings, setSettings] = useState(() =>
    structuredClone({ name, description, definition }),
  );
  const [originalBoardId] = useState(workflowBoardId ?? null);
  const [boardId, setBoardId] = useState(originalBoardId);
  const [boards, setBoards] =
    useState<Awaited<ReturnType<typeof api.boards.list.query>>>();
  useEffect(() => {
    if (!workflowId) return;
    let active = true;
    void api.boards.list
      .query()
      .then((items) => {
        if (active) setBoards(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [workflowId]);
  const assignedBoard = boards?.find(
    (board) => board.id === (node || creating ? workflowBoardId : boardId),
  );
  const parallelGroup =
    parentParallel &&
    definition.nodes.find((n) => n.id === parentParallel.parallelId);
  const pathName =
    parallelGroup?.kind === 'parallel'
      ? parallelGroup.branches.find(
          (path) => path.id === parentParallel?.parallelBranchId,
        )?.key
      : undefined;
  const [newNodeId] = useState(() => crypto.randomUUID());
  const [nodeDraft, setNodeDraft] = useState(() =>
    node
      ? structuredClone(node)
      : creating
        ? nodeSchema.parse({
            id: newNodeId,
            kind: 'agent',
            batchId: parentBatchId,
            ...parentParallel,
            label: 'New agent',
            prompt: 'Describe the assignment.',
          })
        : undefined,
  );
  const [contract, setContract] = useState<ContractPage>();
  const [error, setError] = useState('');
  const [nodeSection, setNodeSection] = useState<NodeSectionName>('work');
  const [childName, setChildName] = useState('');
  const [targetMode, setTargetMode] = useState('existing');
  const [creatingChild, setCreatingChild] = useState(false);
  const variants = useRef<Record<string, WorkflowNode>>({});
  const nodeType =
    nodeDraft?.kind === 'input' && nodeDraft.humanInput
      ? 'human'
      : nodeDraft?.kind;
  const chooseType = (kind: string) => {
    if (!kind) return;
    if (nodeDraft && nodeType) variants.current[nodeType] = nodeDraft;
    const reference =
      !workflowsRead || workflowsRead.ready
        ? workflowTargets(workflows, workflowId)[0]
        : undefined;
    setNodeDraft(
      variants.current[kind] ??
        nodeSchema.parse({
          id: newNodeId,
          kind: kind === 'human' ? 'input' : kind,
          humanInput:
            kind === 'human'
              ? {
                  question: 'What should happen next?',
                  answer: { kind: 'text' },
                }
              : undefined,
          batchId: parentBatchId,
          ...parentParallel,
          label:
            kind === 'switch'
              ? 'New branch'
              : kind === 'batch'
                ? 'Batch'
                : kind === 'parallel'
                  ? 'Parallel'
                  : kind === 'human'
                    ? 'Human input'
                    : `New ${kind}`,
          branches:
            kind === 'parallel'
              ? [
                  { id: crypto.randomUUID(), key: 'branch-1' },
                  { id: crypto.randomUUID(), key: 'branch-2' },
                ]
              : undefined,
          prompt: 'Describe the assignment.',
          url: '',
          language: 'javascript',
          environmentMode: 'minimal',
          command: 'return input;',
          path: '',
          equals: true,
          cases: [{ port: 'true', equals: true }],
          default: kind === 'switch' ? 'false' : undefined,
          workflowId: reference?.id ?? 'choose-workflow',
          version: reference?.latestVersion ?? null,
        }),
    );
    setError('');
    setNodeSection('work');
  };
  const form = useRef<HTMLDivElement>(null);
  const patchDefinition = (patch: Partial<WorkflowDefinition>) =>
    setSettings((s) => ({ ...s, definition: { ...s.definition, ...patch } }));
  const contractTrigger = useRef<HTMLElement | null>(null);
  const openContract = (page: ContractPage) => {
    contractTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setContract(page);
  };
  const back = () => {
    setContract(undefined);
    requestAnimationFrame(() => contractTrigger.current?.focus());
  };
  const apply = async () => {
    if (creating && !nodeDraft) return;
    const invalid = Array.from(
      form.current?.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('input, textarea, select') ?? [],
    ).find((control) => control.willValidate && !control.validity.valid);
    if (invalid) {
      const section = invalid
        .closest('[data-node-section]')
        ?.getAttribute('data-node-section');
      if (section) setNodeSection(section as NodeSectionName);
      for (
        let ancestor = invalid.parentElement;
        ancestor;
        ancestor = ancestor.parentElement
      )
        if (ancestor.tagName === 'DETAILS')
          (ancestor as HTMLDetailsElement).open = true;
      setTimeout(() => {
        invalid.focus();
        invalid.reportValidity();
      }, 0);
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
        const current =
          creating && parentParallel
            ? withParallelReturns(settings.definition)
            : settings.definition;
        const tail =
          creating && parentParallel
            ? parallelTail(
                current,
                parentParallel.parallelId,
                parentParallel.parallelBranchId,
              )
            : undefined;
        if (tail) {
          const geometry = canvasGeometry(current);
          const source = geometry.index.get(tail.source)!;
          const origin = geometry.position(source);
          parsed.position = {
            x: Math.max(
              parsed.position.x,
              origin.x + geometry.size(source).width + CANVAS_GAP,
            ),
            y: origin.y,
          };
        }
        const start =
          parsed.parallelId && parsed.parallelBranchId
            ? {
                source: parsed.parallelId,
                port: parallelBranchPort(parsed.parallelBranchId),
              }
            : parsed.batchId
              ? { source: parsed.batchId, port: 'item' }
              : undefined;
        const nextDefinition = {
          ...current,
          edges: tail
            ? current.edges.map((edge) =>
                edge.id === tail.id
                  ? {
                      ...edge,
                      target: parsed.id,
                      targetHandle: 'default' as const,
                    }
                  : edge,
              )
            : creating &&
                start &&
                !current.edges.some(
                  (e) => e.source === start.source && e.port === start.port,
                )
              ? [
                  ...current.edges,
                  {
                    id: crypto.randomUUID(),
                    ...start,
                    target: parsed.id,
                  },
                ]
              : current.edges.filter(
                  (e) =>
                    e.source !== parsed.id ||
                    !node ||
                    !outgoingPorts(node).includes(e.port) ||
                    outgoingPorts(parsed).includes(e.port),
                ),
          nodes: creating
            ? [...settings.definition.nodes, parsed]
            : settings.definition.nodes.map((n) =>
                n.id === parsed.id ? parsed : n,
              ),
        };
        const withReturns = parsed.parallelId
          ? withParallelReturns(nextDefinition)
          : nextDefinition;
        const next = {
          ...settings,
          definition: creating ? separateNodes(withReturns) : withReturns,
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
        if (workflowId && boardId !== originalBoardId) {
          setCreatingChild(true);
          const saved = await api.boards.assign.mutate({
            workflowId,
            boardId,
            expectedBoardId: originalBoardId,
          });
          onBoardSaved?.(saved);
        }
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
        contract ? (
          `${contract.label} contract`
        ) : creating ? (
          <span className={styles.title}>
            <Plus size={18} aria-hidden="true" />
            {pathName ? `Add node to ${pathName}` : 'Add node'}
          </span>
        ) : nodeDraft ? (
          nodeDraft.label
        ) : (
          'Workflow settings'
        )
      }
      returnFocusTo={returnFocusTo}
      backLabel={contract ? 'Back to settings' : undefined}
      onClose={creatingChild ? () => {} : contract ? back : onClose}
      size={contract ? 960 : nodeDraft ? 880 : 720}
      height={nodeDraft && !contract ? 820 : undefined}
      busy={creatingChild}
    >
      {contract && (
        <ContractForm
          value={contract.value}
          onClose={back}
          onApply={(schema) => {
            contract.onApply(schema);
            back();
          }}
        />
      )}
      <div hidden={Boolean(contract)} className={styles.settings}>
        <ModalBody flush={Boolean(nodeDraft)}>
          <div
            ref={form}
            className={nodeDraft ? styles.nodeContent : undefined}
          >
            <fieldset
              disabled={creatingChild}
              className={`${styles.fields}${nodeDraft ? ` ${styles.nodeFields}` : ''}`}
            >
              <ContractNavigation.Provider value={openContract}>
                {creating && (
                  <div className={styles.typeChooser}>
                    <NativeSelect
                      label="Node type"
                      value={nodeType ?? ''}
                      onChange={(e) => chooseType(e.target.value)}
                    >
                      <option value="agent">Agent</option>
                      <option value="script">Script</option>
                      <option value="fetch">Fetch</option>
                      <option value="wait">Wait</option>
                      <option value="input">External input</option>
                      <option value="human">Human input</option>
                      <option value="switch">Branch</option>
                      <option value="workflow">Workflow</option>
                      {!parentParallel && <option value="batch">Batch</option>}
                      {!parentParallel && !parentBatchId && (
                        <option value="parallel">Parallel</option>
                      )}
                    </NativeSelect>
                    {nodeDraft && (
                      <p className="hint">
                        {nodeType === 'human'
                          ? 'Ask for an answer that the workflow can use in later steps.'
                          : nodeDescriptions[nodeDraft.kind]}
                      </p>
                    )}
                  </div>
                )}
                {creating &&
                  nodeDraft?.kind === 'workflow' &&
                  onCreateChild && (
                    <div className={styles.workflowSource}>
                      <Input.Wrapper label="Workflow source" mb="md">
                        <SegmentedControl
                          mt={4}
                          className={styles.workflowSourceChoice}
                          aria-label="Workflow source"
                          value={targetMode}
                          onChange={setTargetMode}
                          disabled={creatingChild}
                          data={[
                            {
                              value: 'existing',
                              label: 'Use existing workflow',
                            },
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
                    </div>
                  )}
                {nodeDraft ? (
                  <NodeInspector
                    section={nodeSection}
                    onSectionChange={setNodeSection}
                    workflowsRead={workflowsRead}
                    node={nodeDraft}
                    creating={creating}
                    workflowId={workflowId}
                    board={assignedBoard}
                    boardStageColumns={boardStageColumns}
                    previousBoard={boards?.find((board) =>
                      board.columns.some(
                        (column) => column.id === nodeDraft.boardColumnId,
                      ),
                    )}
                    hideWorkflowTarget={
                      creating &&
                      targetMode === 'child' &&
                      Boolean(onCreateChild)
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
                  />
                ) : creating ? (
                  <p className="hint">
                    Choose the type of step you want to add, then configure it
                    here.
                  </p>
                ) : (
                  <>
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
                      rows={2}
                      value={settings.description}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          description: e.target.value,
                        }))
                      }
                    />
                    {workflowId && (
                      <>
                        <Select
                          mb="md"
                          label="Board"
                          placeholder="No board"
                          clearable
                          searchable
                          value={boardId}
                          onChange={setBoardId}
                          disabled={!boards}
                          data={
                            boards?.map((board) => ({
                              value: board.id,
                              label: board.name,
                            })) ?? []
                          }
                        />
                        {originalBoardId &&
                          boardId &&
                          boardId !== originalBoardId && (
                            <Text size="sm" mb="md">
                              {settings.name} will move from{' '}
                              {
                                boards?.find(
                                  (board) => board.id === originalBoardId,
                                )?.name
                              }
                              .
                            </Text>
                          )}
                      </>
                    )}

                    <ExecutorSelect
                      value={settings.definition.executor}
                      workflowPermissions={settings.definition.agentPermissions}
                      workflowModel={settings.definition.agentModel}
                      workflowModelMode={settings.definition.agentModelMode}
                      workflowEffort={settings.definition.agentEffort}
                      onEffortChange={(agentEffort) =>
                        patchDefinition({ agentEffort })
                      }
                      onModelChange={(agentModel, agentModelMode) =>
                        patchDefinition({ agentModel, agentModelMode })
                      }
                      onPermissionsChange={(agentPermissions) =>
                        patchDefinition({ agentPermissions })
                      }
                      onChange={(executor) =>
                        patchDefinition({ executor: executor ?? undefined })
                      }
                    />
                    <Switch
                      mb="md"
                      label="Pin saved prompts when publishing"
                      description="Published versions keep the saved prompt revisions selected at publication. Later prompt edits apply after you publish a new version."
                      checked={settings.definition.pinPromptsAtPublish ?? false}
                      onChange={(event) =>
                        patchDefinition({
                          pinPromptsAtPublish: event.currentTarget.checked,
                        })
                      }
                    />
                    <WorkspaceSettings
                      value={settings.definition.workspace}
                      onChange={(workspace) => patchDefinition({ workspace })}
                    />
                    <PermissionPolicySettings
                      value={settings.definition.permissionPolicy}
                      onChange={(permissionPolicy) =>
                        patchDefinition({ permissionPolicy })
                      }
                    />
                    <StallPolicyEditor
                      value={settings.definition}
                      onChange={patchDefinition}
                    />
                    <ContractEditor
                      label="Workflow input"
                      value={settings.definition.inputSchema}
                      onChange={(inputSchema) =>
                        patchDefinition({ inputSchema })
                      }
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
                      description="Parallel branch steps share this limit. Each Batch item has its own limit. Entry, Exit, and repeated visits count; waiting adds no steps."
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
        </ModalBody>
        {node &&
          nodeDraft &&
          settings.definition.edges.some(
            (edge) =>
              edge.source === node.id &&
              outgoingPorts(node).includes(edge.port) &&
              !outgoingPorts(nodeDraft).includes(edge.port),
          ) && (
            <p className={`hint ${styles.feedback}`} role="status">
              Applying these changes removes connections for:{' '}
              {[
                ...new Set(
                  settings.definition.edges
                    .filter(
                      (edge) =>
                        edge.source === node.id &&
                        outgoingPorts(node).includes(edge.port) &&
                        !outgoingPorts(nodeDraft).includes(edge.port),
                    )
                    .map((edge) => edge.port),
                ),
              ].join(', ')}
              . Reconnect changed branches on the canvas.
            </p>
          )}
        {error && (
          <p role="alert" className={`error-text ${styles.feedback}`}>
            {error}
          </p>
        )}
        <ModalFooter
          aside={
            <>
              {onDelete &&
                node &&
                !creating &&
                node.kind !== 'entry' &&
                node.kind !== 'exit' && (
                  <Button
                    variant="ghost"
                    color="red"
                    leftSection={<Trash2 size={14} aria-hidden />}
                    onClick={onDelete}
                  >
                    Delete node
                  </Button>
                )}
              {!node && !creating && (
                <p className="hint">
                  Changes apply to the draft. Save and publish from the workflow
                  toolbar.
                </p>
              )}
            </>
          }
        >
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
        </ModalFooter>
      </div>
    </Modal>
  );
}
