---
'@type_of/interlock': patch
---

Add polling Waits: a Wait node can run a Script or Fetch check on an interval until the check output at a path equals a value, then continue with the check output merged into its input. The slow work stays outside the node, so a restart only repeats the check. An optional deadline routes the original input through a Timeout branch. Run inspection shows the next check time and the latest check result; one execution counts once against the step limit.
