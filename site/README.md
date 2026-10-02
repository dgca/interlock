# Interlock product page

A static, single-file page that introduces Interlock with real screenshots. `.github/workflows/pages.yml` deploys this folder to GitHub Pages when `site/` changes on `main`.

## Preview locally

```sh
python3 -m http.server 8765 --directory site
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

## Screenshots

Every image in `shots/` was captured from `@type_of/interlock` v0.1.14 on a fresh temporary database at 1440 px wide and 2x density, then cropped and converted to WebP. The runs shown are real:

- **Size up a Pokémon** with `{"name":"togepi"}`, captured waiting, claimed, and completed. Chapter 3 follows this run.
- **Build a team roster** with seven candidates, captured mid-run and completed.
- **Review & publish** after a one-word prompt edit that was never published.

Agent assignments were claimed and submitted through the `interlock` CLI by Claude Code acting as the executor. Recapture against a temporary database so the screenshots never show personal workflows:

```sh
interlock --port 4399 --db /tmp/interlock-demo.db --workdir /tmp
```

## Keep it accurate

Claims on the page come from the README, `docs/v1.md`, `docs/architecture.md`, and `docs/connect-harness.md`. When a release changes a limit, node kind, or connection step, update the page alongside the docs. Features that are still in pending changesets are left off until they ship.
