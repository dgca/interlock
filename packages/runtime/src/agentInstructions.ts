import type { WorkRequest } from '@interlock/core';
export function freshContextInstructions(runId: string, workId: string) {
  return `This assignment requires fresh context.

Run it in a fresh session or an isolated subagent without inherited conversation history. Pass only the assignment's prompt, input, context instructions, required capabilities, output contract, run ID to continue (${runId}), and assignment ID (${workId}).

The isolated executor must claim the assignment with freshContext: true, perform the work, and submit a result matching its output contract. Declare only tools and skills it can actually use. Do not claim fresh context in the current conversation.

If you cannot provide isolated execution, leave the assignment unclaimed. Give the user this ready-to-paste prompt for a fresh session:

Continue existing Interlock run ${runId}. Do not start a new run. Use get_run_briefing for current state, get_run_result for selected data, and wait_for_run_change with the briefing cursor for finite waits. Keep get_run for full inspection. Inspect assignment ${workId} through list_work for that run. This assignment requires fresh context; claim it with freshContext: true only if this session has no inherited conversation history. Follow its prompt, input, context instructions, and required capabilities. Submit a result matching its output contract, then continue the existing run until it completes, fails, or requires another handoff. Honor each subsequent assignment's context requirements.

Tell the user to paste that prompt into a fresh session with Interlock connected.`;
}

/** Managed adapters have already established isolation; connected workers must arrange it themselves. */
export function assignmentInstructions(
  work: WorkRequest,
  options: { managedSession?: boolean; lifecycleRunId?: string } = {},
) {
  return [
    ...(work.resources?.length
      ? [
          'Exclusive Agent resources: ' +
            JSON.stringify(work.resources) +
            '. Stop using them and stop subprocesses before submitting success or reporting failure. Holding, expiry or cancellation may leave reservations uncertain; do not resume resource use with an invalid claim. These reservations coordinate cooperating Agent claims only.',
        ]
      : []),
    ...(work.trialEnvironment
      ? [
          `Local Git trial ${work.trialEnvironment.id}. Use only scoped local tools in ${work.trialEnvironment.workspace}. External writes are forbidden by this recipe. Stop all subprocesses before submitting success or failure. The harness must enforce tool scope; this directory is not an OS sandbox. Do not claim the interlock-local-trials skill unless you can honor this policy.`,
        ]
      : []),
    ...(work.context.mode === 'fresh'
      ? [
          options.managedSession
            ? 'The host has already created the required independent fresh session for this assignment. Execute the assignment in this session; do not create another session or delegate merely to satisfy fresh context. The host owns claiming, renewal and submission.'
            : freshContextInstructions(
                options.lifecycleRunId ?? work.runId,
                work.id,
              ),
        ]
      : []),
  ].join('\n\n');
}
