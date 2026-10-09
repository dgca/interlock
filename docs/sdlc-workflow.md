# Use the SDLC workflow

Fresh Interlock libraries include **SDLC workflow**, published as version 1. It takes a software change request through intent, specification, implementation planning, construction, and independent review. It records decisions and verification evidence in the target repository.

## Connect a coding agent

Follow [Connect a harness](connect-harness.md) to connect your agent through MCP. Run the agent in the Git project you want to change, or supply `repoPath` explicitly. The agent needs file access, Git, and the project's development tools. Browser access is needed when the change requires checking actual UI interactions.

The final reviewer must use a new session or an isolated subagent without inherited implementation history. Interlock does not launch sessions or provide model execution. If your agent cannot create an isolated reviewer, continue that assignment in another fresh connected session with access to the same repository. The workflow blocks review when fresh context is unavailable.

The starter names no model, provider, required tool implementation, or external skill. Its inline prompts discover repository instructions and relevant checks. Use your agent's normal permissions and model settings.

## Start a change

Ask your connected agent:

```text
Find the Interlock workflow "SDLC workflow" and inspect its input contract.
Run it with {"request":"Improve this project's setup instructions and verify the documented commands."}.
Complete its assignments. Pause for unresolved human decisions and use a fresh
session or isolated subagent for final review. Return the verified result.
```

Replace the request with your intended change. Only `request` is required. The agent resolves the Git checkout from its project context, then reuses a matching task directory or chooses `.tasks/<outcome-slug>/`. It asks if the repository or task is ambiguous. The server's working directory does not determine the target project.

The workflow creates or reuses a task branch under repository conventions. It commits accepted `intent.md`, `spec.md`, and `plan.md` artifacts, followed by the implementation, tests, and affected documentation. It preserves unrelated changes and does not merge or deploy.

For UI changes, the specification includes a brief proposal for the user flow, affected states, layout and actions, keyboard and focus behavior, and narrow-screen behavior. The implementation plan pairs the change's highest-risk failures with direct checks and expected outcomes. It assigns implementation checks to the builder and independent checks to the existing fresh reviewer. These responsibilities use the same planning artifacts and review steps.

## Choose inputs

| Input          | Behavior                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request`      | Required nonempty description of the change and its purpose.                                                                                                                                      |
| `repoPath`     | Optional target Git checkout path, resolved by the executing agent.                                                                                                                               |
| `taskDir`      | Optional directory relative to the checkout. It must remain inside that checkout.                                                                                                                 |
| `reviewPolicy` | `auto` by default. Ask for unresolved consequential decisions and honor repository or user approval requirements. `always` requires human approval of each ready intent, specification, and plan. |
| `createPr`     | `false` by default. `true` requests creating or updating a PR after successful review. Missing remote access or credentials can be reported as verified local completion.                         |

Defaults guide the executing agent during setup. The workflow still requires that agent to read assignments, resolve configuration, run checks, and submit truthful results.

## Resume and review

Reuse the existing run and recorded task directory when continuing a change. Do not start a duplicate. Your agent can inspect run summaries and briefings through MCP, claim available assignments, and continue the [assignment loop](connect-harness.md#complete-a-run).

Human decisions pause the workflow. The agent shows the artifact and focused questions, leaves the decision assignment unclaimed, and continues after your explicit answer. Automatic planning review does not invent human approval.

Final review checks the complete task diff, observable acceptance evidence, and repository standards at the exact committed candidate. The reviewer inspects actual saved proof and checks a relevant boundary independently. Valid proof can be reused after inspection; affected behavior, unreliable proof, material gaps, or suspected failures require further checks. Findings return to implementation. Later review can focus on localized fixes while preserving verified evidence with its original commit; broader changes require a full review. Delivery checks that the branch still matches the reviewed commit.

## Existing libraries

Startup seeds the SDLC starter once in a fresh library. Upgrading preserves existing workflows and published versions, including older examples or a customized SDLC. Deleting all workflows does not seed them again. Starter updates apply to new libraries; they do not rewrite your copies or active runs.

### Import the starter into an existing library

1. Open **Workflows → Import → GitHub folder**.
2. Enter `https://github.com/dgca/interlock/tree/main/workflows` and select **Find workflows**.
3. Select **SDLC workflow** and choose **Import selected**.
4. Open the imported draft, review its settings, and select **Review & publish**.

Alternatively, download [workflows/sdlc.json](../workflows/sdlc.json) and upload it through **Import → Local file**. From a repository checkout with Interlock running, the CLI accepts the same file:

```sh
interlock import @workflows/sdlc.json
interlock publish WORKFLOW_ID
```

Replace `WORKFLOW_ID` with the ID returned by import. The file contains the starter's name, description, and definition, shared with fresh-install seeding. Each import creates a separate draft with a new ID. It does not replace a customized SDLC, retain someone else's run history, or start a run. Publish the copy to make it runnable.
