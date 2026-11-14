import type {
  EventPayload,
  EventTrigger,
  Json,
  Run,
  RunStartOptions,
  ScheduleTrigger,
  Workflow,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { RunStarts } from './runStarts.js';
import type { StartCosts } from './startCosts.js';

type Start = RunStartOptions & {
  workflowId: string;
  version: number;
  input: Json;
};
/**
 * Starts made by schedules and event triggers. They use the latest published
 * version and a derived request ID, and never wait for a cost confirmation.
 */
export function automatedStarts(deps: {
  store: Store;
  starts: RunStarts;
  costs: StartCosts;
  workflow: (id: string) => Workflow;
  run: (id: string) => Run;
  newRun: (q: Start, schedule?: Run['schedule'], chain?: string[]) => Run;
}) {
  const request = (
    trigger: ScheduleTrigger | EventTrigger,
    input: Json,
    requestId: string,
  ): Start => ({
    workflowId: trigger.workflowId,
    version: deps.workflow(trigger.workflowId).latestVersion,
    input,
    requestId,
    ...(trigger.runTitle !== undefined ? { title: trigger.runTitle } : {}),
    ...(trigger.tags !== undefined ? { tags: trigger.tags } : {}),
  });
  return {
    schedule: (trigger: ScheduleTrigger, input: Json, slot: string) => {
      const q = request(trigger, input, `schedule:${trigger.id}:${slot}`);
      const result = deps.starts.resolve(q, () => ({
        run: deps.costs.automated(
          deps.newRun(q, {
            triggerId: trigger.id,
            scheduledAt: slot,
            waitForPrevious: trigger.overlapPolicy === 'queue',
            previousRunIds: deps.store
              .activeRuns()
              .filter((r) => r.schedule?.triggerId === trigger.id)
              .map((r) => r.id),
          }),
        ),
        reused: false,
      }));
      return deps.run(result.id);
    },
    event: (
      trigger: EventTrigger,
      payload: EventPayload,
      eventId: string,
      chain: string[],
    ) => {
      const q = request(
        trigger,
        payload as unknown as Json,
        `event:${trigger.id}:${eventId}`,
      );
      const result = deps.starts.resolve(q, () => ({
        run: deps.costs.automated(deps.newRun(q, undefined, chain)),
        reused: false,
      }));
      return deps.run(result.id);
    },
  };
}
