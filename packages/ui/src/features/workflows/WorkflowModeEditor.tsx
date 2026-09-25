import { Radio, Stack } from '@mantine/core';
import { useRef } from 'react';
import { STARTED_RUN_SCHEMA, type WorkflowNode } from '@interlock/core';

type WorkflowStep = Extract<WorkflowNode, { kind: 'workflow' }>;
export function WorkflowModeEditor({
  node,
  onChange,
}: {
  node: WorkflowStep;
  onChange: (node: WorkflowStep) => void;
}) {
  const waitOutput = useRef(node.mode === 'detached' ? {} : node.outputSchema);
  return (
    <>
      <Radio.Group
        label="Execution"
        mt="md"
        mb="md"
        value={node.mode ?? 'wait'}
        onChange={(mode) => {
          if (mode !== 'wait' && mode !== 'detached') return;
          if (node.mode !== 'detached') waitOutput.current = node.outputSchema;
          onChange({
            ...node,
            mode,
            outputSchema:
              mode === 'detached'
                ? structuredClone(STARTED_RUN_SCHEMA)
                : waitOutput.current,
          });
        }}
      >
        <Stack gap="sm" mt="xs">
          <Radio
            value="wait"
            label="Wait for result"
            description="Continue when this workflow finishes. Use its result as this step's output."
          />
          <Radio
            value="detached"
            label="Start and continue"
            description="Return the new run's details immediately. It keeps running if this run finishes, fails, or is cancelled."
          />
        </Stack>
      </Radio.Group>
      {node.mode === 'detached' && (
        <p className="hint">
          The next step receives runId, workflowId, and version, instead of the
          workflow's result.
          {node.batchId &&
            ' Batch concurrency limits dispatch, not how many started workflows remain active.'}
        </p>
      )}
    </>
  );
}
