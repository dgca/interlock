import { useRef } from 'react';
import { Button, Stack, TextInput } from '../../design-system';
import type { WorkflowDefinition, WorkflowNode } from '@interlock/core';
import styles from './NodeInspector.module.css';

type ParallelNode = Extract<WorkflowNode, { kind: 'parallel' }>;

export function ParallelBranchesEditor({
  node,
  definition,
  onChange,
}: {
  node: ParallelNode;
  definition?: WorkflowDefinition;
  onChange: (node: WorkflowNode) => void;
}) {
  const fields = useRef(new Map<string, HTMLInputElement>());
  const focus = (id: string) =>
    requestAnimationFrame(() => fields.current.get(id)?.focus());
  const add = () => {
    let next = node.branches.length + 1;
    const keys = new Set(node.branches.map((branch) => branch.key));
    while (keys.has(`branch-${next}`)) next++;
    const branch = { id: crypto.randomUUID(), key: `branch-${next}` };
    onChange({ ...node, branches: [...node.branches, branch] });
    focus(branch.id);
  };
  return (
    <Stack gap="sm">
      <TextInput
        label="Branches at a time"
        description="Limit how many branches can be active together."
        type="number"
        required
        min={1}
        max={50}
        value={node.concurrency}
        onChange={(event) =>
          onChange({ ...node, concurrency: Number(event.target.value) })
        }
      />
      <div>
        <strong>Branches</strong>
        <p className="hint">Branch names become keys in the joined output.</p>
      </div>
      {node.branches.map(({ id, key }, index) => {
        const hasSteps = definition?.nodes.some(
          (step) => step.parallelId === node.id && step.parallelBranchId === id,
        );
        const invalid = !key.trim()
          ? 'Enter a branch name.'
          : node.branches.some((other) => other.id !== id && other.key === key)
            ? 'Use a different name for each branch.'
            : undefined;
        return (
          <div className={styles.parallelBranchField} key={id}>
            <TextInput
              ref={(element) => {
                if (element) fields.current.set(id, element);
                else fields.current.delete(id);
              }}
              label={`Branch ${index + 1} name`}
              maxLength={64}
              value={key}
              error={invalid}
              description={
                hasSteps
                  ? 'Remove its steps before removing this branch.'
                  : undefined
              }
              onChange={(event) =>
                onChange({
                  ...node,
                  branches: node.branches.map((branch) =>
                    branch.id === id
                      ? { ...branch, key: event.target.value }
                      : branch,
                  ),
                })
              }
            />
            <Button
              size="xs"
              variant="ghost"
              disabled={hasSteps || node.branches.length <= 2}
              aria-label={`Remove branch ${key.trim() || index + 1}`}
              onClick={() => {
                const remaining = node.branches.filter(
                  (branch) => branch.id !== id,
                );
                onChange({ ...node, branches: remaining });
                focus(remaining[Math.min(index, remaining.length - 1)].id);
              }}
            >
              Remove
            </Button>
          </div>
        );
      })}
      <Button
        variant="secondary"
        disabled={node.branches.length >= 50}
        onClick={add}
      >
        Add branch
      </Button>
    </Stack>
  );
}
