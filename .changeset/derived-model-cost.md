---
'@type_of/interlock': patch
---

Usage reported with tokens but no cost now gets a cost derived from a local, versioned price table of Claude and OpenAI list prices. Run usage, the run inspector and workflow reports include it, mark it as derived, and list the prices assumed and the models with no price. A run keeps the table it first used, so editing the table with `interlock prices` affects later runs only. Usage reports accept an optional `cacheWriteInputTokens`, which the Claude Code executor now fills.
