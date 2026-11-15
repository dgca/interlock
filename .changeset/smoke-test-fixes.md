---
'@type_of/interlock': patch
---

Fixes from release testing:

- JavaScript Scripts no longer receive `ELECTRON_RUN_AS_NODE`, so programs they start behave normally. The desktop app still uses it to start Scripts, then removes it before Script code runs. In the desktop app, a Script that needs another Node process should run `node` from `PATH` instead of `fork()` or `process.execPath`.
- When Interlock is already running, `interlock` no longer names a database it has not checked. It says when the running server may be using a different database.
- Setting `enabled` on a variable now returns only the explanation, in MCP and in the CLI. The CLI prints other rejections that Interlock explains itself as plain messages with the field they apply to.
- `interlock doctor` names a missing variable by the environment variable or header that uses it and its step, with the variable ID after.
- The installation guide and README explain that the desktop app's default working directory differs from the CLI's.
