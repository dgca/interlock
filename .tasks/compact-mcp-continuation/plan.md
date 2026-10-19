# Implementation and verification plan

Follow [spec.md](spec.md) AC1-AC9 and the scope in [intent.md](intent.md). No interactive UI behavior changes, so no browser journey is required.

## Verified code facts

Engine.start and Engine.submit pump the scheduler and return inspect. Both MCP transports register packages/mcp/src/server.ts, with stdio using packages/mcp/src/client.ts. Existing typed UI and CLI consumers expect full inspection. Continuation.briefing already projects metadata, lifecycle IDs, bounded work, next actions, deadlines and scoped cursors. Storage excludes assignment payloads and context instructions from that projection.

The installed MCP SDK is 1.30.0. Its registerTool output schema normalization only accepts an object root. A top-level union is not advertised or validated correctly. Keep the wire shape unchanged and advertise an object schema describing fields from both response modes; validate complete compact results with their stricter core schema. Full inspection fields stay permissive where legacy data is open-ended. For list_work, the existing structured {items} wrapper supports a normal item union. Verify discovery on both transports rather than trusting schema conversion.

## Build sequence and ownership

1. Build owns a red-capable regression in tests/mcp-continuation.test.ts through real HTTP and stdio. Start a sequential workflow with 30-plus nodes and large prompt/input data using detail: summary. Assert selected text and structured responses omit payload markers and stay under 4 KiB. Initially, the old handler ignores detail and returns full inspection, so this test must fail on the actual symptom. Record the baseline. AC2-AC3, AC8.
2. Define selection/limit and compact response schemas in core. Extract shared mutation execution from full inspection in runtime without changing sequencing or idempotency. Add startSummary and submitSummary operations through the shared server/client. Validate limits before mutation. Build compact response from one briefing after pumping and resolve submission lifecycle by existing parent/detached rules. AC1-AC7.
3. Add MCP mode dispatch, input descriptions and output field schemas. Preserve full defaults, error handling, JSON text shape and full claim behavior. Add list_work structured output schema for its current full/summary item modes. AC1, AC8.
4. Extend runtime/shared API and transport tests for lifecycle scope, metadata, replay, wait cursor, list cap, downstream failure, timer waits and compatibility. Build owns implementation evidence. AC1-AC8.
5. Update README, docs/agent-workflows.md, docs/connect-harness.md, docs/architecture.md and docs/v1.md where affected, plus MCP server instructions and related continuation tools. Check CLI help remains accurate. Add a pending patch changeset for @type_of/interlock. AC9.
6. Run relevant tests, pnpm build, and pnpm format:check. Run the whole test suite once to check shared runtime mutation extraction. Packaging behavior and version do not change, so package smoke is not required unless evidence suggests a packaging risk. Commit the implementation and evidence. Build must not claim independent review.

## Highest-risk checks

| Risk                                                                      | Direct check and expected result                                                                                             | Owner                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Oversized hidden payload survives selected response                       | Real transport size/marker checks on text and structured data before and after multiple stages; full remains much larger     | Build                        |
| Child completion hides parent or sibling work                             | Complete waited child and Batch item; summary scope is owning lifecycle and next work includes newly unlocked parent/sibling | Build and independent review |
| Detached submission escapes its lifecycle                                 | Submit inside detached subtree; scope stops at detached ancestor, ancestry remains original root                             | Build                        |
| Cursor describes a different snapshot/scope                               | Wait with returned runId/cursor at zero timeout reports no reset and no change absent a write; next write wakes it           | Build and independent review |
| Invalid options mutate state                                              | Invalid limit/detail through real transport with valid control; assert no new run or changed work on rejection               | Build                        |
| Repeated submit transitions twice                                         | Identical retry after later progress returns current state; execution count unchanged; conflicting result rejects            | Build                        |
| Legacy callers lose fields or schema validation rejects valid legacy data | Existing transport suite plus explicit full/default calls preserve run/definition and array text versus structured wrapper   | Build and independent review |
| Full details leak through requirement metadata                            | Large prompts, saved context instructions and output values excluded; fresh mode/tools/skills retained                       | Build                        |

## Independent review and delivery

Fresh isolated reviewer reads the committed intent/spec/plan and entire task diff at the exact candidate commit. It inspects saved build evidence and independently checks a relevant child lifecycle or transport compatibility boundary. It reviews affected docs and MCP flows, records findings and its reviewed commit, and returns feedback through the existing SDLC review assignment. Builder fixes material findings and obtains re-review before delivery. PreparePr checks that delivered code still matches reviewed commit and finishes locally because createPr is false.

Evidence records commands, outcomes, candidate commit and limitations in this task directory. No claims of reproducing the work-laptop client's exact token accounting or auditing the entire MCP tool set.
