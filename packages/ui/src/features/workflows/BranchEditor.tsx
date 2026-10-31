import type { WorkflowNode } from '@interlock/core';
import { SwitchEditor } from './SwitchEditor';
type BranchNode = Extract<WorkflowNode, { kind: 'condition' | 'switch' }>;
type Props = Omit<Parameters<typeof SwitchEditor>[0], 'node' | 'onChange'> & {
  node: BranchNode;
  onChange: (node: WorkflowNode) => void;
};
export function BranchEditor({ node, onChange, ...props }: Props) {
  const view =
    node.kind === 'condition'
      ? {
          ...node,
          kind: 'switch' as const,
          cases: [{ port: 'true', equals: node.equals }],
          default: 'false',
        }
      : node;
  return (
    <SwitchEditor
      {...props}
      node={view}
      onChange={(next) => {
        if (
          node.kind === 'condition' &&
          next.cases.length === 1 &&
          next.cases[0].port === 'true' &&
          next.default === 'false'
        )
          onChange({ ...node, path: next.path, equals: next.cases[0].equals });
        else onChange(next);
      }}
    />
  );
}
