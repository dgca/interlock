import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Pencil,
  Terminal,
  Split,
  Layers,
  Workflow,
} from 'lucide-react';
import { nodeKindLabel, type WorkflowNode } from '@interlock/core';
import styles from './WorkflowEditor.module.css';
export type CanvasNode = Node<{
  node: WorkflowNode;
  status?: string;
  onEdit?: () => void;
  onOpen?: () => void;
}>;
const icons = {
  entry: ArrowUpFromLine,
  exit: ArrowDownToLine,
  agent: Bot,
  script: Terminal,
  condition: Split,
  map: Layers,
  batch: Layers,
  workflow: Workflow,
};
export function FlowNode({ data, selected }: NodeProps<CanvasNode>) {
  const n = data.node,
    Icon = icons[n.kind];
  return (
    <div
      className={`${styles.node} ${n.kind === 'batch' ? styles.batchNode : ''} ${selected ? styles.nodeSelected : ''}`}
    >
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
      <small>
        {n.kind === 'agent'
          ? `${n.context.mode === 'fresh' ? 'Fresh' : 'Current'} context · ${n.maxAttempts} attempts`
          : n.kind === 'batch'
            ? `${n.body.nodes.length} inline steps · ${n.concurrency} workers`
            : n.kind === 'map'
              ? `Up to ${n.concurrency} workers · v${n.version}`
              : n.kind === 'workflow'
                ? `Nested workflow · v${n.version}`
                : n.kind === 'script'
                  ? 'JSON in → JSON out'
                  : n.kind === 'condition'
                    ? `${n.path} equals ${JSON.stringify(n.equals)}`
                    : n.kind === 'entry'
                      ? 'Workflow input'
                      : 'Return workflow result'}
      </small>
      {n.kind === 'batch' && data.onOpen && (
        <button
          className={`${styles.openBatch} nodrag nopan`}
          type="button"
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            data.onOpen?.();
          }}
        >
          Open inline workflow
        </button>
      )}
      {n.kind !== 'entry' && <Handle type="target" position={Position.Left} />}{' '}
      {n.kind !== 'exit' &&
        (n.kind === 'condition' ? (
          <>
            <Handle
              type="source"
              position={Position.Right}
              id="true"
              style={{ top: '35%' }}
            />
            <Handle
              type="source"
              position={Position.Right}
              id="false"
              style={{ top: '75%' }}
            />
            <span className={styles.routeTrue}>T</span>
            <span className={styles.routeFalse}>F</span>
          </>
        ) : (
          <Handle type="source" position={Position.Right} id="default" />
        ))}
    </div>
  );
}
