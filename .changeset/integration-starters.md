---
'@type_of/interlock': patch
---

An experimental bundled starter connects Interlock to GitHub. **GitHub issue intake** runs on a schedule you create: it lists open issues with your label, starts one run of your workflow per issue with a request key, so an issue never starts twice, and replaces the label with a picked-up label. Issue text reaches the target as `untrustedIssueText`. Adding the starter creates its Secret, `github_token`, without a value; set it in Variables before the first run. Scripts now receive `INTERLOCK_URL`, the server's own address, and `INTERLOCK_API_TOKEN` when the server requires the token. The MCP and CLI starter listing names a suggested board instead of its full setup; `list_workflows` with `source: "starters"` and a `starterId` returns one choice with its board setup.
