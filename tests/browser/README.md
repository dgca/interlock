# Browser tests

`pnpm test:browser` runs these Playwright tests with Vitest against the production UI in `packages/ui/dist`. Run `pnpm build` first. Each test starts an in-process engine with a temporary in-memory database. A global setup also builds the development-only component gallery (`/-/gallery`) into a temporary directory. That build is separate from the packaged UI, which never contains the gallery.

## Screenshot comparisons

`screenshots.browser.ts` compares the gallery sections, the hover, focus, and dialog states, and the main screens (workflow list, workflow editor, run inspector, board library, board, variables) at 1440px and 390px. Baselines live in `__screenshots__/`.

Baselines are pinned to Linux, the CI `ubuntu-latest` runner. Font rasterization differs between macOS and Linux, so on other platforms the comparisons are skipped with a message, and the other assertions in these tests still run. Seeded data, a fixed clock in the browser and the engine, the UTC time zone, and masks over the version, engine address, and short IDs keep the captures stable.

When a comparison fails, the test writes `<name>-actual.png`, `<name>-expected.png`, and `<name>-diff.png` to `test-results/screenshots/`. CI uploads that directory as the `screenshot-diffs` artifact.

### Update snapshots intentionally

Update baselines only for a visual change you intend, and review every changed image in the PR.

1. Make the change and open or update the PR. CI fails on the screenshots that changed.
2. Download the `screenshot-diffs` artifact from the failed CI run. Check each `-diff.png` and `-actual.png` to confirm only the intended change appears.
3. Replace each matching file in `tests/browser/__screenshots__/` with its `-actual.png`, dropping the `-actual` suffix. A new screenshot has no baseline yet, so its `-actual.png` becomes the new baseline the same way.

On a Linux machine with the same Playwright Chromium, `INTERLOCK_UPDATE_SNAPSHOTS=1 pnpm test:browser` rewrites the baselines that differ instead. It refuses to run when `CI` is set. Compare the result with CI before committing, because local Linux font packages can still differ from the runner.

## Accessibility checks

The same tests run [axe](https://github.com/dequelabs/axe-core) on each gallery section, each gallery dialog, and each main screen at both widths, on every platform. `accessibility-baseline.json` records the existing serious and critical violations as the number of affected elements per rule for each `<screen>@<width>` key. Counts are used instead of selectors because selectors contain hashed CSS module class names. A test fails when a rule's count rises above the baseline, including a new element for a rule that is already baselined. The failure message names the rule, its help link, and the affected elements.

The baseline only shrinks. When a fix lowers a count, the test fails until you lower or remove that entry. Do not add or raise entries for new work. After all checks run, the suite also fails if any baseline key was never checked, which catches mistyped or orphaned keys. Running a subset of tests with `-t` reports the keys it skipped.
