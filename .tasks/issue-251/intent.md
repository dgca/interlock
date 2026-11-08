# Automatic history retention

Source: GitHub dgca/interlock#251, under unattended pipelines parent #223.

Unattended factories accumulate ended run history. Operators need an opt-in policy that periodically removes old run trees while retaining the evidence and ownership required by live work.

The change adds age and count retention at library scope with workflow overrides, settings controls, and bounded operational evidence. Existing manual cleanup remains available. Runtime owns policy execution and shares its dependency-safe deletion path with manual cleanup. SQLite pages become reusable; automatic VACUUM is outside scope.

Existing libraries retain all history until configured. Protected trees, workflows, definitions, durable start and trigger receipts, native harness files, and trial files remain protected by their existing contracts. Automated checks use temporary stores only.

The user authorized unattended SDLC with reviewPolicy auto and routine design decisions. The combined human UI pass is deferred until all queued issues merge. The author stops before claiming final fresh review and performs no push, PR, or merge before parent handoff.

No material intent questions remain.

Task branch: `feat/issue-251`.
Original baseCommit: `447d49e2d2b542d2451d27e4b94c59c0756d0daa`.
