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
import { isConfirmedWriteRejection } from '../../lib/isConfirmedWriteRejection';
import type { Action } from '../../lib/useActionFeedback';
import { useEditorDraft } from '../../lib/useEditorDraft';
import { flushSync } from 'react-dom';
import { WorkflowChildren } from './WorkflowChildren';
import { WorkflowCardsSkeleton } from '../../components/WorkflowCards/WorkflowCards';
import {
  WorkspaceReads,
  WorkspaceReadWarning,
  type WorkspaceRead,
} from '../../components/WorkspaceReads';
import { useMemo, useState, useRef, useEffect, type ReactNode } from 'react';

import { useMergedRef, useResizeObserver } from '@mantine/hooks';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  applyNodeChanges,
  applyEdgeChanges,
  useStoreApi,
  type Connection,
  type OnConnectStart,
  type OnConnectStartParams,
  type OnConnectEnd,
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
  parallelConnectionError,
  outgoingPorts,
  type Workflow,
  type WorkflowCatalogEntry,
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
import { placeParallelMembers, tidyWorkflow } from '@interlock/core/layout';
import { tidyWorkflowElk } from './workflowLayoutElk';
import { TidyControl } from './TidyControl';
import { api, errorMessage } from '../../lib/api';
import styles from './WorkflowEditor.module.css';
import { withParallelReturns } from './parallelReturns';
// Keep the workflow toolbar and lower canvas controls outside fitted node bounds.
const editorFitView = {
  padding: { top: '82px', right: '24px', bottom: '162px', left: '24px' },
} as const;
const nodeTypes = { workflow: FlowNode };
const edgeTypes = { loop: LoopEdge, ortho: OrthoEdge };

function validConnection(index: Map<string, WorkflowNode>, c: Connection) {
  const source = index.get(c.source);
  const target = index.get(c.target);
  return Boolean(
    source &&
    source.kind !== 'exit' &&
    target &&
    target.kind !== 'entry' &&
    !parallelConnectionError(
      source,
      target,
      c.sourceHandle ?? 'default',
      c.targetHandle as WorkflowEdge['targetHandle'],
    ) &&
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
}

function wireBetween(
  start: OnConnectStartParams,
  nodeId: string,
  handleId: string,
): Connection {
  return start.handleType === 'source'
    ? {
        source: start.nodeId!,
        sourceHandle: start.handleId,
        target: nodeId,
        targetHandle: handleId,
      }
    : {
        source: nodeId,
        sourceHandle: handleId,
        target: start.nodeId!,
        targetHandle: start.handleId,
      };
}

function ResetClickConnection({ request }: { request: number }) {
  const store = useStoreApi();
  useEffect(() => {
    if (request) store.setState({ connectionClickStartHandle: null });
  }, [request, store]);
  return null;
}

export function WorkflowEditor({
  workflow,
  workflows,
  workflowsRead,
  owner,
  ownerRead,
  onBack,
  onRun,
  onSaved,
  onPublicationChecked,
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
  workflows: WorkflowCatalogEntry[];
  workflowsRead?: WorkspaceRead;
  owner?: Workflow;
  ownerRead?: WorkspaceRead;
  onBack: () => void;
  onRun: (workflow: Workflow) => void;
  onSaved: (w: Workflow) => void;
  onPublicationChecked: (workflowId: string, latestVersion: number) => number;
  act: Action;
  onDirty: (dirty: boolean) => void;
  onDeleted?: () => void;
  section?: 'editor' | 'runs' | 'children';
  onSectionChange?: (section: 'editor' | 'runs' | 'children') => void;
  onOpenWorkflow?: (id: string) => void;
  onReport?: () => void;
  runsView?: ReactNode;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [review, setReview] = useState<{
    draft: WorkflowDefinition;
    revision: number;
    version: number;
  }>();
  const [unconfirmedVersion, setUnconfirmedVersion] = useState<number>();
  const [checkingPublication, setCheckingPublication] = useState(false);
  const [publicationCheckError, setPublicationCheckError] = useState('');
  const [publicationNotice, setPublicationNotice] = useState('');
  const publicationCheck = useRef<AbortController>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const [pending, setPending] = useState<'save' | 'publish'>();
  const actionInFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      publicationCheck.current?.abort();
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
  const wireStart = useRef<OnConnectStartParams | undefined>(undefined);
  const [wire, setWire] = useState<OnConnectStartParams>();
  const [wireMessage, setWireMessage] = useState<string>();
  const [wireReset, setWireReset] = useState(0);
  const layout = useWorkflowLayout(workflow);
  const dragging = useRef<WorkflowDefinition | undefined>(undefined);
  const history = useWorkflowHistory({
    draft: applyWorkflowPositions(workflow.draft, layout.positions),
    name: workflow.name,
    description: workflow.description,
  });
  const { draft, name, description } = history.present;
  const nodeIndex = useMemo(
    () => new Map(draft.nodes.map((node) => [node.id, node])),
    [draft.nodes],
  );
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
    parallel?: { parallelId: string; parallelBranchId: string };
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
  const startWire: OnConnectStart = (_, start) => {
    if (!start.nodeId) return;
    wireStart.current = start;
    setWire(start);
    setWireMessage(undefined);
  };
  const endWire: OnConnectEnd = (event, state) => {
    const start = wireStart.current;
    wireStart.current = undefined;
    setWire(undefined);
    if (!start?.nodeId || state.isValid) return;
    const handle =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('.react-flow__handle')
        : null;
    const nodeId = state.toHandle?.nodeId ?? handle?.dataset.nodeid;
    const handleId = state.toHandle?.id ?? handle?.dataset.handleid;
    if (!nodeId || !handleId) return;
    const targetIsSource = state.toHandle
      ? state.toHandle.type === 'source'
      : handle?.classList.contains('source');
    if (targetIsSource === (start.handleType === 'source')) return;
    const c = wireBetween(start, nodeId, handleId);
    const source = nodeIndex.get(c.source);
    const target = nodeIndex.get(c.target);
    if (!source || !target) return;
    const problem = parallelConnectionError(
      source,
      target,
      c.sourceHandle ?? 'default',
      c.targetHandle as WorkflowEdge['targetHandle'],
    );
    if (!problem) return;
    const pathName = (node: WorkflowNode) => {
      const group = node.parallelId
        ? nodeIndex.get(node.parallelId)
        : undefined;
      return group?.kind === 'parallel'
        ? group.branches.find((branch) => branch.id === node.parallelBranchId)
            ?.key
        : undefined;
    };
    const fromPath = pathName(source),
      toPath = pathName(target);
    setWireMessage(
      fromPath && toPath && source.parallelId === target.parallelId
        ? `${target.label} is in ${toPath}. Connect within ${fromPath}.`
        : fromPath
          ? `Connect ${source.label} to another node in ${fromPath}.`
          : toPath
            ? `${target.label} is in ${toPath}. Connect from that lane's start or another node in it.`
            : problem,
    );
  };
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
  // The child workflow actions retain their existing draft navigation.
  const { beginSave, finishSave } = useEditorDraft(
    false,
    dirty || layout.saving || Boolean(layout.error),
  );
  const perform = (
    action: 'save' | 'publish',
    fn: () => Promise<Workflow | undefined>,
    onAcknowledged?: () => void,
  ) => {
    if (actionInFlight.current || !beginSave()) return;
    actionInFlight.current = true;
    setPending(action);
    void (async () => {
      let result: Workflow | undefined;
      let active: boolean;
      try {
        result = await fn();
      } catch (error) {
        void act(async () => {
          throw error;
        });
      } finally {
        actionInFlight.current = false;
        active = finishSave(false);
        if (active) setPending(undefined);
      }
      if (!result || !active) return;
      onAcknowledged?.();
      void act(
        async () => result,
        action === 'publish'
          ? `Published “${result.name}” as v${result.latestVersion}.`
          : 'Workflow draft saved.',
      );
    })();
  };
  const checkPublication = async () => {
    if (unconfirmedVersion === undefined || publicationCheck.current) return;
    const request = new AbortController();
    publicationCheck.current = request;
    setCheckingPublication(true);
    setPublicationCheckError('');
    try {
      const current = await api.workflows.get.query(
        { id: workflow.id },
        { signal: request.signal },
      );
      if (request.signal.aborted) return;
      if (current.latestVersion < unconfirmedVersion)
        throw new Error(
          'Could not read the current published version. Try again.',
        );
      const latestVersion = onPublicationChecked(
        workflow.id,
        current.latestVersion,
      );
      setPublicationNotice(
        latestVersion > unconfirmedVersion
          ? `Published version v${latestVersion} is available.`
          : 'No newer published version was found. Review the draft to publish again.',
      );
      setUnconfirmedVersion(undefined);
      setReview(undefined);
    } catch (error) {
      if (!request.signal.aborted)
        setPublicationCheckError(errorMessage(error));
    } finally {
      if (!request.signal.aborted) {
        publicationCheck.current = null;
        setCheckingPublication(false);
      }
    }
  };
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
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
  const { nodes, edges } = useMemo(() => {
    const connectionPorts = new Map<string, string[]>();
    const origin = wire?.nodeId ? nodeIndex.get(wire.nodeId) : undefined;
    if (
      wire &&
      origin &&
      (origin.parallelId ||
        (origin.kind === 'parallel' && wire.handleId?.startsWith('branch:')))
    ) {
      for (const node of draft.nodes) {
        const type = wire.handleType === 'source' ? 'target' : 'source';
        const ports = type === 'source' ? outgoingPorts(node) : ['default'];
        const allowed = ports.filter(
          (id) =>
            node.id !== origin.id &&
            validConnection(nodeIndex, wireBetween(wire, node.id, id)),
        );
        if (allowed.length)
          connectionPorts.set(
            node.id,
            allowed.map((id) => `${type}:${id}`),
          );
      }
    }
    return canvasGraph(draft, {
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
      onAddBranch: (parallelId, parallelBranchId) =>
        setEditing({
          creating: true,
          parallel: { parallelId, parallelBranchId },
        }),
      connectionPorts,
      onToggle: (id) =>
        setCollapsed((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
    });
  }, [
    draft,
    selected,
    selectedEdges,
    hovered,
    collapsed,
    workflows,
    onOpenWorkflow,
    wire,
    nodeIndex,
  ]);
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
      if (!mounted.current) return;
      onSaved(parent);
      return workflow;
    } finally {
      setNavigationPending(false);
    }
  };
  const connect = (c: Connection) =>
    setDraft((d) =>
      withParallelReturns({
        ...d,
        edges: [
          ...d.edges.filter(
            (e) =>
              !(
                e.source === c.source &&
                e.port === (c.sourceHandle ?? 'default')
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
      }),
    );
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
        backLabel={
          owner
            ? `Back to ${owner.name}`
            : workflow.ownerWorkflowId
              ? 'Back to parent workflow'
              : 'Back to workflows'
        }
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
                  aria-label={
                    unconfirmedVersion === undefined
                      ? 'Review & publish'
                      : 'Check published version'
                  }
                  title={
                    unconfirmedVersion === undefined
                      ? 'Review & publish'
                      : 'Check published version'
                  }
                  disabled={
                    Boolean(pending) ||
                    (unconfirmedVersion === undefined &&
                      (rawInvalid ||
                        Boolean(rawResult?.publishError) ||
                        (view === 'visual' && Boolean(graphError)) ||
                        remoteChanged))
                  }
                  onClick={() => {
                    setPublicationNotice('');
                    setReview({
                      draft: structuredClone(effectiveDraft),
                      revision: workflow.draftRevision,
                      version: workflow.latestVersion,
                    });
                  }}
                >
                  <Upload />
                  <span>
                    {unconfirmedVersion !== undefined
                      ? 'Check published version'
                      : compactHeader
                        ? 'Publish'
                        : 'Review & publish'}
                  </span>
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
                Boolean(
                  workflow.ownerWorkflowId && (!owner || owner.archived),
                ) ||
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
      {ownerRead && <WorkspaceReadWarning reads={[ownerRead]} />}
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
                    perform(
                      'save',
                      () => useChildVersion(node.id),
                      () => onOpenWorkflow?.(owner.id),
                    )
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
        {section === 'editor' && workflowsRead && (
          <WorkspaceReadWarning reads={[workflowsRead]} />
        )}
        {section === 'editor' && publicationNotice && (
          <div role="status" className={styles.conflict}>
            {publicationNotice}
          </div>
        )}
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
                  className={wire ? styles.wiring : undefined}
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
                      return withParallelReturns({
                        ...retained,
                        edges: retained.edges.filter((e) => !edgeIds.has(e.id)),
                      });
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
                        changes.some(
                          (change) =>
                            change.type === 'position' &&
                            nodeIndex.get(change.id)?.parallelId,
                        )
                          ? placeParallelMembers(d)
                          : d,
                        new Set(
                          changes
                            .filter((c) => c.type === 'remove')
                            .map((c) => c.id),
                        ),
                      );
                      const updated = {
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
                      return changes.some((change) => change.type === 'remove')
                        ? withParallelReturns(updated)
                        : updated;
                    });
                  }}
                  onEdgesChange={(changes) => {
                    const next = applyEdgeChanges(changes, edges);
                    setSelectedEdges(
                      new Set(next.filter((e) => e.selected).map((e) => e.id)),
                    );
                    if (changes.every((c) => c.type === 'select')) return;
                    setDraft((d) =>
                      withParallelReturns({
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
                          targetHandle: e.targetHandle?.startsWith(
                            'parallel-end:',
                          )
                            ? 'join'
                            : ((e.targetHandle ??
                                'default') as WorkflowEdge['targetHandle']),
                        })),
                      }),
                    );
                  }}
                  onConnect={connect}
                  onConnectStart={startWire}
                  onClickConnectStart={startWire}
                  onConnectEnd={endWire}
                  onClickConnectEnd={endWire}
                  isValidConnection={(c) =>
                    validConnection(nodeIndex, {
                      ...c,
                      sourceHandle: c.sourceHandle ?? null,
                      targetHandle: c.targetHandle ?? null,
                    })
                  }
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
                  onPaneClick={() => {
                    setSelected(new Set());
                    setWireMessage(undefined);
                    if (wireStart.current) {
                      wireStart.current = undefined;
                      setWire(undefined);
                      setWireReset((value) => value + 1);
                    }
                  }}
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
                  {wireReset > 0 && (
                    <ResetClickConnection request={wireReset} />
                  )}
                  <Background color="var(--canvas-dot)" gap={22} size={1} />
                  {wireMessage && (
                    <Panel
                      position="bottom-center"
                      className={styles.connectionHint}
                      role="status"
                    >
                      {wireMessage}
                    </Panel>
                  )}
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
            <WorkspaceReads
              reads={workflowsRead ? [workflowsRead] : []}
              subject="child workflows"
              loading={<WorkflowCardsSkeleton />}
            >
              <WorkflowChildren
                workflow={{ ...workflow, draft }}
                workflows={workflows}
                disabled={
                  Boolean(pending) || rawEdited || rawInvalid || remoteChanged
                }
                onOpen={(id) => onOpenWorkflow?.(id)}
                onCreate={(childName) =>
                  createChild(childName, {
                    name,
                    description,
                    definition: draft,
                  })
                }
                act={act}
              />
            </WorkspaceReads>
          </Tabs.Panel>
        )}
        <Tabs.Panel
          value="runs"
          className={`${styles.runsView} ${styles.runListView}`}
        >
          {section === 'runs' && runsView}
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
          publicationCheck={
            unconfirmedVersion === undefined
              ? undefined
              : {
                  checking: checkingPublication,
                  error: publicationCheckError,
                  onCheck: () => void checkPublication(),
                }
          }
          editorChanged={
            remoteChanged ||
            workflow.draftRevision !== review.revision ||
            workflow.latestVersion !== review.version
          }
          onClose={() => setReview(undefined)}
          onPublish={() => {
            if (
              unconfirmedVersion !== undefined ||
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
              let published: Workflow;
              try {
                published = await api.workflows.publish.mutate({
                  id: workflow.id,
                });
              } catch (error) {
                if (isConfirmedWriteRejection(error)) throw error;
                if (mounted.current)
                  setUnconfirmedVersion(savedWorkflow.latestVersion);
                return;
              }
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
          act={act}
          returnFocusTo={() => workflowActions.current}
          onClose={() => setDeleting(false)}
          onDeleted={onDeleted}
        />
      )}
      {editing && (
        <SettingsDialog
          workflowsRead={workflowsRead}
          node={editing.node}
          creating={editing.creating}
          parentBatchId={editing.batchId}
          parentParallel={editing.parallel}
          name={name}
          description={description}
          definition={draft}
          workflows={workflows}
          workflowId={workflow.id}
          workflowBoardId={workflow.boardId}
          boardStageColumns={workflow.boardStageColumns}
          onBoardSaved={onSaved}
          canExport={true}
          returnFocusTo={() => {
            const id = editing.node?.id ?? editing.parallel?.parallelId;
            if (!id) return editing.creating ? null : workflowActions.current;
            const card = Array.from(
              editorRef.current?.querySelectorAll<HTMLElement>(
                '.react-flow__node[data-id]',
              ) ?? [],
            ).find((element) => element.dataset.id === id);
            if (editing.parallel) {
              const lane = Array.from(
                card?.querySelectorAll<HTMLElement>('[data-parallel-lane]') ??
                  [],
              ).find(
                (element) =>
                  element.dataset.parallelLane ===
                  editing.parallel?.parallelBranchId,
              );
              return lane?.querySelector('button') ?? card ?? null;
            }
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
                  setDraft((d) =>
                    withParallelReturns(withoutNodes(d, new Set([id]))),
                  );
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
