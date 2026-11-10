import { Button, Radio, Stack } from '../../design-system';

import { useRef } from 'react';
import { STARTED_RUN_SCHEMA, type WorkflowNode } from '@interlock/core';
import { errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';

type WorkflowStep = Extract<WorkflowNode, { kind: 'workflow' }>;
type WaitSettings = Pick<
  WorkflowStep,
  'outputSchema' | 'onFailure' | 'routing' | 'outputBindings'
>;

const waitSettings = (node: WorkflowStep): WaitSettings => ({
  outputSchema: node.outputSchema,
  onFailure: node.onFailure,
  routing: node.routing,
  outputBindings: node.outputBindings,
});
export function WorkflowModeEditor({
  node,
  onChange,
}: {
  node: WorkflowStep;
  onChange: (node: WorkflowStep) => void;
}) {
  const previousWait = useRef<WaitSettings | undefined>(
    node.mode === 'detached' ? undefined : waitSettings(node),
  );
  const needsOutput = node.mode === 'detached' && !previousWait.current;
  const versions = useQuery(
    trpc.workflows.versions.queryOptions(
      { id: node.workflowId },
      { enabled: needsOutput && node.version !== null },
    ),
  );
  const published = versions.data?.find(
    (version) => version.version === node.version,
  );
  const loading =
    needsOutput &&
    node.version !== null &&
    (versions.isPending || (!published && versions.isFetching));
  const unavailable =
    needsOutput && node.version !== null && !published && versions.isError;
  return (
    <>
      <Radio.Group
        label="When to continue"
        mt="md"
        mb="md"
        value={node.mode ?? 'wait'}
        onChange={(mode) => {
          if (mode !== 'wait' && mode !== 'detached') return;
          if (mode === 'wait' && (loading || unavailable)) return;
          if (node.mode !== 'detached')
            previousWait.current = waitSettings(node);
          const waited = previousWait.current ?? {
            outputSchema: published?.definition.outputSchema ?? {},
          };
          onChange({
            ...node,
            mode,
            routing: mode === 'detached' ? undefined : waited.routing,
            outputBindings:
              mode === 'detached' ? undefined : waited.outputBindings,
            onFailure: mode === 'detached' ? undefined : waited.onFailure,
            outputSchema:
              mode === 'detached'
                ? structuredClone(STARTED_RUN_SCHEMA)
                : structuredClone(waited.outputSchema),
          });
        }}
      >
        <Stack gap="sm" mt="xs">
          <Radio
            value="wait"
            disabled={loading || unavailable}
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
      {loading && (
        <p role="status" className="hint">
          Loading output contract…
        </p>
      )}
      {unavailable && (
        <div role="alert">
          <p className="hint">
            Could not load the pinned output contract:{' '}
            {errorMessage(versions.error)}
          </p>
          <Button onClick={() => void versions.refetch()}>
            Retry output contract
          </Button>
        </div>
      )}
      {needsOutput && !loading && !unavailable && !published && (
        <p className="hint">
          {node.version === null
            ? 'No published version is selected.'
            : `Pinned version ${node.version} is unavailable.`}{' '}
          Wait for result starts with Any output. Set a contract in Result.
        </p>
      )}
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
