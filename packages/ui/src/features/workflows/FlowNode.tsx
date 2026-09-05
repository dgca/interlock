import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bot,
  Terminal,
  Split,
  Layers,
  Workflow,
} from 'lucide-react';
import type { WorkflowNode } from '@interlock/core';
import styles from './WorkflowEditor.module.css';
export type CanvasNode = Node<{ node: WorkflowNode; status?: string }>;
const icons = {
  entry: ArrowUpFromLine,
  exit: ArrowDownToLine,
  agent: Bot,
  script: Terminal,
  condition: Split,
  map: Layers,
  workflow: Workflow,
};
export function FlowNode({ data, selected }: NodeProps<CanvasNode>) {
  const n = data.node,
    Icon = icons[n.kind];
  return (
    <div className={`${styles.node} ${selected ? styles.nodeSelected : ''}`}>
      <div className={styles.nodeHeading}>
        <span className={`${styles.nodeIcon} ${styles[n.kind]}`}>
          <Icon size={16} />
        </span>
        <span>
          {n.kind === 'agent' ? 'AGENT ASSIGNMENT' : n.kind.toUpperCase()}
        </span>
        {data.status && (
          <i title={data.status} className={styles[data.status]} />
        )}
      </div>
      <strong>{n.label}</strong>
      <small>
        {n.kind === 'agent'
          ? `${n.context.mode === 'fresh' ? 'Fresh' : 'Current'} context · ${n.maxAttempts} attempts`
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
