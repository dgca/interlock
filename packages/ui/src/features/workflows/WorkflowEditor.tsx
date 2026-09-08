import type { Action } from '../../lib/useActionFeedback';
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
import { ArrowLeft, Play, Save, Plus, Upload, Settings2 } from 'lucide-react';
import {
  type Workflow,
  type WorkflowNode,
  type WorkflowDefinition,
} from '@interlock/core';
import { Button } from '../../components/Button/Button';
import { CodeEditor } from '../../components/CodeEditor/CodeEditor';
import { parseRawDefinition } from './rawDefinition';
import { SettingsDialog } from './SettingsDialog';
import { FlowNode, type CanvasNode } from './FlowNode';
import { api } from '../../lib/api';
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
  act: Action;
  onDirty: (dirty: boolean) => void;
}) {
  const [pending, setPending] = useState<'save' | 'publish'>();
  const actionInFlight = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const [measurements, setMeasurements] = useState<
    Record<string, { width?: number; height?: number }>
  >({});
  const [rootDraft, setRootDraft] = useState(workflow.draft),
    [name, setName] = useState(workflow.name),
    [description, setDescription] = useState(workflow.description),
    [revision, setRevision] = useState(workflow.draftRevision),
    [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<{
    node?: WorkflowNode;
    creating?: boolean;
  }>();
  const [scope, setScope] = useState<string[]>([]);
  const scopes = [rootDraft];
  const scopeLabels: string[] = [];
  for (const id of scope) {
    const node = scopes.at(-1)!.nodes.find((n) => n.id === id);
    if (node?.kind !== 'batch') break;
    scopes.push(node.body);
    scopeLabels.push(node.label);
  }
  const draft = scopes.at(-1)!;
  const setDraft = (
    update:
      WorkflowDefinition | ((d: WorkflowDefinition) => WorkflowDefinition),
  ) => {
    setRootDraft((root) => {
      const replace = (
        d: WorkflowDefinition,
        depth: number,
      ): WorkflowDefinition => {
        if (depth === scope.length)
          return typeof update === 'function' ? update(d) : update;
        return {
          ...d,
          nodes: d.nodes.map((n) =>
            n.id === scope[depth] && n.kind === 'batch'
              ? { ...n, body: replace(n.body, depth + 1) }
              : n,
          ),
        };
      };
      return replace(root, 0);
    });
  };
  const navigateScope = (path: string[]) => {
    setScope(path);
    setSelected(undefined);
    setEditing(undefined);
    setMeasurements({});
  };
  const [view, setView] = useState<'visual' | 'raw'>('visual');
  const [raw, setRaw] = useState('');
  const rawResult = useMemo(
    () => (view === 'raw' ? parseRawDefinition(raw) : undefined),
    [view, raw],
  );
  const rawInvalid = Boolean(rawResult?.error);
  const effectiveDraft = rawResult?.definition ?? rootDraft;
  const switchView = (next: 'visual' | 'raw') => {
    if (next === view) return;
    if (next === 'raw') setRaw(JSON.stringify(rootDraft, null, 2));
    else {
      if (!rawResult?.definition) return;
      setRootDraft(rawResult.definition);
      navigateScope([]);
      setMeasurements({});
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
    setRootDraft(workflow.draft);
    navigateScope([]);
    setRaw(JSON.stringify(workflow.draft, null, 2));
    setName(workflow.name);
    setDescription(workflow.description);
    setRevision(workflow.draftRevision);
    setSaved(remoteSnapshot);
    setMeasurements({});
    setEditing(undefined);
    setSelected(undefined);
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
  const nodes: CanvasNode[] = useMemo(
    () =>
      draft.nodes.map((n) => ({
        id: n.id,
        type: 'workflow',
        width: 220,
        height: n.kind === 'batch' ? 150 : 116,
        deletable: n.kind !== 'entry' && n.kind !== 'exit',
        position: n.position,
        measured: measurements[n.id],
        data: {
          node: n,
          onEdit: () => setEditing({ node: n }),
          onOpen:
            n.kind === 'batch'
              ? () => navigateScope([...scope, n.id])
              : undefined,
        },
        selected: n.id === selected,
      })),
    [draft.nodes, selected, measurements, scope],
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
    const w = await api.workflows.update.mutate({
      id: workflow.id,
      name,
      description,
      draft: effectiveDraft,
      draftRevision: revision,
    });
    setRevision(w.draftRevision);
    if (view === 'raw') {
      setRootDraft(w.draft);
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
          port: (c.sourceHandle ?? 'default') as 'default',
        },
      ],
    }));
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
        <div className={styles.canvasWrap}>
          <div className={styles.canvasToolbar}>
            {view === 'visual' && scope.length > 0 && (
              <>
                <Button onClick={() => navigateScope(scope.slice(0, -1))}>
                  Back to parent
                </Button>
                <span aria-label="Inline workflow scope">
                  {name} / {scopeLabels.join(' / ')} · Each item → Item result
                </span>
              </>
            )}
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
                  onClick={() => setRaw(JSON.stringify(rootDraft, null, 2))}
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
                key={JSON.stringify(scope)}
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={(changes) => {
                  const next = applyNodeChanges(changes, nodes);
                  if (changes.some((c) => c.type === 'dimensions'))
                    setMeasurements(
                      Object.fromEntries(
                        next.map((n) => [n.id, n.measured ?? {}]),
                      ),
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
                onNodeDoubleClick={(_, n) => {
                  setSelected(n.id);
                  setEditing({ node: n.data.node });
                }}
                zoomOnDoubleClick={false}
                onPaneClick={() => setSelected(undefined)}
                fitView
                fitViewOptions={{ padding: 0.22 }}
                minZoom={0.25}
                maxZoom={1.5}
                colorMode="dark"
                deleteKeyCode={editing ? null : ['Backspace', 'Delete']}
              >
                <Background color="var(--canvas-dot)" gap={22} size={1} />
                <Controls showInteractive={false} />
                <MiniMap
                  style={{ width: 125, height: 85 }}
                  nodeColor="var(--accent)"
                  maskColor="#141418bb"
                />
              </ReactFlow>
              <div className={styles.canvasFooter}>
                <span>
                  {draft.nodes.length} nodes <b>·</b> {draft.edges.length}{' '}
                  connections
                </span>
                <span>
                  Double-click to edit · Drag to arrange · Connect handles to
                  route data
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
          inline={scope.length > 0}
          name={scopeLabels.at(-1) ?? name}
          description={scope.length ? '' : description}
          definition={draft}
          workflows={workflows}
          onClose={() => setEditing(undefined)}
          onApply={(next) => {
            if (!scope.length) {
              setName(next.name);
              setDescription(next.description);
            }
            setDraft(next.definition);
            if (editing.creating) setSelected(next.definition.nodes.at(-1)?.id);
            setEditing(undefined);
          }}
          onDelete={
            editing.node && !['entry', 'exit'].includes(editing.node.kind)
              ? () => {
                  const id = editing.node!.id;
                  setDraft((d) => ({
                    ...d,
                    nodes: d.nodes.filter((n) => n.id !== id),
                    edges: d.edges.filter(
                      (e) => e.source !== id && e.target !== id,
                    ),
                  }));
                  setSelected(undefined);
                  setEditing(undefined);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
