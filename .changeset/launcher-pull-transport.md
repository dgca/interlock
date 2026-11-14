---
'@type_of/interlock': patch
---

Custom launcher profiles can use `transport: "pull"` for hosts Interlock cannot call, such as app plugins, browser extensions and runners behind NAT. Interlock queues `launch`, `status`, `message`, `stop` and `archive` operations, and one client per profile polls for them, holds each on a short lease, and reports the result. Clients authenticate with a rotatable launcher credential. The launch keeps its idempotency key and single-use claim ticket. An operation whose lease expires returns to the queue, and a launch result that arrives after Interlock stopped waiting queues a stop. While no client has polled recently, work for the profile stays unclaimed and is reported as `launcher_client_offline`.
