import {
  ActionIcon,
  Menu,
  Tabs,
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  CodeEditor,
  PageHeader,
  PageTabList,
  SegmentedControl,
} from '../../design-system';

import { WorkflowPauseButton, PauseBanner } from '../pauses/PauseControls';
import type { Action } from '../../lib/useActionFeedback';
import { useBeforeUnloadWarning } from '../../lib/useBeforeUnloadWarning';
import { flushSync } from 'react-dom';
import { WorkflowChildren } from './WorkflowChildren';
import { useMemo, useState, useRef, useEffect, type ReactNode } from 'react';

import { useMergedRef, useResizeObserver } from '@mantine/hooks';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  Play,
  Save,
  Plus,
  Upload,
  Settings2,
  Undo2,
  Redo2,
  MoreHorizontal,
  Trash2,
  ChartNoAxesColumn,
} from 'lucide-react';
import {
  validateDefinition,
  applyWorkflowPositions,
  sameWorkflowContent,
  type Workflow,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowDefinition,
} from '@interlock/core';

import { parseRawDefinition } from './rawDefinition';
import { SettingsDialog, type Settings } from './SettingsDialog';
import { DeleteWorkflowDialog } from './DeleteWorkflowDialog';
import { PublishReviewDialog } from './PublishReviewDialog';
import { FlowNode, type CanvasNode } from './FlowNode';
import { RestoreHandleBounds } from './RestoreHandleBounds';
import { LoopEdge } from './LoopEdge';
import { OrthoEdge } from './OrthoEdge';
import { canvasGraph, withoutNodes } from './canvasGraph';
import {
  serializeContentSnapshot,
  changedPositions,
  useWorkflowHistory,
} from './useWorkflowHistory';
import { useWorkflowLayout } from './useWorkflowLayout';
import { useBoxZoom } from './useBoxZoom';
import { canvasNavigation, CanvasZoomBox } from './CanvasNavigation';
import navigationStyles from './CanvasNavigation.module.css';
import { tidyWorkflow } from '@interlock/core/layout';
import { tidyWorkflowElk } from './workflowLayoutElk';
import { TidyControl } from './TidyControl';
import { api } from '../../lib/api';
import styles from './WorkflowEditor.module.css';
// Keep the workflow toolbar and lower canvas controls outside fitted node bounds.
const editorFitView = {
  padding: { top: '82px', right: '24px', bottom: '162px', left: '24px' },
} as const;
const nodeTypes = { workflow: FlowNode };
const edgeTypes = { loop: LoopEdge, ortho: OrthoEdge };
export function WorkflowEditor({
  workflow,
  workflows,
  prompts = [],
  onBack,
  onRun,
  onSaved,
  act,
  onDirty,
  onDeleted = onBack,
  section = 'editor',
  onSectionChange,
  runsView,
  onOpenWorkflow,
  onReport,
}: {
  workflow: Workflow & { layoutRevision?: number };
  workflows: Workflow[];
  prompts?: import('@interlock/core').SavedPrompt[];
  onBack: () => void;
  onRun: (workflow: Workflow) => void;
  onSaved: (w: Workflow) => void;
  act: Action;
  onDirty: (dirty: boolean) => void;
  onDeleted?: () => void;
  section?: 'editor' | 'runs' | 'children';
  onSectionChange?: (section: 'editor' | 'runs' | 'children') => void;
  onOpenWorkflow?: (id: string) => void;
  onReport?: () => void;
  runsView?: ReactNode;
}) {
  const owner = workflows.find((w) => w.id === workflow.ownerWorkflowId);
  const hasChildren = workflows.some((w) => w.ownerWorkflowId === workflow.id);
  const [deleting, setDeleting] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [review, setReview] = useState<{
    draft: WorkflowDefinition;
    revision: number;
    version: number;
  }>();
  const [navigationPending, setNavigationPending] = useState(false);
  const [pending, setPending] = useState<'save' | 'publish'>();
  const actionInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const editorRef = useRef<HTMLDivElement>(null);
  const [measureEditor, { width: editorWidth }] =
    useResizeObserver<HTMLDivElement>();
  const editorRootRef = useMergedRef(editorRef, measureEditor);
  const compactHeader = editorWidth > 0 && editorWidth < 900;
  const iconOnlyHeader = editorWidth > 0 && editorWidth < 480;
  const flowRef = useRef<ReactFlowInstance<CanvasNode> | null>(null);
  const fitAfterTidy = useRef(false);
  const [arranging, setArranging] = useState(false);
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  const [hovered, setHovered] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const layout = useWorkflowLayout(workflow);
  const dragging = useRef<WorkflowDefinition | undefined>(undefined);
  const history = useWorkflowHistory({
    draft: applyWorkflowPositions(workflow.draft, layout.positions),
    name: workflow.name,
    description: workflow.description,
  });
  const { draft, name, description } = history.present;
  useEffect(() => {
    if (!fitAfterTidy.current) return;
    fitAfterTidy.current = false;
    const frame = requestAnimationFrame(() => {
      void flowRef.current?.fitView({ ...editorFitView, duration: 180 });
    });
    return () => cancelAnimationFrame(frame);
  }, [draft]);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const setDraft = (
    update:
      WorkflowDefinition | ((draft: WorkflowDefinition) => WorkflowDefinition),
  ) => {
    const before = latestDraft.current;
    const next = typeof update === 'function' ? update(before) : update;
    latestDraft.current = next;
    history.change((current) => ({ ...current, draft: next }));
    if (!dragging.current) layout.update(changedPositions(before, next));
  };
  useEffect(() => {
    if (!dragging.current) history.layout(layout.positions);
  }, [layout.positions]);
  const beginDrag = () => {
    dragging.current = latestDraft.current;
    history.begin();
  };
  const endDrag = () => {
    const before = dragging.current;
    dragging.current = undefined;
    history.end();
    if (before) layout.update(changedPositions(before, latestDraft.current));
  };
  const applyTidy = (before: WorkflowDefinition, next: WorkflowDefinition) => {
    if (JSON.stringify(next) === JSON.stringify(before)) {
      void flowRef.current?.fitView({ ...editorFitView, duration: 180 });
      return;
    }
    fitAfterTidy.current = true;
    setDraft(next);
  };
  const [revision, setRevision] = useState(workflow.draftRevision),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const workflowActions = useRef<HTMLButtonElement>(null);
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
    section === 'editor' &&
      view === 'visual' &&
      !editing &&
      !deleting &&
      !history.groupStart,
  );
  const [raw, setRaw] = useState('');
  const [rawBaseline, setRawBaseline] = useState('');
  const rawResult = useMemo(
    () => (view === 'raw' ? parseRawDefinition(raw) : undefined),
    [view, raw],
  );
  const rawBaselineDefinition = useMemo(
    () => parseRawDefinition(rawBaseline).definition,
    [rawBaseline],
  );
  const rawEdited =
    view === 'raw' &&
    raw !== rawBaseline &&
    (!rawResult?.definition ||
      !rawBaselineDefinition ||
      !sameWorkflowContent(rawResult.definition, rawBaselineDefinition) ||
      Object.keys(changedPositions(rawBaselineDefinition, rawResult.definition))
        .length > 0);
  const rawInvalid = Boolean(rawResult?.error);
  const effectiveDraft = rawResult?.definition ?? draft;
  const canTidy = Boolean(
    section === 'editor' &&
    view === 'visual' &&
    !editing &&
    !deleting &&
    !review &&
    !pending &&
    !navigationPending &&
    !history.groupStart &&
    !boxZoom.active,
  );
  const tidyRequest = useRef(0);
  const cancelTidy = () => {
    tidyRequest.current += 1;
    setArranging(false);
  };
  // Invalidate results when another interaction or a new draft takes over.
  useEffect(() => {
    cancelTidy();
  }, [draft, canTidy]);
  const tidyElk = async () => {
    const before = draft;
    const request = ++tidyRequest.current;
    setArranging(true);
    const current = () =>
      mounted.current &&
      tidyRequest.current === request &&
      latestDraft.current === before;
    try {
      const next = await tidyWorkflowElk(before);
      if (current()) applyTidy(before, next);
    } catch (error) {
      if (current()) void act(() => Promise.reject(error));
    } finally {
      if (mounted.current && tidyRequest.current === request)
        setArranging(false);
    }
  };
  const switchView = (next: 'visual' | 'raw') => {
    if (next === view) return;
    if (pending || (next === 'visual' && rawEdited)) return;
    cancelTidy();
    if (next === 'visual' && rawResult?.definition)
      setDraft(layout.apply(rawResult.definition));
    if (next === 'raw') {
      const text = JSON.stringify(draft, null, 2);
      setRaw(text);
      setRawBaseline(text);
    }
    setView(next);
  };
  const [saved, setSaved] = useState(
    serializeContentSnapshot({
      draft: workflow.draft,
      name: workflow.name,
      description: workflow.description,
    }),
  );
  const contentDirty =
    rawInvalid ||
    serializeContentSnapshot({ draft: effectiveDraft, name, description }) !==
      saved;
  const dirty = contentDirty || rawEdited;
  const remoteSnapshot = serializeContentSnapshot({
    draft: workflow.draft,
    name: workflow.name,
    description: workflow.description,
  });
  const remoteChanged =
    workflow.draftRevision > revision ||
    (workflow.draftRevision === revision && remoteSnapshot !== saved);
  const loadLatest = () => {
    history.reset({
      draft: layout.apply(workflow.draft),
      name: workflow.name,
      description: workflow.description,
    });
    const next = layout.apply(workflow.draft);
    setRaw(JSON.stringify(next, null, 2));
    setRawBaseline(JSON.stringify(next, null, 2));
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
  useBeforeUnloadWarning(dirty || layout.saving || Boolean(layout.error));
  const historyBlocked = Boolean(
    editing ||
    deleting ||
    pending ||
    history.groupStart ||
    rawEdited ||
    section !== 'editor',
  );
  const canUndo = !historyBlocked && history.past.length > 0;
  const canRedo = !historyBlocked && history.future.length > 0;
  const travel = (direction: 'undo' | 'redo') => {
    if (direction === 'undo' ? !canUndo : !canRedo) return;
    const target =
      direction === 'undo' ? history.past.at(-1)! : history.future[0];
    const before = latestDraft.current;
    latestDraft.current = target.draft;
    history[direction]();
    layout.update(changedPositions(before, target.draft));
    setRaw(JSON.stringify(target.draft, null, 2));
    setRawBaseline(JSON.stringify(target.draft, null, 2));
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
          'input:not([type="radio"]), textarea, select, [contenteditable]:not([contenteditable="false"])',
        ) ||
        editing ||
        deleting ||
        section !== 'editor'
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
        hovered,
        onEdit: (node) => setEditing({ node }),
        onFocusNode: (id) => {
          setSelected(new Set([id]));
          setSelectedEdges(new Set());
          void flowRef.current?.fitView({
            nodes: [{ id }],
            padding: 0.5,
            maxZoom: 1,
            duration: 180,
          });
        },
        onOpenWorkflow,
        workflows,
        onAdd: (batchId) => setEditing({ creating: true, batchId }),
        onToggle: (id) =>
          setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          }),
      }),
    [
      draft,
      selected,
      selectedEdges,
      hovered,
      collapsed,
      workflows,
      onOpenWorkflow,
    ],
  );
  const save = async () => {
    if (rawInvalid) throw new Error('Fix the raw JSON before saving.');
    await layout.flush();
    if (!dirty) return workflow;
    if (remoteChanged)
      throw new Error('Load the latest draft before saving your changes.');
    const invalid =
      editorRef.current?.querySelector<HTMLInputElement>(':invalid');
    if (invalid) {
      invalid.reportValidity();
      throw new Error('Fix invalid fields before saving.');
    }
    let w = workflow;
    if (contentDirty) {
      w = await api.workflows.update.mutate({
        id: workflow.id,
        name,
        description,
        draft: effectiveDraft,
        draftRevision: revision,
        layout: 'preserve',
      });
      layout.receive(w);
      setRevision(w.draftRevision);
      setSaved(
        serializeContentSnapshot({
          draft: w.draft,
          name: w.name,
          description: w.description,
        }),
      );
      onSaved(w);
    }
    if (view === 'raw') {
      const positions = rawBaselineDefinition
        ? changedPositions(rawBaselineDefinition, effectiveDraft)
        : {};
      const next = applyWorkflowPositions(
        layout.apply(contentDirty ? w.draft : effectiveDraft),
        positions,
      );
      history.change((current) => ({ ...current, draft: next }));
      layout.update(positions);
      await layout.flush();
      setRawBaseline(JSON.stringify(next, null, 2));
      setRaw((current) =>
        current === raw ? JSON.stringify(next, null, 2) : current,
      );
    }
    return w;
  };
  const createChild = async (
    childName: string,
    settings: Settings,
    nodeId?: string,
  ) => {
    if (actionInFlight.current)
      throw new Error('Wait for the current save to finish.');
    if (rawEdited || rawInvalid)
      throw new Error('Save or discard Raw changes before creating a child.');
    if (remoteChanged)
      throw new Error('Load the latest draft before creating a child.');
    actionInFlight.current = true;
    setNavigationPending(true);
    setPending('save');
    try {
      const result = await api.workflows.createChild.mutate({
        ownerWorkflowId: workflow.id,
        name: childName,
        parentDraftRevision: revision,
        parent: settings,
        nodeId,
      });
      if (!mounted.current) return;
      flushSync(() => {
        history.reset({
          name: result.parent.name,
          description: result.parent.description,
          draft: result.parent.draft,
        });
        setRevision(result.parent.draftRevision);
        setSaved(
          serializeContentSnapshot({
            draft: result.parent.draft,
            name: result.parent.name,
            description: result.parent.description,
          }),
        );
        setEditing(undefined);
        onSaved(result.parent);
        onSaved(result.child);
        onDirty(false);
      });
      onOpenWorkflow?.(result.child.id);
    } finally {
      actionInFlight.current = false;
      setNavigationPending(false);
      setPending(undefined);
    }
  };
  const useChildVersion = async (nodeId: string) => {
    if (!owner) throw new Error('Parent workflow not found');
    setNavigationPending(true);
    try {
      const parent = await api.workflows.useChildVersion.mutate({
        id: owner.id,
        childId: workflow.id,
        nodeId,
        version: workflow.latestVersion,
        draftRevision: owner.draftRevision,
      });
      if (!mounted.current) return workflow;
      flushSync(() => {
        onSaved(parent);
        onDirty(false);
      });
      onOpenWorkflow?.(owner.id);
      return workflow;
    } finally {
      setNavigationPending(false);
    }
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
    <div
      ref={editorRootRef}
      className={styles.editor}
      data-compact={compactHeader || undefined}
      data-icon-only={iconOnlyHeader || undefined}
      inert={navigationPending}
    >
      <PageHeader
        title={name}
        onBack={onBack}
        backLabel={owner ? `Back to ${owner.name}` : 'Back to workflows'}
        status={
          <span className={styles.draftStatus} data-dirty={dirty || undefined}>
            {dirty ? 'Unsaved changes' : 'Draft saved'} ·{' '}
            {workflow.latestVersion
              ? `v${workflow.latestVersion} published`
              : 'Unpublished'}
            {layout.saving && <span role="status"> · Saving layout…</span>}
          </span>
        }
        actions={
          <div className={styles.headerActions}>
            <WorkflowPauseButton
              workflowId={workflow.id}
              compact={iconOnlyHeader}
            />
            {section === 'editor' && (
              <>
                {!compactHeader && (
                  <>
                    <Button
                      variant="ghost"
                      disabled={!canUndo}
                      aria-label="Undo"
                      onClick={() => travel('undo')}
                      title={
                        rawEdited
                          ? 'Save or discard raw changes before undoing workflow edits'
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
                        rawEdited
                          ? 'Save or discard raw changes before redoing workflow edits'
                          : 'Redo (Ctrl/Command+Shift+Z)'
                      }
                    >
                      <Redo2 />
                    </Button>
                  </>
                )}
                {view === 'visual' && (
                  <Button
                    className={styles.headerAction}
                    aria-label={pending === 'save' ? 'Saving…' : 'Save draft'}
                    title={pending === 'save' ? 'Saving…' : 'Save draft'}
                    onClick={() => perform('save', save)}
                    disabled={
                      !dirty || rawInvalid || remoteChanged || Boolean(pending)
                    }
                  >
                    <Save />
                    <span>
                      {pending === 'save'
                        ? 'Saving…'
                        : compactHeader
                          ? 'Save'
                          : 'Save draft'}
                    </span>
                  </Button>
                )}
                <Button
                  className={styles.headerAction}
                  aria-label="Review & publish"
                  title="Review & publish"
                  disabled={
                    rawInvalid ||
                    Boolean(rawResult?.publishError) ||
                    (view === 'visual' && Boolean(graphError)) ||
                    remoteChanged ||
                    Boolean(pending)
                  }
                  onClick={() =>
                    setReview({
                      draft: structuredClone(effectiveDraft),
                      revision: workflow.draftRevision,
                      version: workflow.latestVersion,
                    })
                  }
                >
                  <Upload />
                  <span>{compactHeader ? 'Publish' : 'Review & publish'}</span>
                </Button>
              </>
            )}
            <Menu position="bottom-end" width={190}>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="Workflow actions"
                  ref={workflowActions}
                  disabled={Boolean(pending)}
                >
                  <MoreHorizontal size={19} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {onReport && (
                  <Menu.Item
                    leftSection={<ChartNoAxesColumn size={14} />}
                    onClick={onReport}
                  >
                    Performance & cost report
                  </Menu.Item>
                )}
                {section === 'editor' && compactHeader && (
                  <>
                    <Menu.Item
                      leftSection={<Undo2 size={14} />}
                      disabled={!canUndo}
                      title={
                        rawEdited
                          ? 'Save or discard raw changes before undoing workflow edits'
                          : 'Undo (Ctrl/Command+Z)'
                      }
                      onClick={() => travel('undo')}
                    >
                      Undo
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<Redo2 size={14} />}
                      disabled={!canRedo}
                      title={
                        rawEdited
                          ? 'Save or discard raw changes before redoing workflow edits'
                          : 'Redo (Ctrl/Command+Shift+Z)'
                      }
                      onClick={() => travel('redo')}
                    >
                      Redo
                    </Menu.Item>
                    <Menu.Divider />
                  </>
                )}
                <Menu.Item
                  leftSection={<Settings2 size={14} />}
                  disabled={rawEdited}
                  title={
                    rawEdited
                      ? 'Save or discard raw changes before editing settings'
                      : undefined
                  }
                  onClick={() => setEditing({})}
                >
                  Workflow settings
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<Trash2 size={14} />}
                  onClick={() => setDeleting(true)}
                >
                  Delete workflow
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Button
              className={styles.headerAction}
              aria-label={`Run v${workflow.latestVersion || '—'}`}
              title={`Run v${workflow.latestVersion || '—'}`}
              variant="primary"
              disabled={
                !workflow.latestVersion ||
                workflow.archived ||
                Boolean(owner?.archived) ||
                Boolean(pending)
              }
              onClick={() => onRun(workflow)}
            >
              <Play />
              <span>Run v{workflow.latestVersion || '—'}</span>
            </Button>
          </div>
        }
      />
      <PauseBanner workflowId={workflow.id} />
      {layout.error && (
        <div role="alert" className={styles.conflict}>
          <span>Layout could not be saved. {layout.error}</span>
          <Button disabled={layout.saving} onClick={() => void layout.retry()}>
            Retry layout save
          </Button>
        </div>
      )}
      {owner && (
        <div className={styles.conflict}>
          <span>
            Child of {owner.name}. Publish here, then select a version for the
            parent.
          </span>
          {workflow.latestVersion > 0 &&
            owner.draft.nodes
              .filter(
                (n) =>
                  n.kind === 'workflow' &&
                  n.workflowId === workflow.id &&
                  n.version !== workflow.latestVersion,
              )
              .map((node) => (
                <Button
                  key={node.id}
                  disabled={dirty || Boolean(pending)}
                  title={
                    dirty ? 'Save or discard child edits first' : undefined
                  }
                  onClick={() =>
                    perform('save', () => useChildVersion(node.id))
                  }
                >
                  Use v{workflow.latestVersion} in {node.label}
                </Button>
              ))}
          <Button onClick={() => onOpenWorkflow?.(owner.id)}>
            Back to {owner.name}
          </Button>
        </div>
      )}
      <Tabs
        className={styles.sections}
        data-canvas-section={section === 'editor' || undefined}
        keepMounted
        keepMountedMode="display-none"
        value={section}
        onChange={(value) =>
          onSectionChange?.(
            value === 'runs'
              ? 'runs'
              : value === 'children'
                ? 'children'
                : 'editor',
          )
        }
      >
        <PageTabList
          label="Workflow sections"
          items={[
            { value: 'editor', label: 'Editor' },
            { value: 'runs', label: 'Runs' },
            ...(!workflow.ownerWorkflowId
              ? [{ value: 'children', label: 'Child workflows' }]
              : []),
          ]}
        />
        {remoteChanged && (dirty || editing) && !pending && (
          <div role="alert" className={styles.conflict}>
            <span>
              This workflow changed elsewhere. Your edits are still here. Load
              the latest draft before saving or publishing.
            </span>
            <Button onClick={() => setConfirmReload(true)}>
              Load latest draft
            </Button>
          </div>
        )}
        <Tabs.Panel value="editor" className={styles.body}>
          <div
            ref={boxZoom.containerRef}
            {...boxZoom.handlers}
            data-raw-view={view === 'raw' || undefined}
            className={`${styles.canvasWrap} ${navigationStyles.viewport} ${boxZoom.active ? navigationStyles.boxZoomReady : ''}`}
          >
            <div className={styles.canvasToolbar}>
              <SegmentedControl
                aria-label="Workflow view"
                value={view}
                disabled={Boolean(pending)}
                title={
                  rawEdited
                    ? 'Save or discard raw changes before returning to Visual'
                    : undefined
                }
                onChange={(next) =>
                  switchView(next === 'raw' ? 'raw' : 'visual')
                }
                data={[
                  { value: 'visual', label: 'Visual', disabled: rawEdited },
                  { value: 'raw', label: 'Raw' },
                ]}
              />
              {view === 'visual' ? (
                <>
                  <Button onClick={() => setEditing({ creating: true })}>
                    <Plus />
                    Add node
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    disabled={rawInvalid || Boolean(pending)}
                    onClick={() =>
                      setRaw(JSON.stringify(rawResult!.definition, null, 2))
                    }
                  >
                    Format JSON
                  </Button>
                </>
              )}
            </div>
            {view === 'raw' ? (
              <div className={styles.rawView}>
                <p className="hint">
                  Edit the workflow definition. Unfinished graphs can be saved
                  as drafts; publishing requires a valid workflow.
                </p>
                {rawResult?.error && (
                  <div role="alert" className={styles.rawError}>
                    Fix these errors before saving, or discard your raw changes:
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
                <div className={styles.rawActions}>
                  <span>
                    {rawEdited
                      ? 'Save or discard raw changes before returning to Visual.'
                      : 'Save updates the draft. Discard reverts edits made in Raw.'}
                  </span>
                  <Button
                    variant="ghost"
                    disabled={!rawEdited || Boolean(pending)}
                    onClick={() => {
                      const baseline =
                        parseRawDefinition(rawBaseline).definition;
                      const text = baseline
                        ? JSON.stringify(layout.apply(baseline), null, 2)
                        : rawBaseline;
                      setRaw(text);
                      setRawBaseline(text);
                    }}
                  >
                    Discard
                  </Button>
                  <Button
                    variant="primary"
                    disabled={
                      !dirty || rawInvalid || remoteChanged || Boolean(pending)
                    }
                    onClick={() => perform('save', save)}
                  >
                    <Save />
                    {pending === 'save' ? 'Saving…' : 'Save'}
                  </Button>
                </div>
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
                  edgeTypes={edgeTypes}
                  onNodeDragStart={beginDrag}
                  onNodeDragStop={endDrag}
                  onSelectionDragStart={beginDrag}
                  onSelectionDragStop={endDrag}
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
                        new Set(
                          next.filter((n) => n.selected).map((n) => n.id),
                        ),
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
                      edges: applyEdgeChanges(
                        changes,
                        canvasGraph(d).edges,
                      ).map((e) => ({
                        id: e.id,
                        source: e.source,
                        target: e.target,
                        port: (e.sourceHandle ??
                          'default') as WorkflowEdge['port'],
                        targetHandle: (e.targetHandle ??
                          'default') as WorkflowEdge['targetHandle'],
                      })),
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
                      !(
                        source.kind === 'batch' &&
                        c.sourceHandle === 'item' &&
                        c.targetHandle === 'end'
                      ) &&
                      (c.targetHandle !== 'end' || target.kind === 'batch') &&
                      (source.kind === 'batch' && c.sourceHandle === 'item'
                        ? source.id
                        : source.batchId) ===
                        (c.targetHandle === 'end' ? target.id : target.batchId),
                    );
                  }}
                  onNodeDoubleClick={(_, n) => {
                    if (boxZoom.active) return;
                    setSelected(new Set([n.id]));
                    setEditing({ node: n.data.node });
                  }}
                  {...canvasNavigation(boxZoom.active)}
                  fitViewOptions={editorFitView}
                  selectionOnDrag={!boxZoom.active}
                  selectionKeyCode={boxZoom.active ? null : 'Shift'}
                  nodesDraggable={!boxZoom.active}
                  nodesConnectable={!boxZoom.active}
                  elementsSelectable={!boxZoom.active}
                  elevateEdgesOnSelect
                  onPaneClick={() => setSelected(new Set())}
                  onNodeMouseEnter={(_, n) => setHovered(n.id)}
                  onNodeMouseLeave={(_, n) =>
                    setHovered((current) =>
                      current === n.id ? undefined : current,
                    )
                  }
                  colorMode="dark"
                  deleteKeyCode={
                    editing || boxZoom.active ? null : ['Backspace', 'Delete']
                  }
                >
                  <RestoreHandleBounds active={section === 'editor'} />
                  <Background color="var(--canvas-dot)" gap={22} size={1} />
                  <Controls
                    showInteractive={false}
                    className={navigationStyles.controls}
                    fitViewOptions={editorFitView}
                  >
                    <TidyControl
                      disabled={!canTidy || arranging}
                      arranging={arranging}
                      onTidy={(layout) => {
                        if (!canTidy || arranging) return;
                        if (layout === 'elk') void tidyElk();
                        else applyTidy(draft, tidyWorkflow(draft));
                      }}
                    />
                  </Controls>
                  <MiniMap
                    style={{ width: 125, height: 85 }}
                    nodeColor="var(--accent)"
                    maskColor="color-mix(in srgb, var(--canvas) 75%, transparent)"
                  />
                </ReactFlow>
                <CanvasZoomBox box={boxZoom.box} />
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
        </Tabs.Panel>
        {!workflow.ownerWorkflowId && (
          <Tabs.Panel
            value="children"
            className={`${styles.runsView} ${styles.childListView}`}
          >
            <WorkflowChildren
              workflow={{ ...workflow, draft }}
              workflows={workflows}
              disabled={
                Boolean(pending) || rawEdited || rawInvalid || remoteChanged
              }
              onOpen={(id) => onOpenWorkflow?.(id)}
              onCreate={(childName) =>
                createChild(childName, { name, description, definition: draft })
              }
              act={act}
            />
          </Tabs.Panel>
        )}
        <Tabs.Panel
          value="runs"
          className={`${styles.runsView} ${styles.runListView}`}
        >
          {runsView}
        </Tabs.Panel>
      </Tabs>
      {confirmReload && remoteChanged && (
        <Modal
          title="Load the latest draft?"
          onClose={() => setConfirmReload(false)}
        >
          <ModalBody>
            <p>
              This discards your local edits and opens the latest saved draft.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button onClick={() => setConfirmReload(false)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmReload(false);
                loadLatest();
              }}
            >
              Discard and load draft
            </Button>
          </ModalFooter>
        </Modal>
      )}
      {review && (
        <PublishReviewDialog
          workflowId={workflow.id}
          latestVersion={workflow.latestVersion}
          draft={review.draft}
          pending={pending === 'publish'}
          editorChanged={
            remoteChanged ||
            workflow.draftRevision !== review.revision ||
            workflow.latestVersion !== review.version
          }
          onClose={() => setReview(undefined)}
          onPublish={() => {
            if (
              remoteChanged ||
              rawInvalid ||
              rawResult?.publishError ||
              (view === 'visual' && graphError) ||
              workflow.draftRevision !== review.revision ||
              workflow.latestVersion !== review.version
            )
              return;
            perform('publish', async () => {
              const savedWorkflow = await save();
              setReview((current) =>
                current
                  ? { ...current, revision: savedWorkflow.draftRevision }
                  : current,
              );
              const published = await api.workflows.publish.mutate({
                id: workflow.id,
              });
              onSaved(published);
              setReview(undefined);
              return published;
            });
          }}
        />
      )}
      {deleting && (
        <DeleteWorkflowDialog
          workflow={workflow}
          hasChildren={hasChildren}
          act={act}
          returnFocusTo={() => workflowActions.current}
          onClose={() => setDeleting(false)}
          onDeleted={onDeleted}
        />
      )}
      {editing && (
        <SettingsDialog
          prompts={prompts}
          node={editing.node}
          creating={editing.creating}
          parentBatchId={editing.batchId}
          name={name}
          description={description}
          definition={draft}
          workflows={workflows}
          workflowId={workflow.id}
          canExport={true}
          returnFocusTo={() => {
            const id = editing.node?.id;
            if (!id) return editing.creating ? null : workflowActions.current;
            const card = Array.from(
              editorRef.current?.querySelectorAll<HTMLElement>(
                '.react-flow__node[data-id]',
              ) ?? [],
            ).find((element) => element.dataset.id === id);
            return (
              card?.querySelector<HTMLElement>(
                'button[aria-label^="Edit "], button.nodrag',
              ) ??
              card ??
              null
            );
          }}
          onOpenWorkflow={onOpenWorkflow}
          onCreateChild={
            !workflow.ownerWorkflowId && !workflow.archived && onOpenWorkflow
              ? createChild
              : undefined
          }
          onClose={() => setEditing(undefined)}
          onApply={(next) => {
            const before = latestDraft.current;
            latestDraft.current = next.definition;
            layout.update(changedPositions(before, next.definition));
            history.change(() => ({
              name: next.name,
              description: next.description,
              draft: next.definition,
            }));
            if (view === 'raw') {
              const text = JSON.stringify(next.definition, null, 2);
              setRaw(text);
              setRawBaseline(text);
            }
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
