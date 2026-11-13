import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Locator, Page } from 'playwright';

/**
 * Baselines are rendered on Linux, matching the CI runner. Font rasterization
 * differs on macOS, so other platforms skip comparisons and still run every
 * other assertion, including accessibility checks.
 */
const screenshotPlatform = 'linux';
export const comparesScreenshots = process.platform === screenshotPlatform;
export const screenshotSkipReason = `Screenshot comparisons run only on ${screenshotPlatform} (baselines are pinned to the CI runner); skipped on ${process.platform}.`;

const update = process.env.INTERLOCK_UPDATE_SNAPSHOTS === '1';
if (update && process.env.CI)
  throw new Error(
    'INTERLOCK_UPDATE_SNAPSHOTS cannot run in CI, where it would rewrite baselines silently. Take new baselines from the screenshot-diffs artifact instead (see tests/browser/README.md).',
  );
const baselines = 'tests/browser/__screenshots__';
/** CI uploads this directory when the browser tests fail. */
const screenshotResults = 'test-results/screenshots';

/** A fixed clock keeps relative times and durations stable in screenshots. */
export const screenshotTime = new Date('2026-01-15T12:00:00.000Z');

let warned = false;

/**
 * Compares a viewport or element screenshot with its committed baseline. Set
 * INTERLOCK_UPDATE_SNAPSHOTS=1 on Linux to write new baselines intentionally.
 */
export async function expectScreenshot(
  target: Page | Locator,
  name: string,
  { mask = [] }: { mask?: Locator[] } = {},
) {
  if (!comparesScreenshots) {
    if (!warned) console.warn(screenshotSkipReason);
    warned = true;
    return;
  }
  const page = 'mainFrame' in target ? target : target.page();
  // Let fonts, lazy chunks, and layout settle before capturing.
  await page.evaluate(() => document.fonts.ready);
  const capture = () =>
    target.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      mask,
    });
  // Wait until two consecutive captures agree, as Playwright's own
  // toHaveScreenshot does, so late layout or lazy content cannot flake.
  let actual = await capture();
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.waitForTimeout(150);
    const next = await capture();
    if (next.equals(actual)) break;
    actual = next;
  }
  const file = join(baselines, `${name}.png`);
  const expected = await readFile(file).catch(() => undefined);
  if (update) {
    if (!expected || !matches(expected, actual).equal) {
      await mkdir(baselines, { recursive: true });
      await writeFile(file, actual);
    }
    return;
  }
  const save = async (suffix: string, data: Buffer) => {
    await mkdir(screenshotResults, { recursive: true });
    await writeFile(join(screenshotResults, `${name}-${suffix}.png`), data);
  };
  if (!expected) {
    await save('actual', actual);
    throw new Error(
      `Missing screenshot baseline ${file}. Review ${screenshotResults}/${name}-actual.png, then run INTERLOCK_UPDATE_SNAPSHOTS=1 pnpm test:browser on Linux.`,
    );
  }
  const result = matches(expected, actual);
  if (result.equal) return;
  await save('actual', actual);
  await save('expected', expected);
  if (result.diff) await save('diff', result.diff);
  throw new Error(
    `Screenshot ${name} differs from ${file}: ${result.reason}. See ${screenshotResults}/${name}-{actual,expected,diff}.png.`,
  );
}

function matches(expectedData: Buffer, actualData: Buffer) {
  const expected = PNG.sync.read(expectedData);
  const actual = PNG.sync.read(actualData);
  const { width, height } = expected;
  if (width !== actual.width || height !== actual.height)
    return {
      equal: false,
      reason: `size changed from ${width}x${height} to ${actual.width}x${actual.height}`,
    } as const;
  const diff = new PNG({ width, height });
  const changed = pixelmatch(
    expected.data,
    actual.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 },
  );
  return changed === 0
    ? ({ equal: true } as const)
    : ({
        equal: false,
        reason: `${changed} pixels changed`,
        diff: PNG.sync.write(diff),
      } as const);
}
