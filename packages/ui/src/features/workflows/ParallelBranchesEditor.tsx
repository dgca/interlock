import { useRef, useState } from 'react';
import { Button, Radio, Stack, TextInput } from '../../design-system';
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
      <JoinSettings key={node.id} node={node} onChange={onChange} />
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

function JoinSettings({
  node,
  onChange,
}: {
  node: ParallelNode;
  onChange: (node: WorkflowNode) => void;
}) {
  const { joinAfter, onBranchFailure, ...rest } = node;
  const count = node.branches.length;
  // Kept apart from the value so typing 1 in the count does not switch to Any.
  const [counting, setCounting] = useState(
    joinAfter !== undefined && joinAfter !== 1,
  );
  const mode = joinAfter === undefined ? 'all' : counting ? 'count' : 'any';
  const required =
    mode === 'count' &&
    (!Number.isInteger(joinAfter) || joinAfter! < 1 || joinAfter! > count)
      ? `Enter a number from 1 to ${count}.`
      : undefined;
  return (
    <>
      <Radio.Group
        label="Continue after"
        description="Branches still running when enough succeed are cancelled."
        value={mode}
        onChange={(value) => {
          setCounting(value === 'count');
          onChange(
            value === 'all'
              ? rest
              : {
                  ...rest,
                  ...(onBranchFailure ? { onBranchFailure } : {}),
                  joinAfter: value === 'any' ? 1 : Math.min(2, count),
                },
          );
        }}
      >
        <Stack gap="xs" mt="xs">
          <Radio value="all" label="All branches succeed" />
          <Radio value="any" label="Any branch succeeds" />
          <Radio value="count" label="A number of branches succeed" />
        </Stack>
      </Radio.Group>
      {mode === 'count' && (
        <TextInput
          label="Branches required"
          type="number"
          required
          min={1}
          max={count}
          value={joinAfter}
          error={required}
          onChange={(event) =>
            onChange({ ...node, joinAfter: Number(event.target.value) })
          }
        />
      )}
      {mode !== 'all' && (
        <Radio.Group
          label="When a branch fails"
          value={onBranchFailure ?? 'fail'}
          error={
            onBranchFailure === 'continue' && joinAfter! >= count
              ? 'Require fewer branches than the group has to continue after a failure.'
              : undefined
          }
          onChange={(value) =>
            onChange(
              value === 'continue'
                ? { ...rest, joinAfter, onBranchFailure: 'continue' }
                : { ...rest, joinAfter },
            )
          }
        >
          <Stack gap="xs" mt="xs">
            <Radio value="fail" label="Fail and stop other branches" />
            <Radio
              value="continue"
              label="Continue while enough branches can succeed"
            />
          </Stack>
        </Radio.Group>
      )}
    </>
  );
}
