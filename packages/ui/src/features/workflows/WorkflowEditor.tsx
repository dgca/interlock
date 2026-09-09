import type { Action } from '../../lib/useActionFeedback';
import { useMemo, useState, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  ArrowLeft,
  Play,
  Save,
  Plus,
  Upload,
  Settings2,
  Undo2,
  Redo2,
  WandSparkles,
} from 'lucide-react';
import {
  validateDefinition,
  type Workflow,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowDefinition,
} from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { CodeEditor } from '../../components/CodeEditor/CodeEditor';
import { parseRawDefinition } from './rawDefinition';
import { SettingsDialog } from './SettingsDialog';
import { FlowNode, type CanvasNode } from './FlowNode';
import { canvasGraph, withoutNodes } from './canvasGraph';
import { useWorkflowHistory } from './useWorkflowHistory';
import { useBoxZoom } from './useBoxZoom';
import { tidyWorkflow } from './workflowLayout';
import { api } from '../../lib/api';
import styles from './WorkflowEditor.module.css';
const nodeTypes = { workflow: FlowNode };
const zoomKeys = ['Meta', 'Control'];
export function WorkflowEditor({
  workflow,
  workflows,
  onBack,
  onRun,
  onSaved,
  act,
  onDirty,
}: {
  workflow: Workflow;
  workflows: Workflow[];
  onBack: () => void;
  onRun: (workflow: Workflow) => void;
  onSaved: (w: Workflow) => void;
  act: Action;
  onDirty: (dirty: boolean) => void;
}) {
  const [pending, setPending] = useState<'save' | 'publish'>();
  const actionInFlight = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance<CanvasNode> | null>(null);
  const fitAfterTidy = useRef(false);
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const history = useWorkflowHistory({
    draft: workflow.draft,
    name: workflow.name,
    description: workflow.description,
  });
  const { draft, name, description } = history.present;
  useEffect(() => {
    if (!fitAfterTidy.current) return;
    fitAfterTidy.current = false;
    const frame = requestAnimationFrame(() => {
      void flowRef.current?.fitView({ padding: 0.22, duration: 180 });
    });
    return () => cancelAnimationFrame(frame);
  }, [draft]);
  const setDraft = (
    update:
      WorkflowDefinition | ((draft: WorkflowDefinition) => WorkflowDefinition),
  ) =>
    history.change((current) => ({
      ...current,
      draft: typeof update === 'function' ? update(current.draft) : update,
    }));
  const [revision, setRevision] = useState(workflow.draftRevision),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{
    node?: WorkflowNode;
    creating?: boolean;
    batchId?: string;
  }>();
  const graphError = useMemo(() => {
    try {
      validateDefinition(draft);
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  }, [draft]);
  const [view, setView] = useState<'visual' | 'raw'>('visual');
  const boxZoom = useBoxZoom(
    view === 'visual' && !editing && !history.groupStart,
  );
  const [raw, setRaw] = useState('');
  const rawResult = useMemo(
    () => (view === 'raw' ? parseRawDefinition(raw) : undefined),
    [view, raw],
  );
  const rawInvalid = Boolean(rawResult?.error);
  const effectiveDraft = rawResult?.definition ?? draft;
  const switchView = (next: 'visual' | 'raw') => {
    if (next === view) return;
    if (next === 'raw') setRaw(JSON.stringify(draft, null, 2));
    else {
      if (!rawResult?.definition) return;
      setDraft(rawResult.definition);
    }
    setView(next);
  };
  const [saved, setSaved] = useState(
    JSON.stringify({
      draft: workflow.draft,
      name: workflow.name,
      description: workflow.description,
    }),
  );
  const dirty =
    rawInvalid ||
    JSON.stringify({ draft: effectiveDraft, name, description }) !== saved;
  const remoteSnapshot = JSON.stringify({
    draft: workflow.draft,
    name: workflow.name,
    description: workflow.description,
  });
  const remoteChanged =
    workflow.draftRevision > revision ||
    (workflow.draftRevision === revision && remoteSnapshot !== saved);
  const loadLatest = () => {
    history.reset({
      draft: workflow.draft,
      name: workflow.name,
      description: workflow.description,
    });
    setRaw(JSON.stringify(workflow.draft, null, 2));
    setRevision(workflow.draftRevision);
    setSaved(remoteSnapshot);
    setEditing(undefined);
    setSelected(new Set());
    setSelectedEdges(new Set());
  };
  useEffect(() => {
    if (remoteChanged && !dirty && !editing && !pending) loadLatest();
  }, [remoteChanged, dirty, editing, pending, workflow, remoteSnapshot]);
  const perform = (action: 'save' | 'publish', fn: () => Promise<Workflow>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPending(action);
    void act(fn, (w) =>
      action === 'publish'
        ? `Published “${w.name}” as v${w.latestVersion}.`
        : 'Workflow draft saved.',
    ).finally(() => {
      actionInFlight.current = false;
      setPending(undefined);
    });
  };
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const rawUnapplied =
    view === 'raw' &&
    (rawInvalid || JSON.stringify(effectiveDraft) !== JSON.stringify(draft));
  const historyBlocked = Boolean(
    editing || pending || history.groupStart || rawUnapplied,
  );
  const canUndo = !historyBlocked && history.past.length > 0;
  const canRedo = !historyBlocked && history.future.length > 0;
  const travel = (direction: 'undo' | 'redo') => {
    if (direction === 'undo' ? !canUndo : !canRedo) return;
    const target =
      direction === 'undo' ? history.past.at(-1)! : history.future[0];
    history[direction]();
    setRaw(JSON.stringify(target.draft, null, 2));
    setSelected(new Set());
    setSelectedEdges(new Set());
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'z'
      )
        return;
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        (target !== document.body && !editorRef.current?.contains(target)) ||
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        ) ||
        editing
      )
        return;
      event.preventDefault();
      travel(event.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const { nodes, edges } = useMemo(
    () =>
      canvasGraph(draft, {
        collapsed,
        selected,
        selectedEdges,
        onEdit: (node) => setEditing({ node }),
        onAdd: (batchId) => setEditing({ creating: true, batchId }),
        onToggle: (id) =>
          setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
      }),
    [draft, selected, selectedEdges, collapsed],
  );
  const save = async () => {
    if (rawInvalid) throw new Error('Fix the raw JSON before saving.');
    if (!dirty) return workflow;
    if (remoteChanged)
      throw new Error('Load the latest draft before saving your changes.');
    const invalid =
      editorRef.current?.querySelector<HTMLInputElement>(':invalid');
    if (invalid) {
      invalid.reportValidity();
      throw new Error('Fix invalid fields before saving.');
    }
    if (view === 'raw') setDraft(effectiveDraft);
    const w = await api.workflows.update.mutate({
      id: workflow.id,
      name,
      description,
      draft: effectiveDraft,
      draftRevision: revision,
    });
    setRevision(w.draftRevision);
    if (view === 'raw') {
      setRaw((current) =>
        current === raw ? JSON.stringify(w.draft, null, 2) : current,
      );
    }
    setSaved(
      JSON.stringify({
        draft: w.draft,
        name: w.name,
        description: w.description,
      }),
    );
    onSaved(w);
    return w;
  };
  const connect = (c: Connection) =>
    setDraft((d) => ({
      ...d,
      edges: [
        ...d.edges.filter(
          (e) =>
            !(
              e.source === c.source && e.port === (c.sourceHandle ?? 'default')
            ),
        ),
        {
          id: crypto.randomUUID(),
          source: c.source,
          target: c.target,
          port: (c.sourceHandle ?? 'default') as WorkflowEdge['port'],
          targetHandle: (c.targetHandle ??
            'default') as WorkflowEdge['targetHandle'],
        },
      ],
    }));
  return (
    <div ref={editorRef} className={styles.editor}>
      <header className={styles.header}>
        <Button variant="ghost" onClick={onBack} aria-label="Back to workflows">
          <ArrowLeft />
        </Button>
        <div className={styles.title}>
          <span>WORKFLOW EDITOR</span>
          <strong>{name}</strong>
        </div>
        <span className={styles.saved}>
          {dirty
            ? 'Unsaved changes'
            : `Draft saved · ${workflow.latestVersion ? `v${workflow.latestVersion} published` : 'unpublished'}`}
        </span>
        <div className="actions">
          <Button
            variant="ghost"
            disabled={!canUndo}
            aria-label="Undo"
            onClick={() => travel('undo')}
            title={
              rawUnapplied
                ? 'Apply or discard raw changes before undoing workflow edits'
                : 'Undo (Ctrl/Command+Z)'
            }
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            disabled={!canRedo}
            aria-label="Redo"
            onClick={() => travel('redo')}
            title={
              rawUnapplied
                ? 'Apply or discard raw changes before redoing workflow edits'
                : 'Redo (Ctrl/Command+Shift+Z)'
            }
          >
            <Redo2 />
          </Button>
          <Button
            onClick={() => perform('save', save)}
            disabled={!dirty || rawInvalid || remoteChanged || Boolean(pending)}
          >
            <Save />
            {pending === 'save' ? 'Saving…' : 'Save draft'}
          </Button>
          <Button
            disabled={
              rawInvalid ||
              Boolean(rawResult?.publishError) ||
              (view === 'visual' && Boolean(graphError)) ||
              remoteChanged ||
              Boolean(pending)
            }
            onClick={() =>
              perform('publish', async () => {
                await save();
                const published = await api.workflows.publish.mutate({
                  id: workflow.id,
                });
                onSaved(published);
                return published;
              })
            }
          >
            <Upload />
            {pending === 'publish' ? 'Publishing…' : 'Publish version'}
          </Button>
          <Button
            variant="primary"
            disabled={
              !workflow.latestVersion || workflow.archived || Boolean(pending)
            }
            onClick={() => onRun(workflow)}
          >
            <Play />
            Run v{workflow.latestVersion || '—'}
          </Button>
        </div>
      </header>
      {remoteChanged && (dirty || editing) && !pending && (
        <div role="alert" className={styles.conflict}>
          <span>
            This workflow changed elsewhere. Your edits are still here. Load the
            latest draft before saving or publishing.
          </span>
          <Button
            onClick={() => {
              if (
                window.confirm(
                  'Discard your local edits and load the latest draft?',
                )
              )
                loadLatest();
            }}
          >
            Load latest draft
          </Button>
        </div>
      )}
      <div className={styles.body}>
        <div
          ref={boxZoom.containerRef}
          {...boxZoom.handlers}
          className={`${styles.canvasWrap} ${boxZoom.active ? styles.boxZoomReady : ''}`}
        >
          <div className={styles.canvasToolbar}>
            <div
              className={styles.viewToggle}
              role="group"
              aria-label="Workflow view"
            >
              <Button
                aria-pressed={view === 'visual'}
                variant={view === 'visual' ? 'primary' : 'ghost'}
                disabled={rawInvalid}
                onClick={() => switchView('visual')}
              >
                Visual
              </Button>
              <Button
                aria-pressed={view === 'raw'}
                variant={view === 'raw' ? 'primary' : 'ghost'}
                onClick={() => switchView('raw')}
              >
                Raw
              </Button>
            </div>
            {view === 'visual' ? (
              <>
                <Button onClick={() => setEditing({ creating: true })}>
                  <Plus />
                  Add node
                </Button>
                <Button variant="ghost" onClick={() => setEditing({})}>
                  <Settings2 />
                  Workflow settings
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={rawInvalid}
                  onClick={() =>
                    setRaw(JSON.stringify(rawResult!.definition, null, 2))
                  }
                >
                  Format JSON
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setRaw(JSON.stringify(draft, null, 2))}
                >
                  Discard raw changes
                </Button>
              </>
            )}
          </div>
          {view === 'raw' ? (
            <div className={styles.rawView}>
              <p className="hint">
                Edit the workflow definition. Unfinished graphs can be saved as
                drafts; publishing requires a valid workflow.
              </p>
              {rawResult?.error && (
                <div role="alert" className={styles.rawError}>
                  Fix these errors before saving or returning to Visual:
                  <pre>{rawResult.error}</pre>
                </div>
              )}
              {rawResult?.publishError && (
                <div role="status" className={styles.rawWarning}>
                  Draft can be saved. Before publishing:{' '}
                  {rawResult.publishError}
                </div>
              )}
              <CodeEditor
                label="Workflow JSON"
                language="json"
                value={raw}
                onChange={setRaw}
                fullHeight
              />
            </div>
          ) : (
            <>
              <ReactFlow
                onInit={(instance) => {
                  flowRef.current = instance;
                  boxZoom.onInit(instance);
                }}
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodeDragStart={history.begin}
                onNodeDragStop={history.end}
                onSelectionDragStart={history.begin}
                onSelectionDragStop={history.end}
                onBeforeDelete={async ({
                  nodes: deletingNodes,
                  edges: deletingEdges,
                }) => {
                  const nodeIds = new Set(
                    deletingNodes
                      .filter((n) => n.deletable !== false)
                      .map((n) => n.id),
                  );
                  const edgeIds = new Set(deletingEdges.map((e) => e.id));
                  setDraft((d) => {
                    const retained = withoutNodes(d, nodeIds);
                    return {
                      ...retained,
                      edges: retained.edges.filter((e) => !edgeIds.has(e.id)),
                    };
                  });
                  setSelected(new Set());
                  setSelectedEdges(new Set());
                  return false;
                }}
                onNodesChange={(changes) => {
                  const next = applyNodeChanges(changes, nodes);
                  if (
                    changes.some(
                      (c) => c.type === 'select' || c.type === 'remove',
                    )
                  )
                    setSelected(
                      new Set(next.filter((n) => n.selected).map((n) => n.id)),
                    );
                  if (
                    !changes.some(
                      (c) => c.type === 'position' || c.type === 'remove',
                    )
                  )
                    return;
                  setDraft((d) => {
                    const retained = withoutNodes(
                      d,
                      new Set(
                        changes
                          .filter((c) => c.type === 'remove')
                          .map((c) => c.id),
                      ),
                    );
                    return {
                      ...retained,
                      nodes: retained.nodes.map((n) => {
                        const change = changes.find(
                          (c) => c.type === 'position' && c.id === n.id,
                        );
                        return change?.type === 'position' && change.position
                          ? { ...n, position: change.position }
                          : n;
                      }),
                    };
                  });
                }}
                onEdgesChange={(changes) => {
                  const next = applyEdgeChanges(changes, edges);
                  setSelectedEdges(
                    new Set(next.filter((e) => e.selected).map((e) => e.id)),
                  );
                  if (changes.every((c) => c.type === 'select')) return;
                  setDraft((d) => ({
                    ...d,
                    edges: applyEdgeChanges(changes, canvasGraph(d).edges).map(
                      (e) => ({
                        id: e.id,
                        source: e.source,
                        target: e.target,
                        port: (e.sourceHandle ??
                          'default') as WorkflowEdge['port'],
                        targetHandle: (e.targetHandle ??
                          'default') as WorkflowEdge['targetHandle'],
                      }),
                    ),
                  }));
                }}
                onConnect={connect}
                isValidConnection={(c) => {
                  const source = draft.nodes.find((n) => n.id === c.source);
                  const target = draft.nodes.find((n) => n.id === c.target);
                  return Boolean(
                    source &&
                    source.kind !== 'exit' &&
                    target &&
                    target.kind !== 'entry' &&
                    !(c.sourceHandle === 'item' && c.targetHandle === 'end') &&
                    (c.targetHandle !== 'end' || target.kind === 'batch') &&
                    (c.sourceHandle === 'item' ? source.id : source.batchId) ===
                      (c.targetHandle === 'end' ? target.id : target.batchId),
                  );
                }}
                onNodeDoubleClick={(_, n) => {
                  if (boxZoom.active) return;
                  setSelected(new Set([n.id]));
                  setEditing({ node: n.data.node });
                }}
                panOnScroll={!boxZoom.active}
                zoomOnScroll={!boxZoom.active}
                zoomOnPinch={!boxZoom.active}
                zoomActivationKeyCode={zoomKeys}
                selectionOnDrag={!boxZoom.active}
                selectionKeyCode={boxZoom.active ? null : 'Shift'}
                panActivationKeyCode={boxZoom.active ? null : 'Space'}
                nodesDraggable={!boxZoom.active}
                nodesConnectable={!boxZoom.active}
                elementsSelectable={!boxZoom.active}
                panOnDrag={false}
                zoomOnDoubleClick={false}
                onPaneClick={() => setSelected(new Set())}
                fitView
                fitViewOptions={{ padding: 0.22 }}
                minZoom={0.25}
                maxZoom={1.5}
                colorMode="dark"
                deleteKeyCode={
                  editing || boxZoom.active ? null : ['Backspace', 'Delete']
                }
              >
                <Background color="var(--canvas-dot)" gap={22} size={1} />
                <Controls showInteractive={false}>
                  <ControlButton
                    aria-label="Tidy"
                    disabled={Boolean(
                      editing ||
                      pending ||
                      history.groupStart ||
                      boxZoom.active,
                    )}
                    title="Tidy: Arrange the workflow and Batch contents. Undo to restore the previous layout."
                    onClick={() => {
                      const next = tidyWorkflow(draft);
                      if (JSON.stringify(next) === JSON.stringify(draft)) {
                        void flowRef.current?.fitView({
                          padding: 0.22,
                          duration: 180,
                        });
                        return;
                      }
                      fitAfterTidy.current = true;
                      setDraft(next);
                    }}
                  >
                    <WandSparkles />
                  </ControlButton>
                </Controls>
                <MiniMap
                  style={{ width: 125, height: 85 }}
                  nodeColor="var(--accent)"
                  maskColor="#141418bb"
                />
              </ReactFlow>
              {boxZoom.box && (
                <div
                  aria-hidden="true"
                  className={styles.zoomBox}
                  style={{
                    left: boxZoom.box.x,
                    top: boxZoom.box.y,
                    width: boxZoom.box.width,
                    height: boxZoom.box.height,
                  }}
                />
              )}
              <div className={styles.canvasFooter}>
                <span>
                  {draft.nodes.length} nodes <b>·</b> {draft.edges.length}{' '}
                  connections
                </span>
                <span
                  role={graphError ? 'status' : undefined}
                  title={graphError}
                >
                  {graphError
                    ? `Before publishing: ${graphError}`
                    : 'Double-click to edit · Drag to arrange · Hold Z and drag to zoom'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
      {editing && (
        <SettingsDialog
          node={editing.node}
          creating={editing.creating}
          parentBatchId={editing.batchId}
          name={name}
          description={description}
          definition={draft}
          workflows={workflows}
          onClose={() => setEditing(undefined)}
          onApply={(next) => {
            history.change(() => ({
              name: next.name,
              description: next.description,
              draft: next.definition,
            }));
            if (editing.creating) {
              const id = next.definition.nodes.at(-1)?.id;
              setSelected(new Set(id ? [id] : []));
            }
            setEditing(undefined);
          }}
          onDelete={
            editing.node && !['entry', 'exit'].includes(editing.node.kind)
              ? () => {
                  const id = editing.node!.id;
                  setDraft((d) => withoutNodes(d, new Set([id])));
                  setSelected(new Set());
                  setEditing(undefined);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
