---
'@type_of/interlock': patch
---

A permission policy without an `edit` rule no longer auto-allows a command that writes a file through a redirection (`>`, `>>`) or an output option (`git --output`, `git format-patch -o`, `sort -o`); such commands now ask. Output to `/dev/null` is still allowed.
