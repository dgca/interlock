# Hold behavior

Hold only active available or claimed Agent work using the current claim attempt and hold revision. Optional claim token validates cooperative ownership; the local coordinator can act without a token, like existing cancel/budget controls. Actor, fixed blocker category, bounded reason and checkpoint reference are required. Interlock does not stop the executor process. Callers stop external activity cooperatively.

Holding invalidates result/renewal authority, ends the usage attempt as held, and suspends the remaining unclaimed timer. A claimed assignment resumes with a full unclaimed interval. Resume makes work available without creating a claim or resetting run budgets, failures, expiry counts, captured input/rules, or continuity requirements. Claim attempts remain monotonic; claims released by holds do not spend the legacy combined failure/expiry allowance. Separate allowances remain unchanged.

Expected attempt/revision reject stale changes. A repeat of the latest exact normalized change is a no-op; an intervening hold/resume conflicts. Terminal work cannot resume. Deadlines win at equality, including crossings after the initial engine pump. Cancellation closes intervals and cannot recover; detached run lifetime remains independent. Holds and receipts survive restart.

One MCP tool groups hold/resume and paginated read-only history. Mutations return compact state, history defaults to 20/max 100 intervals, and existing briefings expose compact blockers and inspect_hold continuation. Full run inspection includes 20 recent intervals per affected assignment. Wall time, declared held time and time excluding holds are separate; none claims actual model active time. Reasons/checkpoint contents and credentials stay out of routine discovery and logs.

Additive document storage needs no schema migration. Workflow deletion removes associated hold history; workflow transfer excludes run state. UI shows blockers/history and supports explicit resume. CLI uses one work-hold JSON command. Verify both transports and existing claim/submission/usage/budget/context/timer/cancellation behavior.
