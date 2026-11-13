---
'@type_of/interlock': patch
---

Ship the Claude Agent SDK's license in `dist/licenses/claude-agent-sdk.md`, since `dist/cli.js` bundles part of the SDK and that code is not covered by Interlock's MIT license.
