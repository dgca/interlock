---
'@type_of/interlock': minor
---

Add List nodes with visible item paths grouped on the main canvas using React Flow Sub Flows. Add ordinary steps inside each List; connect each item path from Start to End, and use Out for the ordered collection. Group membership is explicit and validated, without a nested editor. Lists support bounded concurrency, failure policies, cancellation, and retries that preserve successful items. Persist item runs against published graphs for inspection and root-run work discovery. Existing Map nodes retain their referenced-workflow behavior and appear as legacy nodes.

Standardize external handle labels as In and Out, while keeping Input and Output in settings. Show shared workflow contracts on Entry and Exit, and make List's array input requirement explicit.

Explain agent handoffs before execution and on waiting runs, including assignments inside Lists and nested workflows. Add actions to copy continuation instructions for the existing run and open agent connection settings.
