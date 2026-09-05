import { useMemo, useState, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type Edge,
  type Connection,
} from '@xyflow/react';
import {
  ArrowLeft,
  Play,
  Save,
  Plus,
  Upload,
  Settings2,
  Download,
} from 'lucide-react';
import {
  nodeSchema,
  type Workflow,
  type WorkflowDefinition,
} from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { JsonEditor } from '../../components/JsonEditor/JsonEditor';
import { NodeInspector } from './NodeInspector';
import { FlowNode, type CanvasNode } from './FlowNode';
import { api, download } from '../../lib/api';
import styles from './WorkflowEditor.module.css';
const nodeTypes = { workflow: FlowNode };
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
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [measurements, setMeasurements] = useState<
    Record<string, { width?: number; height?: number }>
  >({});
  const [draft, setDraft] = useState(workflow.draft),
    [name, setName] = useState(workflow.name),
    [description, setDescription] = useState(workflow.description),
    [revision, setRevision] = useState(workflow.draftRevision),
    [selected, setSelected] = useState<string>(),
    [kind, setKind] = useState('agent');
  const [saved, setSaved] = useState(
    JSON.stringify({
      draft: workflow.draft,
      name: workflow.name,
      description: workflow.description,
    }),
  );
  const dirty = JSON.stringify({ draft, name, description }) !== saved;
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
  const nodes: CanvasNode[] = useMemo(
    () =>
      draft.nodes.map((n) => ({
        id: n.id,
        type: 'workflow',
        width: 220,
        height: 116,
        position: n.position,
        measured: measurements[n.id],
        data: { node: n },
        selected: n.id === selected,
      })),
    [draft.nodes, selected, measurements],
  );
  const edges: Edge[] = useMemo(
    () =>
      draft.edges.map((e) => ({
        ...e,
        sourceHandle: e.port,
        label: e.port === 'default' ? undefined : e.port,
      })),
    [draft.edges],
  );
  const save = async () => {
    const invalid =
      editorRef.current?.querySelector<HTMLInputElement>(':invalid');
    if (invalid) {
      invalid.reportValidity();
      throw new Error('Fix invalid fields before saving.');
    }
    const w = await api.workflows.update.mutate({
      id: workflow.id,
      name,
      description,
      draft,
      draftRevision: revision,
    });
    setRevision(w.draftRevision);
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
          port: (c.sourceHandle ?? 'default') as 'default',
        },
      ],
    }));
  const add = () => {
    const id = crypto.randomUUID();
    const reference = workflows.find((w) => w.latestVersion);
    const node = nodeSchema.parse({
      id,
      kind,
      label: `New ${kind}`,
      position: { x: 150 + draft.nodes.length * 90, y: 360 },
      prompt: 'Describe the assignment.',
      command: 'cat',
      path: '',
      equals: true,
      workflowId: reference?.id ?? 'choose-workflow',
      version: reference?.latestVersion ?? 1,
    });
    setDraft((d) => ({ ...d, nodes: [...d.nodes, node] }));
    setSelected(id);
  };
  const node = draft.nodes.find((n) => n.id === selected);
  return (
    <div ref={editorRef} className={styles.editor}>
      <header className={styles.header}>
        <Button
          variant="ghost"
          onClick={() => {
            if (!dirty || window.confirm('Discard unsaved changes?')) onBack();
          }}
          aria-label="Back to workflows"
        >
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
          <Button onClick={() => void act(save)} disabled={!dirty}>
            <Save />
            Save draft
          </Button>
          <Button
            onClick={() =>
              void act(async () => {
                await save();
                onSaved(
                  await api.workflows.publish.mutate({ id: workflow.id }),
                );
              })
            }
          >
            <Upload />
            Publish version
          </Button>
          <Button
            variant="primary"
            disabled={!workflow.latestVersion || workflow.archived}
            onClick={() => onRun(workflow)}
          >
            <Play />
            Run v{workflow.latestVersion || '—'}
          </Button>
        </div>
      </header>
      <div className={styles.body}>
        <div className={styles.canvasWrap}>
          <div className={styles.canvasToolbar}>
            <select
              aria-label="Node type"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {['agent', 'script', 'condition', 'workflow', 'map'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <Button onClick={add}>
              <Plus />
              Add node
            </Button>
            <Button variant="ghost" onClick={() => setSelected(undefined)}>
              <Settings2 />
              Workflow settings
            </Button>
          </div>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              const next = applyNodeChanges(changes, nodes);
              if (changes.some((c) => c.type === 'dimensions'))
                setMeasurements(
                  Object.fromEntries(next.map((n) => [n.id, n.measured ?? {}])),
                );
              if (
                !changes.some(
                  (c) => c.type === 'position' || c.type === 'remove',
                )
              )
                return;
              setDraft((d) => ({
                ...d,
                nodes: next.map((n) => ({
                  ...n.data.node,
                  position: n.position,
                })),
                edges: d.edges.filter(
                  (e) =>
                    next.some((n) => n.id === e.source) &&
                    next.some((n) => n.id === e.target),
                ),
              }));
            }}
            onEdgesChange={(changes) => {
              const next = applyEdgeChanges(changes, edges);
              setDraft((d) => ({
                ...d,
                edges: next.map((e) => ({
                  id: e.id,
                  source: e.source,
                  target: e.target,
                  port: (e.sourceHandle ?? 'default') as 'default',
                })),
              }));
            }}
            onConnect={connect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(undefined)}
            fitView
            fitViewOptions={{ padding: 0.22 }}
            minZoom={0.25}
            maxZoom={1.5}
            colorMode="dark"
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background color="#333c32" gap={22} size={1} />
            <Controls showInteractive={false} />
            <MiniMap nodeColor="#465d3c" maskColor="#101611bb" />
          </ReactFlow>
          <div className={styles.canvasFooter}>
            <span>
              {draft.nodes.length} nodes <b>·</b> {draft.edges.length}{' '}
              connections
            </span>
            <span>Drag to arrange · Connect handles to route data</span>
          </div>
        </div>
        <aside className={styles.inspector}>
          {node ? (
            <NodeInspector
              key={node.id}
              node={node}
              workflows={workflows}
              onChange={(next) =>
                setDraft((d) => ({
                  ...d,
                  nodes: d.nodes.map((n) => (n.id === next.id ? next : n)),
                }))
              }
              onDelete={() => {
                setDraft((d) => ({
                  ...d,
                  nodes: d.nodes.filter((n) => n.id !== node.id),
                  edges: d.edges.filter(
                    (e) => e.source !== node.id && e.target !== node.id,
                  ),
                }));
                setSelected(undefined);
              }}
            />
          ) : (
            <>
              <div className="inspector-heading">
                <span className="eyebrow">WORKFLOW SETTINGS</span>
                <h2>The procedure</h2>
                <p className="hint">
                  Select a node to edit its assignment and contracts.
                </p>
              </div>
              <div className="inspector-fields">
                <label className="field">
                  <span>Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Description</span>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <JsonEditor
                  label="Workflow input schema"
                  value={draft.inputSchema}
                  onChange={(inputSchema) =>
                    setDraft((d) => ({ ...d, inputSchema }))
                  }
                />
                <JsonEditor
                  label="Workflow output schema"
                  value={draft.outputSchema}
                  onChange={(outputSchema) =>
                    setDraft((d) => ({ ...d, outputSchema }))
                  }
                />
                <label className="field">
                  <span>Maximum steps per run</span>
                  <input
                    type="number"
                    min={2}
                    max={1000}
                    value={draft.maxSteps}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        maxSteps: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <Button
                  onClick={() =>
                    download(`${name}.json`, {
                      name,
                      description,
                      definition: draft,
                    })
                  }
                >
                  <Download />
                  Export workflow
                </Button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
