# Interlock marketing page

`index.html` is the static site. GitHub Pages deploys `site/` when that folder changes on `main`. `v2.html` preserves the earlier demo page.

## Preview locally

From the repository root, run:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory site
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

## Check the demo

Run Togepi, claim the assignment, and submit the initial draft to see a contract error. Select **Fill in a complete reply**, then submit again to finish the run. Run Snorlax to take the stat sheet branch.

The demo runs in the browser. Fetch uses PokéAPI and falls back to saved responses for the sample names if the request fails. The Agent step uses templated replies. The Pokémon workflow comes from an earlier release. For the current starter catalog, see [starter workflows](../docs/starter-workflows.md).

## Update screenshots and social previews

Capture the app against a temporary database. Record the checkout, version, viewport, and any example data in the screenshot's JSON sidecar. Older captures in `shots/` have their own sidecars.

Both HTML pages use the 1200 × 630 `social-preview.png`. To update it, export `social-preview.svg` at its native size and a device scale factor of 1. Keep the metadata in both pages in sync with the image.
