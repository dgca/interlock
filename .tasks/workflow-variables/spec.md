# Workflow variables specification

Status: accepted by the user on November 3, 2026, with the response "Great,
accepted!" The user confirmed before approval that the feature can be tested
locally before merge and that the server uses the separate key automatically,
without a password prompt or Secret read-back. D1 through D3 and the UI proposal
are accepted. See [intent](intent.md) for the problem, scope, constraints, source
request, task branch, and original baseline.

## Decision register

### D1. Protect values with a separately held encryption key

Recommend authenticated encryption for stored value revisions, using Node's
built-in AES-256-GCM and a random 256-bit key held in an owner-only file outside
the workflow database. Encrypt both Config and Secret values. Their distinction
controls read-back and runtime redaction, not whether storage is protected.

This supports macOS and Linux, including headless use, without a native credential
store dependency or a running desktop secret service. The alternative is an OS
credential-store backend. That gives the OS responsibility for key access but
needs a Linux availability and unattended-unlock policy and additional packaging
support. A remote vault and multiple selectable backends are outside this release.

Each database has a non-secret vault identity. Its default key is held at:

- macOS: `~/Library/Application Support/Interlock/keys/<vault-id>.key`.
- Linux: `$XDG_CONFIG_HOME/interlock/keys/<vault-id>.key`, falling back to
  `~/.config/interlock/keys/<vault-id>.key`.

`INTERLOCK_SECRET_KEY_FILE` may select an absolute key-file path instead. The path
is configuration, not the key itself. Provision the default key lazily on the
first stored value. Do not require a key to use workflows without variables.
Create new key directories with owner-only access and key files with mode `0600`.
Reject an existing key with an unexpected owner, group or other permissions,
invalid length, or a symlink at the key-file path. Never repair permissions or
overwrite an existing key silently.

Stored ciphertext authenticates its vault identity, variable identity, kind, and
value revision. Missing, incorrect, or corrupted keys produce an actionable
locked-store error. Never regenerate a key for an established vault with protected
records. Metadata discovery remains usable while locked. A failure to read a key
must not change or erase stored values.

Back up the database and key separately. Portable exports and automatic database
backups exclude key material. Restoring a database requires its original key or an
explicitly configured copy. If the key is lost, protected values are unrecoverable;
use a new store and provision values again. Value rotation is supported. Encryption
key rotation is deferred and must not be implied by **Replace value**.

This protects a database copy without its key. It does not isolate values from the
same OS user, trusted Script code, or a compromised running server. JavaScript
memory cleansing and secure removal from filesystem backups are not promised.

### D2. Pin value revisions and make revocation explicit

Recommend capturing protected value-revision references when each workflow run
starts. Rotation changes subsequent runs without republishing. An existing run
keeps its original revision through delayed steps, loops, retry, and restart.
Re-resolving the latest value at every step is the alternative. That reduces old
value retention but lets a mid-run edit change the credentials used by a retry.

Batch item runs inherit the parent capture. Ordinary and detached Workflow
invocations capture independently when each child starts. Continue-as-new
successors retain the chain's original capture. Comparisons capture current
transitive variable selections once before samples are queued; both sides and
their descendants use that capture. Selecting arbitrary historical variable
revisions per comparison side is deferred.

Retain protected old revisions while a variable exists. Rotation does not revoke
an old provider credential or destroy revisions required by existing runs. Add an
explicit **Disable use** action that rejects future consumption by both existing
and new runs. An operation already receiving a value cannot be recalled by this
action. Explain that stopping that operation requires cancellation and that
provider revocation happens at the provider. Re-enabling permits retained captures
again; it does not change their pinned revision.

Block deletion while any draft, retained published definition, active run, or
running comparison depends on the variable, including imported bindings. Otherwise
delete the current variable and its protected value revisions. Historical
inspection retains safe capture metadata. A later retry requiring deleted values
fails explicitly. Logical deletion does not erase old backups or filesystem
remnants. Report those limits in documentation.

### D3. Limit delivery and scrub output before ordinary history

Recommend these initial delivery paths for Config and Secret values:

- Fetch header values, with optional literal prefix and suffix for uses such as
  `Authorization: Bearer <reference>`.
- Explicit Script environment entries. Preserve normal Script input behavior and
  both JavaScript and legacy Bash execution.
- The corresponding Fetch headers and Script environment entries in polling Wait
  checks, under the same protection and capture rules.

Do not support variable references in URLs, query parameters, bodies, general
input/output bindings, Agent prompts, or harness profile environments in this
release. Reject those references rather than silently ignoring them. Future
executor integration may reuse the central library through an explicit contract.

Inject actual values only for the consuming operation. Saved execution inputs,
request previews, node definitions, assignments, and diagnostic summaries never
receive injected Secret values. The persisted Fetch request uses a non-secret
reference or mask where the actual header is injected in memory.

Secret delivery is for configuration and credentials, not for transporting secrets
through ordinary workflow data. Replace known secret occurrences in operation
output and errors before validation, result routing, failure routing, persistence,
or forwarding. This includes JSON strings and keys, stdout, stderr, Fetch response
headers and bodies, and polling check results. Secret-aware output handling must
not create partial leaks by truncating a known credential before redaction.
Diagnostics about redaction or invalid bindings must not quote supplied values.

If redaction changes a result so that it violates its contract, fail with a safe
error rather than routing on the unredacted result. Ordinary Config output follows
normal workflow inspection rules. Masking must not become an excuse to inject
all library values into a process or executor.

Trusted code and remote services can transform or disclose credentials. Document
that known-value redaction is an accidental-disclosure safeguard, not arbitrary
data-loss prevention. The feature does not claim to detect every encoding,
substring, derived credential, or disclosure outside Interlock's history.

## Required behavior

### AC1. Central management and lookup

Provide one instance-wide variable library. Each value has a stable ID, name,
optional description, immutable Config or Secret kind, enabled state, optimistic
edit revision, value revision when set, and timestamps. Value revisions change
only when a replacement value is written. Metadata edits do not change the value
revision captured by a run.

Names are unique without case sensitivity, contain at most 120 ASCII characters,
start with a letter or underscore, and otherwise contain letters, digits,
underscores, dots, or hyphens. References use IDs, so renames preserve callers.
There are no workflow-local values, environment overlays, or precedence rules.
Every caller acts with the same local application's authority. No multi-user
isolation is implied.

Descriptions are at most 2,000 characters. Values are strings of at most 16 KiB
encoded as UTF-8. Config may be empty. Secret must be nonempty. Preserve intended
whitespace rather than trimming values. Metadata must not include value hashes,
prefixes, suffixes, or lengths that act as secret previews.

### AC2. Safe management reads and writes

Ordinary list and inspect operations return metadata only for both kinds. An
explicit Config-value read is available for editing ordinary configuration. It
rejects Secret variables. There is no Secret reveal or read-back operation.

Create and replace are explicit writes. Metadata-only edits never require the
caller to send an existing value back. After success, discard entered Secret
plaintext from the editor state. A refresh failure after an acknowledged write
must not prompt an automatic second write.

Updates, enable/disable, deletion, and binding changes require the revision the
caller read. Conflicts preserve local edits and report that nothing was saved.
Changing kind requires a new variable and explicit reference edits.

### AC3. Protected persistence and recovery

Apply D1 to every stored value revision. Database documents, migrations, events,
run records, portable bundles, and automatic backups contain no plaintext Secret
value. Keys never appear in API responses, CLI output, debug messages, or exports.
Return safe missing-key, permission, wrong-key, and corrupt-value failures without
including key contents, ciphertext, or submitted values.

### AC4. Explicit per-consumer delivery

Apply D3 to Fetch, Script, and polling checks. Select a variable and any non-secret
literal header prefix or suffix in the node editor. Script environment names use
letters, digits, and underscores, starting with a letter or underscore. Reject
duplicate environment names. Explicit entries override matching inherited names;
they do not broaden a managed trial's otherwise clean environment.

An injected value must be valid for its target field. Report the node, target,
variable name, and corrective action, with no value. Drafts may retain incomplete
references. Publication validates references and supported fields without returning
values. A new run checks that its own captures are provisioned, enabled, and
available before creating its ordinary execution history.

### AC5. Stable execution capture

Apply D2. Each captured entry identifies the portable reference, resolved local
variable ID, name, kind, and value revision. It contains no plaintext or encrypted
payload. Before each consumption, enforce disabled/deleted/unavailable state and
load the exact protected revision. Never substitute the latest revision or an
empty string when the captured value is unavailable.

Limit a workflow definition to 64 distinct variable references. A comparison may
capture at most 64 distinct references across its transitive selected definitions,
with at most 1 MiB of resolved UTF-8 values. Exceeding a limit rejects startup or
comparison preview with safe counts and a corrective action.

### AC6. Child runs, Batch, chains, and comparisons

Apply the capture rules in D2 across all execution modes. A child that starts after
rotation may use a newer revision than its ordinary parent. Batch items and
continue-as-new successors retain their inherited capture. Comparison reports
identify safe selected revisions and differences alongside prompt configuration.
Simulation and editor previews do not resolve or expose live values.

### AC7. Safe history and failure handling

Apply D3 before any normal history or downstream work is produced. The run
inspector shows referenced variable names and revisions and masked Secret request
fields. Run-result reads, briefings, events, assignment summaries, routed failure
data, CLI output, MCP output, and exported comparison/history data obey the same
rules. No inspection option restores Secret plaintext.

### AC8. Dependencies, rename, disable, and deletion

Show affected draft and published workflow dependencies before renaming or
deleting. Renaming changes the central name while preserving IDs and captured
historical names. Apply the disable and retention rules in D2. Blocked deletion
identifies dependencies and the next action without exposing values. Historical
records continue identifying deleted variables and revisions safely.

### AC9. Portable exports and deliberate local bindings

Export references and required-variable metadata only. Exclude values for both
kinds, all protected revisions, keys, and machine-local key paths. Requirements
include the transitive draft and retained published definitions being exported.
Bundles containing variable requirements use a new explicit format version;
existing formats remain readable without adding variables.

Import preview lists required portable IDs, kinds, and names, along with current
local availability. Never match or attach by name automatically. The caller must
explicitly bind a requirement to an existing compatible local variable or choose
to provision it locally. Missing values may be represented as unprovisioned local
requirements so the workflows can be imported for editing, but cannot run.

Local bindings remain outside immutable portable workflow definitions. Bindings
are instance-wide, map directly to a value-owning local variable, and cannot form
chains or cycles. An existing conflicting binding rejects import rather than
changing other workflows. Rebinding requires an explicit revision-protected
management action with dependency review. Active runs retain captured local IDs
and revisions. Both sides of a binding must have the same kind.

### AC10. Shared API, CLI, and bounded MCP access

UI, CLI, and MCP use the same management, reference validation, and runtime rules.
Provide paginated metadata discovery and bounded dependency inspection. Default
list size is 25, maximum 100, with exact total and truncation or continuation data.
Dependency pages default to 20 and cap at 50. Reading older dependencies is
explicit rather than placing the entire library in MCP discovery.

Prefer grouped MCP read and mutation operations over one tool per variant.
Secret writes are explicit and write-only; tool guidance explains that sending a
value through an agent discloses it to that agent and transport. A local browser
or CLI stdin is the recommended entry path. CLI Secret writes accept stdin or an
interactive hidden prompt, never a plaintext command-line argument. Do not log
raw mutation payloads. Validation errors omit invalid supplied values.

### AC11. Preserve existing workflows

Definitions without variables keep their current behavior, saved representation,
Script environment behavior, and import/export compatibility. An absent variable
capture in existing history means no variables were captured. New fields are
optional. Older incomplete drafts remain saveable, and publication stays stricter
than draft saving.

### AC12. UI proposal

Extend the existing central library and editor composition. Keep the current dark
Mantine theme, Inter typography, blue primary actions, sidebar, standard inputs,
and existing page spacing. This is an extension of the Prompts management pattern,
not a new visual identity or an open-ended dashboard design.

Add **Variables** beside **Prompts** in workspace navigation. The library has a
title, **New variable**, search, and rows showing name, Config or Secret, status,
and last change. Do not show columns of password dots or repeated explanatory
subtitles. Use **No variables yet** with the create action as the empty state.

An editor contains Name, Description, kind on creation, current availability,
value management, and dependent workflows. Config has an explicit value-edit
action. Secret shows **Value set** and **Replace value**, with no reveal icon.
Show **Set value** for unprovisioned requirements. Save and Cancel remain together
near the form. Disable and Delete are separated from the primary save action;
their confirmations state the affected runs or retained definitions.

At kind selection, explain that Config values may appear in normal run data and
that credentials belong in Secret. Existing fixed-value header controls remain
compatible; offer the Variable source where users choose credential delivery.

Fetch header rows gain **Variable** beside existing source choices. Selecting it
shows a searchable metadata picker and optional literal prefix or suffix. Script
and Script polling checks gain an **Environment** section with named references.
Pickers identify kinds and disabled/unprovisioned states, preserve missing IDs
visibly, and link to central management without copying plaintext into the node.
Previews show safe references or masks and never retrieve Secret values.

Loading, disconnected, locked-store, conflict, missing-reference, and save-failure
states remain distinct. Disable duplicate submissions while pending. Announce save
success and return focus appropriately. Preserve entered values on a rejected
write, but clear Secret text on acknowledged success, Cancel, or confirmed leave.
Warn before discarding unsaved edits. Expose dependency counts and a paged list;
keep retained-version blockers understandable.

All actions have accessible names and visible keyboard focus. Labels explain
fields without relying on placeholder text. New variable focuses Name. A
replacement action focuses its value input; Cancel restores focus to that action.
Confirmation dialogs trap focus and restore it to the invoking action. On narrow
screens, rows and form groups stack, actions wrap, and dependency details remain
readable without a horizontally scrolling page.

### AC13. Evidence and documentation

Behavior must have deterministic evidence using fake credentials and temporary
databases and protected stores. Cover the issue's central rotation, masking,
missing-reference, collision, transfer, concurrency, nested execution, retry, and
restart cases, including the D1 through D3 failure conditions. Document supported
delivery, scope, credential lifetime, backup and restore, and the limits of
redaction. The plan owns exact checks and evidence responsibilities.

## Traceability and human decision

AC1 and AC2 cover issue #193's central management, metadata, and scope criteria.
AC3 covers protected persistence. AC4 covers explicit delivery. AC5 and AC6 cover
its runtime decisions. AC7 covers masking and failure paths. AC8 covers retention
and dependencies. AC9 covers portable requirements. AC10 covers shared access and
bounded MCP context. AC11 preserves existing workflows. AC12 covers the user's
UI-design request. AC13 covers the issue's evidence and documentation criteria.

The issue authorizes the outcome and leaves storage and runtime design open. The
user accepted D1, D2, D3, and this proposed contract as a whole in the conversation
on November 3, 2026. The SDLC run records the actual response at `specGate` before
planning. No merge or release is authorized by that approval.

## Accepted UI amendment after trial

After trying the feature and rejecting the first broad UI prototype, the user
approved selecting the saved variable first and checking the resulting interface
in the trial before merging.

This refines AC12's Script and Script polling controls. The section is labeled
Environment variables. Choose a saved variable first and use its valid name
unchanged, preserving case. Show the exact JavaScript or Bash access expression.
Change environment name is optional. Invalid saved names receive a visible,
editable safe suggestion; duplicate and invalid target names block Apply with
field-specific recovery. Existing keys remain stable when a library name changes
or a source is replaced. Keep the real node settings modal and its existing
Apply/Save/publish boundaries. No full-page picker or automatic global delivery.

Keep existing portable import binding, with Import disabled until required choices
are complete. D1–D3, AC4 delivery and draft/publication rules, and AC9 portability
still apply.

Subsequent actual-UI feedback requests aligning variable detail with workflow
navigation. The variable editor adopts the existing full-width detail header with
consistent back-button placement, compact name/kind, saved state and top-bar
Save/Discard actions. The existing form remains bounded below it and scrolls
independently. New-variable cancellation and existing-variable discard preserve
prior behavior; native form submission, secret clearing, Config reads and unsaved
navigation protection remain intact. This narrows the original management-page
composition concerns without adopting the rejected broader redesign.

Further actual-UI feedback requires the Variables library's search placement and
primary control sizing to follow Workflows, while retaining its list. The two
libraries share header/toolbar/search layout rules and use standard Mantine action
sizing. Count is left, search is right; pagination appears only when useful. The
review must compare list and detail pairs together, including intentional
semantic differences. Existing core name validation is surfaced before mutation
with native validity/inline recovery. No API or runtime behavior changes.

The variable editor groups metadata, value, workflow references, and recovery in
one card. Disable and delete actions sit under **Danger zone**. Both value fields
accept multiline text. A Secret draft is visible while entering or replacing
it. Saving clears the draft, and reopening the editor provides no Secret read-back.
The Variables library shows a skeleton while loading, with separate actions for an
empty library and a search with no results. Prompts adopts the same list and form
styles, with prompt creation in its existing dialog.
