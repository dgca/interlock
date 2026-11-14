import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { afterAll, beforeAll, describe, inject, it, vi } from 'vitest';
import { paths } from '../../packages/ui/src/routes/paths';
import { expectAccessible, expectBaselineVisited } from './accessibility';
import { openBrowserApp } from './app';
import {
  comparesScreenshots,
  expectScreenshot,
  screenshotSkipReason,
  screenshotTime,
} from './screenshots';
import { seedScreens } from './seed';

type App = Awaited<ReturnType<typeof openBrowserApp>>;
type Seed = ReturnType<typeof seedScreens>;

const widths = [1440, 390] as const;
const gallerySections = [
  'buttons',
  'inputs',
  'feedback',
  'loading',
  'collections',
  'layout',
  'editors',
  'dialogs',
  'testing',
  'boards',
  'agent-tools',
  'memory',
];

/** Main screens, each with a locator that proves the screen finished loading. */
const screens: {
  name: string;
  path: (seed: Seed) => string;
  ready: (page: Page) => ReturnType<Page['getByRole']>;
}[] = [
  {
    name: 'workflow-list',
    path: () => paths.workflows,
    ready: (page) => page.getByRole('link', { name: 'Release review' }),
  },
  {
    name: 'workflow-editor',
    path: (seed) => paths.workflow(seed.release.id),
    ready: (page) => page.getByText('Draft release notes', { exact: true }),
  },
  {
    name: 'run-inspector',
    path: (seed) => paths.run(seed.run.runId),
    ready: (page) => page.getByRole('heading', { name: 'Release 0.3.0' }),
  },
  {
    name: 'board-library',
    path: () => paths.boards,
    ready: (page) => page.getByRole('link', { name: 'Release delivery' }),
  },
  {
    name: 'board',
    path: (seed) => paths.board(seed.board.id),
    ready: (page) =>
      page.getByRole('link', { name: 'Release 0.3.1', exact: true }),
  },
  {
    name: 'variables',
    path: () => paths.variables,
    ready: (page) => page.getByRole('link', { name: 'RELEASE_CHANNEL' }),
  },
];

/** Values that change between builds or test runs, independent of the UI. */
const volatile = (page: Page) => [
  page.getByText(/^v\d+\.\d+\.\d+/),
  page.getByText(/127\.0\.0\.1:\d+/),
  page.getByText(/^[0-9a-f]{8}$/),
];

let browser: Browser;

beforeAll(async () => {
  if (!comparesScreenshots) console.warn(screenshotSkipReason);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  expectBaselineVisited();
});

async function open(width: number, ui?: string) {
  const app = await openBrowserApp({ ui });
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
  });
  await context.clock.setFixedTime(screenshotTime);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  return { app, context, page };
}

describe.each(widths)('gallery at %dpx', (width) => {
  let app: App;
  let context: BrowserContext;
  let page: Page;

  beforeAll(async () => {
    ({ app, context, page } = await open(width, inject('galleryUi')));
    await page.goto(app.url + '/-/gallery');
    await page.getByRole('textbox', { name: 'Script', exact: true }).waitFor();
  });

  afterAll(async () => {
    await context?.close();
    await app?.close();
  });

  it.for(gallerySections)('checks the %s section', async (section) => {
    const selector = `[data-gallery-section="${section}"]`;
    await expectAccessible(page, `gallery-${section}@${width}`, {
      include: selector,
    });
    await expectScreenshot(
      page.locator(selector),
      `gallery-${section}-${width}`,
    );
  });

  it('matches a hovered button', async (ctx) => {
    ctx.skip(!comparesScreenshots, screenshotSkipReason);
    await page.locator('[data-gallery-hover="button"]').hover();
    await expectScreenshot(
      page.locator('[data-gallery-section="buttons"]'),
      `gallery-hover-${width}`,
    );
    await page.mouse.move(0, 0);
  });

  it.for(['button', 'input'])('matches a focused %s', async (kind, ctx) => {
    ctx.skip(!comparesScreenshots, screenshotSkipReason);
    const target = page.locator(`[data-gallery-focus="${kind}"]`);
    await target.focus();
    await expectScreenshot(
      page.locator('[data-gallery-section]').filter({ has: target }),
      `gallery-focus-${kind}-${width}`,
    );
    await target.blur();
  });

  it.for(['modal', 'busy', 'discard', 'memory-note'])(
    'checks the %s dialog',
    async (dialog) => {
      await page.goto(`${app.url}/-/gallery?open=${dialog}`);
      await page.getByRole('dialog').waitFor();
      await expectAccessible(page, `gallery-dialog-${dialog}@${width}`, {
        include: '[role="dialog"]',
      });
      await expectScreenshot(page, `gallery-dialog-${dialog}-${width}`);
    },
  );
});

describe.each(widths)('main screens at %dpx', (width) => {
  let app: App;
  let context: BrowserContext;
  let page: Page;
  let seed: Seed;

  beforeAll(async () => {
    // Freeze server timestamps so dates and durations match the baselines.
    // Records are created a minute apart, ending before the fixed browser time.
    vi.useFakeTimers({
      toFake: ['Date'],
      now: screenshotTime.getTime() - 60 * 60_000,
    });
    ({ app, context, page } = await open(width));
    seed = seedScreens(app.engine, () => vi.setSystemTime(Date.now() + 60_000));
  });

  afterAll(async () => {
    await context?.close();
    await app?.close();
    vi.useRealTimers();
  });

  it.for(screens)('checks the $name screen', async (screen) => {
    await page.goto(app.url + screen.path(seed));
    await screen.ready(page).first().waitFor();
    await expectAccessible(page, `${screen.name}@${width}`);
    await expectScreenshot(page, `${screen.name}-${width}`, {
      mask: volatile(page),
    });
  });
});
