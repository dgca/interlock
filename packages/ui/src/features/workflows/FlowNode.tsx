import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Pencil,
  Terminal,
  Split,
  Layers,
  Globe,
  Workflow,
  CheckCircle2,
  LoaderCircle,
  CircleAlert,
  Clock,
  CircleMinus,
} from 'lucide-react';
import { nodeKindLabel, type WorkflowNode } from '@interlock/core';
import styles from './WorkflowEditor.module.css';
import { conditionColors } from './conditionColors';
export type CanvasNode = Node<{
  node: WorkflowNode;
  status?: string;
  progress?: {
    state:
      'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
    label: string;
  };
  boundarySchema?: WorkflowNode['inputSchema'];
  onEdit?: () => void;
  onOpen?: () => void;
  targetName?: string;
  ownedTarget?: boolean;
  onAdd?: () => void;
  onToggle?: () => void;
  collapsed?: boolean;
}>;
const icons = {
  entry: ArrowUpFromLine,
  exit: ArrowDownToLine,
  agent: Bot,
  script: Terminal,
  fetch: Globe,
  condition: Split,
  batch: Layers,
  workflow: Workflow,
};
function contractLabel(schema: WorkflowNode['inputSchema']): string {
  const labels: Record<string, string> = {
    string: 'Text',
    object: 'Object',
    array: 'List',
    number: 'Number',
    integer: 'Number',
    boolean: 'Boolean',
    null: 'Null',
  };
  return typeof schema.type === 'string'
    ? (labels[schema.type] ?? 'Any')
    : 'Any';
}

function Port({
  id,
  type,
  label,
  top = '50%',
  color,
}: {
  id: string;
  type: 'source' | 'target';
  label: string;
  top?: number | string;
  color?: string;
}) {
  return (
    <>
      <Handle
        type={type}
        position={type === 'target' ? Position.Left : Position.Right}
        id={id}
        aria-label={label}
        style={{ top, backgroundColor: color }}
      />
      <span
        className={type === 'target' ? styles.portInput : styles.portOutput}
        style={{ top, color }}
      >
        {label}
      </span>
    </>
  );
}

export function FlowNode({ data, selected }: NodeProps<CanvasNode>) {
  const n = data.node,
    Icon = icons[n.kind];
  const boundary = data.boundarySchema ?? {};
  const inputSchema = n.inputSchema.type
    ? n.inputSchema
    : n.kind === 'entry' || n.kind === 'exit'
      ? boundary
      : n.kind === 'batch' && !n.itemsPath
        ? { type: 'array' }
        : n.inputSchema;
  const outputSchema = n.outputSchema.type
    ? n.outputSchema
    : n.kind === 'entry' || n.kind === 'exit'
      ? boundary
      : n.kind === 'batch'
        ? { type: 'array' }
        : n.kind === 'fetch'
          ? { type: 'object' }
          : n.kind === 'condition'
            ? inputSchema
            : n.outputSchema;
  const contracts = `${contractLabel(inputSchema)} → ${contractLabel(outputSchema)}`;
  const detail =
    n.kind === 'agent'
      ? `${n.context.mode === 'fresh' ? 'Fresh' : 'Current'} context · ${n.maxAttempts} attempts`
      : n.kind === 'workflow'
        ? `${data.targetName ?? 'Workflow'} · ${n.version === null ? 'Not published' : `v${n.version}`}`
        : n.kind === 'fetch'
          ? `Method: ${n.method}`
          : n.kind === 'condition'
            ? `${n.path} equals ${JSON.stringify(n.equals)}`
            : n.kind === 'entry'
              ? 'Workflow input'
              : n.kind === 'exit'
                ? 'Return workflow result'
                : undefined;
  const progressClass = data.progress
    ? styles[`run_${data.progress.state}`]
    : '';
  const StatusIcon =
    data.progress?.state === 'completed'
      ? CheckCircle2
      : data.progress?.state === 'running'
        ? LoaderCircle
        : data.progress?.state === 'failed'
          ? CircleAlert
          : data.progress?.state === 'cancelled'
            ? CircleMinus
            : Clock;
  const progress = data.progress && (
    <span
      className={styles.runProgress}
      title={data.progress.label}
      aria-label={data.progress.label}
    >
      <StatusIcon
        size={12}
        className={
          data.progress.state === 'running' ? styles.spinning : undefined
        }
      />
      <span>{data.progress.label}</span>
    </span>
  );
  if (n.kind === 'batch')
    return (
      <div
        className={`${styles.batchGroup} ${progressClass} ${selected ? styles.nodeSelected : ''}`}
      >
        <div className={`${styles.batchHeader} batch-drag`}>
          <Layers size={17} />
          <strong>{n.label}</strong>
          {data.status && <span>{data.status}</span>}
          {data.onEdit && (
            <button className="nodrag nopan" onClick={data.onEdit}>
              Settings
            </button>
          )}
          {data.onToggle && (
            <button className="nodrag nopan" onClick={data.onToggle}>
              {data.collapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
        </div>
        <div className={styles.batchSummary}>
          <div className={styles.nodeMetadata}>
            {progress}
            <small>
              Each item runs independently · Up to {n.concurrency} at once
            </small>
            <small>{contracts}</small>
          </div>
          {data.onAdd && !data.collapsed && (
            <button className="nodrag nopan" onClick={data.onAdd}>
              Add step
            </button>
          )}
        </div>
        {!data.collapsed && <span className={styles.batchStart}>Start</span>}
        <Port type="target" id="default" label="In" top={32} />
        <Port type="source" id="complete" label="Out" top={32} />
        <Handle
          type="source"
          position={Position.Right}
          id="item"
          style={{
            left: 32,
            right: 'auto',
            top: 218,
            visibility: data.collapsed ? 'hidden' : 'visible',
          }}
          aria-label="Start"
        />
        {!data.collapsed && <span className={styles.batchEnd}>End</span>}
        <Handle
          type="target"
          position={Position.Left}
          id="end"
          aria-label="End"
          style={{
            left: 'auto',
            right: 32,
            top: 218,
            visibility: data.collapsed ? 'hidden' : 'visible',
          }}
        />
      </div>
    );
  return (
    <div
      className={`${styles.node} ${progressClass} ${selected ? styles.nodeSelected : ''}`}
    >
      {data.progress && (
        <span className={styles.runNodeStatus}>{progress}</span>
      )}
      <div className={styles.nodeHeading}>
        <span className={`${styles.nodeIcon} ${styles[n.kind]}`}>
          <Icon size={16} />
        </span>
        <span>
          {n.kind === 'agent'
            ? 'AGENT ASSIGNMENT'
            : nodeKindLabel(n.kind).toUpperCase()}
        </span>
        {data.status && (
          <i title={data.status} className={styles[data.status]} />
        )}
      </div>
      {selected && data.onEdit && (
        <button
          type="button"
          className={`${styles.editNode} nodrag nopan`}
          aria-label={`Edit ${n.label}`}
          title="Edit node"
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            data.onEdit?.();
          }}
        >
          <Pencil size={13} />
        </button>
      )}
      <strong>{n.label}</strong>
      <div className={styles.nodeMetadata}>
        {detail && <small title={detail}>{detail}</small>}
        <div className={styles.nodeContractRow}>
          <small>{contracts}</small>
          {data.onOpen && (
            <button
              className={`${styles.openWorkflow} nodrag nopan`}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                data.onOpen?.();
              }}
            >
              {data.ownedTarget ? 'Open child' : 'Open workflow'}
            </button>
          )}
        </div>
      </div>
      {n.kind !== 'entry' && <Port type="target" id="default" label="In" />}
      {n.kind !== 'exit' &&
        (n.kind === 'condition' ? (
          <>
            <Port
              type="source"
              id="true"
              label="True"
              top="35%"
              color={conditionColors.true}
            />
            <Port
              type="source"
              id="false"
              label="False"
              top="75%"
              color={conditionColors.false}
            />
          </>
        ) : (
          <Port type="source" id="default" label="Out" />
        ))}
    </div>
  );
}
