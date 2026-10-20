# Compact MCP response contract

See [intent](intent.md) for scope and authorization.

## Required behavior

- AC1: Omitting detail on MCP start_run or submit_result returns the compact continuation shape. Explicit summary returns the same shape. Omitting fields on list_work returns summaries. Full is an explicit supported option on all three tools.
- AC2: Explicit full payloads equal existing shared full API inspection or assignment results. claim_work supplies the full composed prompt, input, output contract, token, and applicable execution instructions. UI, CLI, and shared full API behavior remain unchanged.
- AC3: Compact start and submission responses add nextCall, a suggested read-only MCP call with tool and arguments, or null. For inspect_result on a completed run, suggest get_run_result with id. For inspect_failure and cancelled inspect_result, suggest get_run_briefing with id. For wait_for_worker and wait_for_change, suggest wait_for_run_change with the same runId and cursor. For claim_work, use null: select from nextWork and claim with actual worker identity and capabilities. A truncated nextWork list can be expanded through list_work. Suggestions neither execute work nor claim completion of detached descendants.
- AC4: Retain existing lifecycle scope, workRunId, cursor snapshot, bounded nextWork, exact totals, limits, current-state replay, and rejected-input behavior. Start/submission summaries omit definitions, history, prompt and input/output bodies. Keep the existing size regression ceiling on representative large workflows.
- AC5: Both HTTP and stdio discover matching input/output contracts, defaults and guidance, and return matching structuredContent and JSON text. nextCall schemas describe valid callable arguments. Default execution can finish a workflow and retrieve its final output without full inspection.
- AC6: Instructions describe current contents and next actions without historical assumptions. Document selected result reads, failures, declared claim capabilities, detached lifecycle distinctions, truncated discovery, and reading get_run rather than repeating start_run for inspection. A dedicated migration section explains full options and shape changes for 0.1 consumers. A pending minor changeset targets 0.2.0; package version and changelog stay release-workflow owned.
- AC7: Execute this SDLC run using explicit summary start/submissions and summary work discovery; record response sizes and actual output retrieval. Record why the isolated baseline server is used. Automated checks exercise omitted defaults on the candidate implementation.

## Decisions and risks

nextCall belongs to the MCP adapter, because its tool names are transport-specific. Runtime continuation remains the authority for state and next. No suggestion invents worker identity or authorizes mutation. Null for claim_work avoids guessing a qualified executor. Existing next already directs agents to claim work, and nextWork provides the required discovery metadata.

The MCP defaults change field locations: full start uses run.id and run.status, while summary uses runId and runStatus. Summary submission runId can identify an enclosing lifecycle; workRunId identifies the assignment's immediate run. Full responses remain available for fixed parsers. Consumers needing final values explicitly read get_run_result; the last submitted value need not equal the final workflow output.

The read-only guidance covers only default mutation summaries. Existing get_run_briefing and wait results retain their contracts. No UI change or persistence migration is required. No unresolved product decisions remain.
