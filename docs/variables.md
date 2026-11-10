# Reuse configuration and credentials

## Create a variable

1. Open **Variables** and select **New variable**.
2. Enter a unique name, such as `service_api_token`.
3. Select **Secret** for credentials or **Config** for ordinary configuration.
4. Enter the value and select **Create**. Leave a Secret value empty to
   provision it later with **Set value**.

Names start with a letter or underscore and contain letters, digits, underscores,
dots, or hyphens, up to 120 characters. Names are unique without case sensitivity.
Kind is fixed after creation. Values are strings of at most 16 KiB. An empty Config
value is valid. A stored Secret must be nonempty.

The editor's top bar holds **Save changes** and **Discard changes**. Discarding
restores saved fields and clears any entered Secret replacement. The back arrow
returns to Variables and asks before discarding unsaved edits.

The value field accepts multiline text for both kinds. A Secret is visible while
you enter or replace it. After saving, you can replace the value again. Config
values are visible and editable when you open the variable.

## Reference a value in a step

For Fetch, add a header and select **Variable** as its value source. Choose the
variable, then add a literal prefix if needed. For an Authorization bearer token,
enter `Bearer ` with its trailing space as the prefix. The request preview shows a
reference, not the actual value. Use the final URL for Secret headers because
these requests stop at redirects.

For Script, open **Environment variables**, select **Add variable**, and choose a
saved variable. Its name becomes the process environment name, preserving case.
Select **Change environment name** if your script expects a different name.
Names containing dots or hyphens need an environment-safe name; confirm or edit
the suggested name before applying. Duplicate environment names must be changed.
Renaming a saved variable or replacing a selected source preserves the existing
environment name. JavaScript reads
`process.env.SERVICE_API_TOKEN`. Bash reads `$SERVICE_API_TOKEN`. These entries
override matching inherited names. Only explicitly selected library values are
delivered. Polling Wait checks support the same header and environment controls.
Choose names outside `INTERLOCK_` for new bindings to avoid shadowing
[Script execution context](architecture.md#script-execution-context).
Environment values cannot contain NUL bytes. Referenced Fetch header values must
use valid Latin-1 header text without control characters, except horizontal tabs.
Invalid target values fail with the variable and target names, without quoting
the value.

Save and publish the workflow. Its definition retains IDs rather than values.
Step variable references are supported in Fetch headers and Script environments.
They are not supported in URLs, query parameters, JSON bodies, general data
bindings, Agent prompts, or harness profiles.

## Rotate or stop using a credential

Open the variable and select **Replace value**, enter the replacement, and select
**Save changes**. Subsequent runs of published workflows use it without
republishing. Existing runs keep their captured value revision through delayed
steps, retries, and restart. The editor clears entered Secret text after the
server acknowledges the write, even if a later view refresh fails.

The editor has no variable enable/disable controls. Existing disabled variables
remain disabled until restored through the CLI or shared API. To restore one,
inspect its current revision, then update it with `enabled: true`:

```sh
interlock variables read '{"action":"inspect","id":"VARIABLE_ID"}'
interlock variables manage '{"action":"update","id":"VARIABLE_ID","expectedRevision":1,"enabled":true}'
```

Replace `VARIABLE_ID` and use the inspected revision for `expectedRevision`.
Restoring access allows existing runs to use their original retained value
revisions again. Already delivered values cannot be recalled. Cancel running work
or revoke credentials at their provider when needed.

Review **Used by** before renaming or deleting. To delete a saved variable, choose
**Delete** in its header and review the confirmation. Renames preserve ID-based
references. Deletion is blocked by draft or retained published references, active
runs, and running comparisons. Remove those dependencies first. Allowed deletion
removes current protected revisions while keeping historical capture metadata.
Backups may retain encrypted data. A retry requiring a deleted value fails rather
than substituting a new value.

For a stale edit, preserve your local changes and reload the current revision
before trying again. The failed save does not overwrite another editor's changes.

## Import workflows that require variables

Use a format-4 or later portable bundle for variable references. Exports contain safe
requirements and references, never Config or Secret values or encryption keys.
Earlier bundle formats remain supported for workflows without variables.

In import preview, choose **Use a local variable** or **Provision locally, set the
value later** for each requirement. Select a compatible kind and a unique local
name when provisioning. Matching names do not attach credentials automatically.
An unset value permits importing definitions for editing but blocks run startup.
Missing references and disabled or locked values produce an actionable error.

Bindings apply throughout the instance. To redirect a portable identity, open its
current local variable, review dependencies, and use **Change binding**. Existing
runs retain their captured local identity and revision. An import cannot silently
replace an existing binding. Local bindings preserve retained published workflow
definitions.

## Use the CLI or MCP

List safe metadata:

```sh
interlock variables read '{"action":"list","limit":25}'
```

Create a Secret from a local file through stdin:

```sh
interlock variables manage '{"action":"create","name":"service_api_token","kind":"secret"}' --value-stdin < /absolute/path/to/credential.txt
```

Stdin preserves whitespace and trailing newlines. Ensure the file contains exactly
the intended value. Fetch headers cannot contain line breaks. Never put credential
values into command-line JSON.

Use the returned ID and revision for replacements:

```sh
interlock variables manage '{"action":"update","id":"VARIABLE_ID","expectedRevision":1}' --value-stdin < /absolute/path/to/replacement.txt
interlock variables read '{"action":"inspect","id":"VARIABLE_ID"}'
```

Replace `VARIABLE_ID` and `expectedRevision` with the current metadata. Read a
Config value explicitly with `action:"config_value"`; that action rejects Secrets.
Metadata edits, disable/enable, deletion, and binding changes are revision protected.

Through MCP, use **read_variables** and **manage_variables**, with the operation
under `request`. List defaults to 25 entries, maximum 100. Inspect pages workflow
dependencies and bindings with a default of 20 and maximum of 50. Returned version
samples are bounded with exact counts. Use offsets for more metadata.

Prefer the local browser or CLI stdin when entering credentials. Sending a value
through MCP discloses it to the agent and its transport, even though Interlock
does not return that value in mutation responses. The application is local and
single-user; these controls do not establish multi-user authorization.

For CLI bundle import, pass explicit choices by portable ID:

```sh
interlock import @workflow.json --variable-bindings '{"PORTABLE_ID":{"action":"bind","variableId":"LOCAL_VARIABLE_ID"}}'
```

Use `{"action":"provision","name":"local_name"}` instead to provision an unset
requirement. Replace the example identities with IDs from the import requirements
and local metadata. MCP **import_workflows** accepts the same `variableBindings`.

## Back up or restore protected values

Open **Storage and recovery** below **Danger zone** to identify the key file. Back up
the database and its key separately. Both kinds use authenticated encryption.
The server reads the owner-only key automatically when needed; there is no
password prompt. Keys are created when the first value is stored.

The default key directory is `~/Library/Application Support/Interlock/keys` on
macOS and `$XDG_CONFIG_HOME/interlock/keys` on Linux, falling back to
`~/.config/interlock/keys`. Each vault has its own key filename. To use an existing
key elsewhere, set `INTERLOCK_SECRET_KEY_FILE` to its absolute path before starting
Interlock. Database backups and portable exports do not include keys.

Restore the original key as a regular file with owner-only access, mode `0600`.
A missing, incorrect, permissive, symlinked, or corrupted key leaves the store
unavailable. Metadata remains inspectable. Interlock does not replace the key or change stored values
to recover automatically. If the key is lost, use a new store and provision values
again. **Replace value** rotates a variable value, not the encryption key.

Encryption protects a database copy without its key. It does not isolate values
from your OS user, trusted Script code, or a compromised running server. Known
secret values are redacted before normal history and forwarding, but transformed
values or disclosures outside Interlock cannot be universally detected. See
[variable execution semantics](architecture.md#workflow-variables) for capture and
redaction behavior.
