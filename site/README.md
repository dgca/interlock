# Interlock marketing page

`index.html` is the static homepage. GitHub Pages deploys `site/` when that folder changes on `main`. `v2.html` preserves the earlier Pokémon demo page.

The homepage reuses the approved logo and IBM Plex font assets from the application design system. Font licensing is in `fonts/OFL.txt`.

The homepage follows [the marketing design guide](../designs/marketing-homepage.md) and the Interlock Grid visual system. Its figures use HTML, CSS, and SVG. It does not connect to a running engine or create workflow data.

## Preview locally

From the repository root, run:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory site
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

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
