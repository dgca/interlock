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
} from 'lucide-react';
import { nodeKindLabel, type WorkflowNode } from '@interlock/core';
import styles from './WorkflowEditor.module.css';
export type CanvasNode = Node<{
  node: WorkflowNode;
  status?: string;
  boundarySchema?: WorkflowNode['inputSchema'];
  onEdit?: () => void;
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
}: {
  id: string;
  type: 'source' | 'target';
  label: string;
  top?: number | string;
}) {
  return (
    <>
      <Handle
        type={type}
        position={type === 'target' ? Position.Left : Position.Right}
        id={id}
        aria-label={label}
        style={{ top }}
      />
      <span
        className={type === 'target' ? styles.portInput : styles.portOutput}
        style={{ top }}
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
        ? `Nested workflow · v${n.version}`
        : n.kind === 'fetch'
          ? `Method: ${n.method}`
          : n.kind === 'condition'
            ? `${n.path} equals ${JSON.stringify(n.equals)}`
            : n.kind === 'entry'
              ? 'Workflow input'
              : n.kind === 'exit'
                ? 'Return workflow result'
                : undefined;
  if (n.kind === 'batch')
    return (
      <div
        className={`${styles.batchGroup} ${selected ? styles.nodeSelected : ''}`}
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
    <div className={`${styles.node} ${selected ? styles.nodeSelected : ''}`}>
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
        <small>{contracts}</small>
      </div>
      {n.kind !== 'entry' && <Port type="target" id="default" label="In" />}
      {n.kind !== 'exit' &&
        (n.kind === 'condition' ? (
          <>
            <Port type="source" id="true" label="True" top="35%" />
            <Port type="source" id="false" label="False" top="75%" />
          </>
        ) : (
          <Port type="source" id="default" label="Out" />
        ))}
    </div>
  );
}
