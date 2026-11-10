# Managed session transcript behavior

Status: accepted for implementation planning. On November 10, 2026, the user answered "Approve proposed policy" at the SDLC human specification review.

The [intent](intent.md) owns the request, outcome, scope, and constraints. Requirements below apply to new managed executions after upgrade. Existing execution records remain inspectable without fabricated historical transcripts.

## D1: Approved storage and retention policy

The user explicitly requires safeguards against excessive disk use and approved the following policy:

| Limit                                        | Proposed value                                           |
| -------------------------------------------- | -------------------------------------------------------- |
| Serialized retained entry                    | 32 KiB, including entry metadata                         |
| Retained entries per execution               | 2,000                                                    |
| Serialized retained transcript per execution | 10 MiB                                                   |
| Aggregate serialized transcript storage      | 256 MiB, including transcript rows and delivery receipts |
| Transcript age                               | 14 days after execution ends                             |

Byte and count limits both apply. Many tiny entries cannot bypass the storage policy. UTF-8 bytes determine limits, and truncation preserves valid Unicode.

Retention is automatic even when run-history retention is disabled or a run is retained for comparison evidence. Transcript expiry never deletes a run, result, usage report, pending approval, or resource reservation.

An oversized entry retains a bounded preview and its original size when known. At the execution limit, discard the oldest transcript entries to keep recent content. At the library limit, evict the oldest ended executions' transcripts first, then the oldest retained entries of active executions if necessary. Capture continues where capacity permits; otherwise omit content and record the gap without stopping the Agent. Bounded per-execution metadata records the gap and reason even after every transcript entry is removed.

Run-history deletion also removes its transcripts and message receipts. Native harness session files remain outside this policy. Expiry never extends merely because someone reads a transcript. Restart preserves the original age and budget accounting. A periodic sweep removes expired content when no new execution produces writes.

These limits bound retained serialized content rather than claiming the entire existing engine database occupies 256 MiB. Indexes, allocation, and SQLite journals add overhead. Storage must reuse freed space and bound checkpoint/write buffering so repeated capture and pruning do not grow files indefinitely. The final implementation must document its measured allocation and journal behavior. It must not impose a size limit on the engine's unrelated workflow records or run an automatic full-database VACUUM.

For the initial version, use documented fixed limits rather than adding another settings form. A capture failure or disk-full condition leaves a bounded diagnostic when possible and never changes the Agent's result or ownership. Do not retry a failed transcript write in an unbounded loop.

Alternative: stop capture at capacity. This preserves the beginning but loses the latest evidence when an Agent loops. Keeping recent content better supports the issue's debugging use case. Another alternative is unlimited capture tied only to run-history retention; that does not satisfy the user's safeguard requirement.

## Transcript content and capabilities

Capture the assignment's visible input message, assistant text, tool calls and their visible results, operator messages, and relevant execution status changes when the harness exposes them. Keep tool identity and call/result associations. Do not persist private reasoning fields, binary data, images, or complete raw transport envelopes.

Each entry identifies its managed execution attempt, ordered position, timestamp, kind, and bounded content. Repeated native notifications must not duplicate completed messages. Native session continuity does not copy previous attempts' transcripts into a new attempt.

Capabilities distinguish supported conversation capture, partial progress capture, and unavailable capture. Codex, Claude Code, and Pi expose native conversation events. Custom direct commands and launchers retain the progress and message data their existing contracts expose; label that capture partial rather than claiming a full conversation. New custom transcript endpoints and filesystem crawling are outside this increment.

Old attempts without capture show that recording was unavailable for that attempt. Unsupported harness versions return a clear capability or delivery error. A stalled capture stream does not imply the Agent itself has stalled, and transcript retention does not alter idle recovery policy.

## Redaction

Apply existing known-value Secret redaction and credential masking before storing content, computing a retained preview, reporting errors, or returning transcript data. Include the active claim token, launcher ticket, and protected values delivered through captured workflow operations that are known to this engine. Do not retrieve every library Secret just to scan transcripts or insert protected values into Agent context.

Capture skips unsafe content when redaction cannot finish within bounded work. Transcripts cannot guarantee detection of arbitrary credentials obtained independently by native tools; document that existing protection limit. Never render transcript text as executable HTML. Operator input remains ordinary task text and does not change execution permissions.

## Inspection

UI, CLI, and MCP use the same transcript read operation for one exact managed execution ID. Reads default to the newest 50 retained entries, cap at 100 entries and 256 KiB per response, and return a stable sequence cursor for older or newer content. A large entry cannot bypass the response byte cap.

Return retention limits, retained bytes, capture capability, completeness/gap metadata, and continuation information. A page cursor whose entries were pruned returns a bounded gap description and a usable next cursor. Unknown IDs fail explicitly. Reads do not advance the workflow or renew claims.

Ordinary run discovery, briefings, and executor inspection continue returning compact status. They may include capability and retention summaries but never embed a full transcript. CLI and MCP reads and messaging extend the existing executor operations rather than adding redundant discovery tools.

## Operator messages

A message targets one exact active managed execution attempt. Delivery requires that the same attempt still owns its assignment and has a supported live transport. Check lifecycle and ownership immediately before dispatch. A finishing, stopped, cancelled, replaced, or interrupted attempt cannot receive a message intended for its successor.

Codex uses active-turn steering with the expected turn identity. Claude Code uses the live query's input stream. Pi uses steering within the existing Agent run. Custom launchers use their captured message command or URL. Direct custom commands without such a channel are unsupported. Messaging never starts a new turn after completion or silently launches a replacement session.

Use a caller-generated request ID and persist an acknowledgement record before external delivery. Reusing the ID with identical content returns the same receipt without sending twice. Changed content under the same ID rejects. Receipts distinguish pending, accepted by harness, failed before delivery, and unknown delivery. A timeout or restart after dispatch can produce unknown delivery; inspection and retries of the same request ID do not resend it. Acceptance means the harness accepted input, not that the Agent followed it.

Messages contain 1 through 4,000 characters. Bound delivery receipts to 100 unique operator messages per execution and reject further sends without dispatch. Message bodies live only in budgeted transcript content, rather than being duplicated in unbounded event payloads. Audit metadata records the execution, request ID, local operator label/source, timestamps, and outcome. Labels are attribution in this single-user service, not authenticated identity.

Do not evict receipts needed to deduplicate a still-active execution. If protected receipts exhaust the aggregate budget, reject new messages before dispatch and omit new capture with an explicit capacity diagnostic. After transcript expiry or deletion, an old request ID cannot become permission to resend: the targeted execution is terminal or absent. Inspection distinguishes a pruned receipt from a new request.

Pending permissions and questions retain their existing response controls. A message does not answer or approve them. Unsupported or temporarily unavailable delivery includes a reason and preserves the typed message.

## UI proposal

This is an Operate surface for someone inspecting a slow or misdirected execution. Preserve the existing managed-execution header, approvals, recovery controls, session links, and design system.

- Add an expandable **Transcript** reader beside the existing session/progress details. Opening it loads a bounded recent page. Earlier attempts are selectable and clearly labeled, with messaging restricted to the current active attempt.
- Show timestamps, speaker or tool labels, selectable wrapped text, and expandable tool details. Use the existing technical font for commands and results. Oversized results stay bounded even when expanded.
- Put capture gaps and retention notices next to the reader. Distinguish no messages yet, capture unsupported, partial capture, pre-upgrade history unavailable, truncation, expiry, and budget eviction.
- Place a multiline **Message agent** field and **Send message** button with the active transcript. Enter inserts a newline. Sending is explicit. Tab reaches the reader controls, field, and button with visible focus.
- Disable repeat sends while pending. Keep text after a definite rejection. On accepted delivery, clear that submitted text and show the receipt even if the following refresh fails. Unknown delivery preserves the request identity and offers a status read rather than another send.
- Preserve scroll position while someone reads older content. Offer a **Latest** action when new entries arrive. Do not announce each streamed token to screen readers or steal focus during refresh.
- Initial loading uses the existing skeleton pattern. Refresh errors retain the current page and offer Retry. Switching attempts cannot display a late response from another attempt or carry a draft message to a different execution.
- Narrow inspection remains a single scrolling page. Controls wrap within the panel, content does not force horizontal page overflow, and tool text remains keyboard accessible.

## Acceptance criteria

- AC1: Supported native captures retain visible messages, correlated tool calls/results, and operator messages across restart, scoped to the exact attempt. Unsupported and partial capture are explicit.
- AC2: D1's byte/count limits apply before storage growth, including oversized and multibyte input. Retained transcript and receipt accounting stays within the aggregate budget across many active and ended attempts.
- AC3: Automatic age and budget pruning work while run-history retention is disabled and after restart. Reads report gaps accurately. Run deletion removes associated transcript data without touching native files.
- AC4: Repeated capture/prune cycles reuse storage and keep journal/buffer growth bounded. Capture faults, disk-full conditions, and exhausted capacity do not fail, block, retry, or change the assignment's execution.
- AC5: Known protected values and claim/ticket credentials do not appear in stored transcript content, returned pages, or capture/delivery errors. Unsafe redaction fails closed without stopping the Agent.
- AC6: Transcript reads enforce entry and response byte bounds, support stable paging around pruning, and do not expand routine run or MCP discovery responses.
- AC7: Supported operator delivery stays in the active execution, preserves permissions and claim lifecycles, records attribution and outcome, and rejects stale or unsupported targets.
- AC8: Repeated requests, lost responses, terminal-state races, and restart cannot cause automatic duplicate delivery. Message and receipt limits reject before external dispatch.
- AC9: The UI supports the proposed inspect/read/send journey, attempt selection, narrow layout, keyboard access, retained drafts on rejection, and acknowledged or unknown delivery after refresh errors.
- AC10: README, managed-execution guidance, current limits, CLI help, MCP discovery and affected history guidance describe the final capabilities, bounds, pruning, and delivery semantics consistently. Ship a pending patch changeset for the public package.

## Evidence and open decisions

Verified repository facts: `ExecutorManager.log` retains 20 bounded progress rows in the persisted execution record. Native adapters currently discard most message/tool payloads. `secretRedaction` supplies known-value masking. `HistoryRetention` is opt-in, and SQLite cleanup currently reports reusable space without compaction.

Native contract evidence: [Codex active-turn steering](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn), [Claude Agent SDK input](https://code.claude.com/docs/en/agent-sdk/typescript), and the installed Pi 1.5.0 `docs/rpc-commands.md` steering contract. Implementers must verify installed-version compatibility; a documented method alone does not establish successful live delivery.

Human decision D1 is settled by the user's "Approve proposed policy" response. Exact implementation, storage structure, and targeted validation belong in plan.md.
