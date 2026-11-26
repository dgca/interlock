import { Switch } from '../../design-system';

import { useState } from 'react';

import {
  stallFields,
  type StallPolicy,
  type WorkflowNode,
} from '@interlock/core';

import { StallPolicyEditor } from '../executors/StallSettings';

const stallPolicyKeys = [
  ...Object.keys(stallFields),
  'idleRecovery',
] as (keyof StallPolicy)[];

/** Opt-in node overrides for the library and workflow stall thresholds. */
export function NodeStallOverrides({
  node,
  onChange,
}: {
  node: WorkflowNode;
  onChange: (patch: Partial<StallPolicy>) => void;
}) {
  const policy: StallPolicy = node;
  const customized = stallPolicyKeys.some((key) => policy[key] !== undefined);
  const [editing, setEditing] = useState(customized);
  const overriding = editing || customized;
  return (
    <>
      <Switch
        mt="md"
        label="Override stall detection"
        aria-label="Override stall detection"
        description="Use workflow and library defaults when off."
        checked={overriding}
        onChange={(event) => {
          const checked = event.currentTarget.checked;
          setEditing(checked);
          if (!checked)
            onChange(
              Object.fromEntries(
                stallPolicyKeys.map((key) => [key, undefined]),
              ),
            );
        }}
      />
      {overriding && (
        <StallPolicyEditor
          value={node}
          onChange={onChange}
          showRecovery={node.kind === 'agent'}
          showHeading={false}
          thresholds={
            node.kind === 'agent'
              ? ['unclaimedStallMs', 'claimedIdleStallMs', 'runStallMs']
              : node.kind === 'input'
                ? ['humanWaitStallMs', 'runStallMs']
                : ['runStallMs']
          }
        />
      )}
    </>
  );
}
