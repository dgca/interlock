# Implementation and verification

Follow [intent](intent.md) and [spec](spec.md).

1. Add core stage/title/projection contracts. Extend compact storage metadata with bounded poll output while preserving payload omission. Implement one runtime projection used by continuation, inspection, server lists, and new event snapshots. Cover AC1–AC6 and AC8.
2. Add Stage to the existing node Work section, and shared projection text to run rows/inspector. Preserve existing Mantine controls. Cover AC1 and AC7.
3. Test nested waited and detached stages, deterministic sibling ties, current waiting categories, progress versus human blockers, bounded poll output, stable timestamps across reads/restart, title identity, summary parity and transport discovery. The highest risk is declaring a whole tree human-blocked while one sibling can advance; test that directly with a mixed Batch tree and a fully blocked control.
4. Use an isolated temporary database and UI port. Journey: open an Agent settings dialog, type Stage, apply/save/publish, start a run, confirm Stage and caller waiting text in the actual inspector and Runs row, then reopen settings to confirm persistence. Capture interaction assertions and rendered screenshots. Check narrow width for wrapping. Cover AC1 and AC7.
5. Update required docs, README, relevant CLI help and complete affected MCP lifecycle descriptions, keeping future capabilities explicit. Add a patch changeset. Check transport discovery over HTTP and stdio.
6. Run pnpm test, pnpm build, pnpm format:check. If CLI changes are needed, run pnpm test:package after the build. Fetch/rebase origin/main and repeat required checks before committing the final candidate. Save concise proof in this task directory and return the exact candidate/base and workflow Review change assignment to the coordinator without claiming that fresh review or delivering the PR.
