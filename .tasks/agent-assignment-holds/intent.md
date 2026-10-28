# Hold and resume Agent work

Implement #136 after PR #164, as a second open PR based on codex/agent-result-rules. The user selected autonomous direct implementation after considering SDLC. Existing first-PR task artifacts and verification remain intact.

Outcome: cooperative workers and local coordinators can declare an external blocker without spending failure/expiry allowance, later resume with a fresh claim, and inspect durable blocked intervals. Do not replay external work or pause unrelated work. Keep MCP to one grouped lifecycle operation, using existing briefings and inspection for discovery.
