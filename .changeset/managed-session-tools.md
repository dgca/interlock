---
'@type_of/interlock': patch
---

Claude Code, Codex and Pi sessions that Interlock launches can save workflow memory notes and call workflow tools. Interlock attaches two tools of its own, `save_memory_note` and `call_workflow_tool`, and handles each call against the claim it holds, so the session never receives a claim token or other credential. Saving is write-only and keeps the usual review, pending limits, prompt budget and escaping. The tools are off at Read only and need no approval at Standard or Full access, and the prompt mentions them only when they are attached. Built-in harnesses no longer receive the tool-only credential in their prompt or environment. Codex needs its experimental dynamic tools; when they are missing or rejected the session runs as before. Execution details record whether the tools were attached, and why not.
