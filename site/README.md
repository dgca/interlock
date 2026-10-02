# Interlock product page

A static, single-file page that pitches Interlock chapter by chapter and lets visitors try it in the browser. `.github/workflows/pages.yml` deploys this folder to GitHub Pages when `site/` changes on `main`.

`index.html` is the published page. `v2.html` keeps the earlier replica-only version for comparison; it is not linked from the page.

## Preview locally

```sh
python3 -m http.server 8765 --directory site
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

## What is interactive

The page carries three replicas of Interlock's UI, styled from `packages/ui` tokens and Lucide icons and scoped under `.rx` so they keep the app's look inside the page's own styling:

- **Run inspector.** Runs "Size up a Pokémon" in the browser. The Fetch step calls the public PokéAPI, with a cached copy of the suggested names if the request fails. The Script step runs the starter workflow's JavaScript verbatim. Small Pokémon pause for an agent; the visitor claims the assignment and submits a result, which is checked against the node's output contract with Interlock's error wording from `packages/core`.
- **Batch.** Fans the same workflow out over a candidate list with a concurrency setting and the `all` or `collect` failure policy, then returns results in input order.
- **Publish review.** Edits the Agent prompt, shows a word diff against the published version, and publishes a new version while an existing run stays pinned.

No Interlock engine runs on the page. Templated agent answers come from the stat sheet, not a model, and step timing is slowed for legibility. The footer says so.

## Screenshots

The gallery images in `shots/` were captured from `@type_of/interlock` v0.1.14 on a fresh temporary database at 1440 px wide and 2x density, then cropped and converted to WebP. Each has a `.json` sidecar recording its origin. Agent assignments in those runs were claimed and submitted through the `interlock` CLI by Claude Code acting as the executor. Recapture against a temporary database so the screenshots never show personal workflows:

```sh
interlock --port 4399 --db /tmp/interlock-demo.db --workdir /tmp
```

## Keep it accurate

Claims on the page come from the README, `docs/v1.md`, `docs/architecture.md`, and `docs/connect-harness.md`. When a release changes a limit, a contract message, the starter workflows, or a connection step, update the page alongside the docs. Features that are still in pending changesets are left off until they ship.
