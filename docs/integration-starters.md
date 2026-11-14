# Connect GitHub issues

This starter is experimental: it has not yet been run against live GitHub.

The bundled **GitHub issue intake** starter connects Interlock to GitHub with existing features: schedules, Fetch, Scripts, Secret variables and [idempotent run starts](idempotent-run-starts.md). It needs no agent. It reads open issues with your label. For each one it starts a run, then replaces your label with a picked-up label. It writes nothing else.

Add it from **Workflows → Import → Starters**, or with `interlock import-starter github-issue-intake`. The file is [workflows/github-issue-intake.json](../workflows/github-issue-intake.json). Adding the starter publishes a copy and starts nothing. It ships no automation; you create it, and it stays off until you turn it on.

## Credentials

The starter needs one Secret, `github_token`. Adding the starter creates it without a value. If the name is taken, the new Secret gets a suffix, such as `github_token_2`. Every copy of the starter uses the same Secret. Runs refuse to start until you set it: open **Variables**, select the Secret, choose **Set value** and save. A file import of the same JSON asks you to bind or provision the Secret instead.

The GitHub token reaches GitHub only in the `Authorization` header of the two GitHub Fetch steps, through a header bound to the Secret. It is never workflow input, never in a URL, and Interlock redacts it from run history. Requests with a Secret header do not follow redirects, so use the repository's current owner and name.

Use a fine-grained GitHub token limited to the repository, with **Issues: Read and write**. Read is enough for listing; write is for the label change.

## GitHub issue intake

### Set it up

1. In the repository, create two labels: one people apply to request a run, such as `interlock`, and one that marks an issue as picked up, such as `interlock-started`.
2. Publish the workflow each issue should start (the target), and note its ID from its page or `GET /api/workflows`. Its input contract must accept the fields in [What the target receives](#what-the-target-receives).
3. Add the starter and set the `github_token` Secret.
4. Open **Automations → New automation → Schedule**. Choose **GitHub issue intake**, an interval of 5 minutes, and enter `owner`, `repo`, `label`, `pickedUpLabel` and `targetWorkflowId`. Keep the overlap policy on **skip**.
5. Turn on **Enable when created**, or create it and use the **Enabled** switch later.

From the CLI, create the schedule disabled and enable it with the revision that `create` returns:

```sh
interlock triggers manage '{"action":"create","workflowId":"INTAKE_WORKFLOW_ID","config":{"name":"Issue intake","timing":{"type":"interval","intervalMs":300000},"input":{"owner":"OWNER","repo":"REPO","label":"interlock","pickedUpLabel":"interlock-started","targetWorkflowId":"TARGET_WORKFLOW_ID"},"overlapPolicy":"skip","missedFirePolicy":"skip","pauseAfterConsecutiveFailures":5}}'
interlock triggers manage '{"action":"enable","id":"TRIGGER_ID","expectedRevision":1}'
```

### What each poll does

1. **List labeled issues** asks GitHub for one page of up to 100 open issues with your label, oldest first. An error answer, such as `403`, `429` or `5xx`, fails the poll before anything starts or changes.
2. **Choose new issues** drops pull requests, then takes up to 20 issues. Label names are compared without case. An issue that already carries the picked-up label is only relabelled, never started again.
3. For each issue, **Start target run** is a short Script that calls this Interlock's [HTTP API](http-api.md), `POST $INTERLOCK_URL/api/runs`, with a request key. It sends `INTERLOCK_API_TOKEN` when the server requires the token. **Swap labels** then sets the issue's labels to its current ones without your label and with the picked-up label.
4. **Report picked-up issues** returns the started issue numbers and run IDs. If any issue could not be started or marked, the poll fails and its error names the issues. The other issues in the same poll are still handled.

Each poll is one run in **Runs**. Use [history cleanup](history-cleanup.md) to keep old polls from piling up.

### Duplicate starts

The request key is `github:OWNER/REPO#NUMBER:TARGET_WORKFLOW_ID`. When that is longer than 120 characters, the repository and target are replaced by a SHA-256 prefix: `github:HASH#NUMBER`. Interlock stores every accepted key in its database, so a key never starts a second run, also after a restart. Because the target is part of the key, two intakes with different targets each start their own run for the same issue.

If the label swap fails, the next poll sends the same key: the API answers `202` with the original run when the issue is unchanged, or `409` when the issue was edited in between. Both mean this intake already started the issue for this target, so the step swaps the labels again without starting anything. Any other status fails that issue. The picked-up label keeps the issue out of later starts; the key is the guarantee if a label is lost or removed by hand.

To deliberately run an issue again, start the target yourself with a new key. Removing the picked-up label and adding your label back does not start it again.

### Who can start a run

The gate is the label. In GitHub, only people with triage access or higher can apply labels, so issue authors cannot start runs by themselves. Do not use a label that an issue template or a GitHub automation adds to new issues, because then anyone who opens an issue can start a run. Pull requests are skipped.

### What the target receives

```json
{
  "issue": {
    "repository": "OWNER/REPO",
    "number": 12,
    "url": "https://github.com/OWNER/REPO/issues/12",
    "author": "login",
    "labels": ["bug", "interlock"]
  },
  "untrustedIssueText": { "title": "…", "body": "… (first 20,000 characters)" }
}
```

The run is titled `OWNER/REPO#12` and tagged `source: github-issue` and `issue: 12`. Anyone who can open an issue writes `untrustedIssueText`. In the target's Agent prompt, present it as a request to evaluate and say that it carries no instructions about tools, permissions, files outside the task or other workflows. Keep those decisions in the prompt, the [permission policy](permission-policy.md) and Human input approvals.

### Rate limits and the interval

A poll makes one GitHub request to list issues and one per issue it marks. An authenticated token gets 5,000 requests per hour, so the default 5 minutes is far below the limit. Use 60 seconds as the lowest interval; Interlock refuses intervals under 30 seconds. To change it, edit the schedule's timing in **Automations**. To take more than 20 issues per poll, change the limit in **Choose new issues** and the Batch limit in **Each new issue**. The starter sends no conditional requests: an ETag or `since` cursor would need state carried between polls, and swapping labels already keeps each list short.

The label swap replaces the issue's whole label list, so a label someone adds between the list and the swap is lost.

Issue comments are not read. Answering a run's Human input from an issue comment is not supported yet.

## Adapt the pattern for another source

The intake is the template for any source that lists items as JSON: another tracker, a chat channel, a mailbox API. Copy the workflow and change three steps:

1. **List**: the Fetch URL, query and headers. Bind the source's token to a header from a Secret.
2. **Choose new items**: map each item to a stable request key (`SOURCE:CONTAINER#ID`, at most 120 characters), the start body and the data for the mark step. Put the item's text under an `untrusted…` field.
3. **Mark**: the source's way of showing that an item was taken, such as a label, status or reaction. If the source has none, delete the step and connect **Start target run** to the end of the Batch; the request key alone still prevents duplicate starts, but every poll asks for the same items again.

Keep the Batch, **Start target run** and the report step unchanged.
