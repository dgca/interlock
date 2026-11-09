---
'@type_of/interlock': patch
---

Wait for the engine health check before starting the development UI with `pnpm dev`, preventing proxy connection errors during startup. Stop startup with a clear error if the engine does not become healthy within 30 seconds.
