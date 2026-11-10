# Interlock marketing page

`index.html` is the static homepage. `v2.html` preserves the earlier Pokémon demo page. The Docusaurus project in `website/` publishes the repository's Markdown documentation under `/interlock/docs/`.

GitHub Pages builds and deploys the marketing page and documentation together when their sources change on `main`. The generated `.site-build/` directory is the deployment artifact. Do not commit generated files.

The homepage reuses the approved logo and IBM Plex font assets from the application design system. Font licensing is in `fonts/OFL.txt`.

The homepage follows [the marketing design guide](../designs/marketing-homepage.md) and the Interlock Grid visual system. Its figures use HTML, CSS, and SVG. It does not connect to a running engine or create workflow data.

## Preview locally

To preview the complete website at its production paths, run these commands from the repository root:

```sh
pnpm install
pnpm site:build
pnpm site:preview
```

Open the [marketing page](http://127.0.0.1:8765/interlock/) or [documentation](http://127.0.0.1:8765/interlock/docs/). Rebuild after editing to refresh this preview. For live documentation editing, run `pnpm docs:dev` and open the URL printed by Docusaurus.

`pnpm site:build` checks documentation links and anchors, builds the local search index, and checks local links and assets across the combined output. `pnpm site:check` repeats the combined-output checks without rebuilding.

For a marketing-only preview, run `python3 -m http.server 8765 --bind 127.0.0.1 --directory site`. The Docs link requires the complete build.

## Edit the documentation

Edit the public guides in `docs/`. The sidebar in `website/sidebars.mjs` defines the complete set of published pages. Only those pages enter the build and search index. New Markdown files are not published automatically.

Keep public guides short and focused on product use. Connection guides include practical setup, and the final CLI reference includes command syntax. Add a page only when it answers a user question the existing guides cannot cover. Architecture, full protocol details, contributor instructions, experiments, and research remain repository documentation.

Use relative Markdown links between published guides. Keep public guides self-contained rather than sending readers into technical references. Use explicit GitHub URLs if a source link is needed. Each published page has an edit link to its Markdown source. Search runs in the visitor's browser and needs no external service or credentials. The search index is generated during production builds, so test search in the complete preview.

The docs reuse the marketing site's font files and a copy of `site/interlock-logo.svg`. When changing the logo, also update `website/static/img/interlock-logo.svg`; the website check verifies that the copies match. Keep the font license in `site/fonts/OFL.txt`.

Framework decisions and source references are in [the docs-site research note](../docs/research/docs-site-framework-2026-11-10.md). Visual decisions are in [the documentation design guide](../designs/documentation.md).

## Check the homepage

Check desktop, mobile, and intermediate widths. The hero workflow and building-block strip reflow into two columns on narrow screens. Check that node connections stay aligned after resizing.

The hero illustrates a Build → Review loop that returns to Build before continuing through Open PR to Exit. Use the pause button to stop or resume the animation. Reduced-motion settings start it paused. The animation also pauses while the figure is off screen or the page is hidden.

Use the keyboard to reach the skip link, navigation, animation control, Copy button, and footer links. Check the Install jump link and command copying over localhost or HTTPS. When clipboard access fails, the page selects the commands and explains how to copy manually. Without JavaScript, the installation commands and links remain available.

Automation and report values are illustrative. Preserve their disclosures and the local-engine and measurement qualifications when editing.

## Update screenshots and social previews

Regenerate the static hero backgrounds from the repository root:

```sh
node scripts/generate-marketing-hero.mjs
```

The generator renders the color field in floating point and adds non-repeating grain and dithering before exporting standard and Retina PNGs. Keep both generated assets in `site/assets/`. The browser displays one image without SVG blur filters, repeated noise tiles, blend modes, or opacity masks.

Capture the app against a temporary database. Record the checkout, version, viewport, and any example data in the screenshot's JSON sidecar. Older captures in `shots/` have their own sidecars.

Both HTML pages use the 1200 × 630 `social-preview.png`. To update it, export `social-preview.svg` at its native size and a device scale factor of 1. Keep the metadata in both pages in sync with the image.
