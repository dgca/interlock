# Agent model tiers

Agent `context.tier` is an optional capability preference. The executor maps the fixed vocabulary to its own models and reasoning settings.

| Tier       | Preference                                    |
| ---------- | --------------------------------------------- |
| `max`      | The executor's strongest available capability |
| `balanced` | A balance of capability and speed             |
| `fast`     | Speed                                         |
| Omitted    | No preference; executor uses its default      |

Tiers do not guarantee a price, latency, reasoning effort, or result quality. Interlock does not choose, launch, or verify models. It accepts claims without model declarations or with a declared tier different from the request.

## Context and discovery

Both `current` and `fresh` context support tiers. Required continuity and isolation take precedence. A tier cannot replace a bound session or make an existing conversation fresh. If a current session cannot change models, the executor preserves that session. Fresh executors can use the preference when creating an isolated session.

The Agent settings **Model tier** control offers **No preference**, **Max**, **Balanced**, and **Fast**. Choosing **No preference** removes the field. Workflow authoring, raw editing, publication, and portable transfer retain declared tiers. Unknown tier values reject during definition parsing. Existing definitions retain their behavior when the field is absent.

Full assignments, `list_work` summaries, run briefings, compact start/submit responses, and claim results expose `context.tier` when set. Dispatchers can read the preference before reserving work. Assignment-size previews include the context field.

## Claim declarations and attempt history

Optional claim `modelSelection` records the executor's selection at claim time. Its fields are independently optional, but at least one must be known.

| Field      | Values                                           |
| ---------- | ------------------------------------------------ |
| `tier`     | `max`, `balanced`, or `fast`                     |
| `provider` | Trimmed, nonempty string, at most 200 characters |
| `model`    | Trimmed, nonempty string, at most 200 characters |

Unknown fields reject. A declaration remains fixed for that claim attempt. A later claim can declare a different selection; omission on a retry does not reuse the previous declaration. Claims and declarations survive restart. Declarations do not renew leases or report usage.

MCP `claim_work`, shared API `work.claim`, and CLI claim options accept the same object:

```sh
interlock claim WORK_ID executor '{"modelSelection":{"tier":"balanced","provider":"example","model":"example-model"}}'
```

`get_run_usage` with `groupBy:"attempt"` exposes the requested tier and declared selection alongside the existing usage snapshot. The CLI equivalent is:

```sh
interlock usage RUN_ID '{"groupBy":"attempt","limit":20,"offset":0}'
```

`requestedTier:null` means the attempt captured an unset tier, or executor default. Missing `requestedTier` means unknown historical attribution. `modelSelection:null` means no selection was declared. Missing values inside a declaration remain unknown. No tier is inferred from a vendor model name.

Usage `snapshot.models` contains separately reported model identities and measured figures. It can contain several models and differ from the claim declaration. A declared model with no usage report still has unknown measured usage. The run inspector offers **Claim attempt** grouping under **Usage and model attribution** for these values.

Declarations and usage survive workflow-version cleanup but are excluded from portable workflow bundles. Deleting run history removes them. Reviewer independence, executor model mappings, automatic model switching, and comparisons between mappings are outside this feature.
