---
'@type_of/interlock': patch
---

Two bundled starters connect Interlock to outside systems. **GitHub issue intake** runs on a schedule you create: it lists open issues with your label, starts one run of your workflow per issue with a request key, so an issue never starts twice, and replaces the label with a picked-up label. Issue text reaches the target as `untrustedIssueText`. **Run notifications** is a handler for an event automation that posts `{"text": ...}` to a Slack-compatible webhook when a run completes, fails or needs attention. Adding either starter creates its Secret (`github_token` or `notify_webhook_url`) without a value; set it in Variables before the first run.
