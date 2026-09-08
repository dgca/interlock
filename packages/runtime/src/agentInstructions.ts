export function freshContextInstructions(rootRunId: string, workId: string) {
  return `This assignment requires fresh context.

Run it in a fresh session or an isolated subagent without inherited conversation history. Pass only the assignment's prompt, input, context instructions, required capabilities, output contract, root run ID (${rootRunId}), and assignment ID (${workId}).

The isolated executor must claim the assignment with freshContext: true, perform the work, and submit a result matching its output contract. Declare only tools and skills it can actually use. Do not claim fresh context in the current conversation.

If you cannot provide isolated execution, leave the assignment unclaimed. Give the user this ready-to-paste prompt for a fresh session:

Continue existing Interlock run ${rootRunId}. Do not start a new run. Inspect assignment ${workId} through list_work for that root run. This assignment requires fresh context; claim it with freshContext: true only if this session has no inherited conversation history. Follow its prompt, input, context instructions, and required capabilities. Submit a result matching its output contract, then continue the existing run until it completes, fails, or requires another handoff. Honor each subsequent assignment's context requirements.

Tell the user to paste that prompt into a fresh session with Interlock connected.`;
}
