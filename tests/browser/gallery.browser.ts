import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { openBrowserApp } from './app';

const galleryPath = '/-/gallery';
const sections = [
  'Buttons',
  'Inputs',
  'Feedback',
  'Loading',
  'Collections',
  'Page layout',
  'Editors',
  'Dialogs',
  'Test suites',
  'Boards',
  'Memory',
];

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

it.each([1440, 390])(
  'renders every gallery section without errors at %dpx',
  async (width) => {
    const app = await openBrowserApp({ ui: inject('galleryUi') });
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    try {
      await page.goto(app.url + galleryPath);
      await expect
        .poll(() =>
          page.locator('[data-gallery-section] > h2').allTextContents(),
        )
        .toEqual(sections);
      await page
        .getByRole('textbox', { name: 'Script', exact: true })
        .waitFor();
      await page.getByRole('button', { name: 'Open modal' }).click();
      const dialog = page.getByRole('dialog', { name: 'Rename workflow' });
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached' });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
      await app.close();
    }
  },
);

it('excludes the gallery from the production build', async () => {
  const ui = 'packages/ui/dist';
  const files = await readdir(ui, { recursive: true });
  expect(files.filter((file) => /gallery/i.test(file))).toEqual([]);
  for (const file of files.filter((name) => /\.(js|css|html)$/.test(name)))
    expect(await readFile(join(ui, file), 'utf8')).not.toContain('-/gallery');
  const app = await openBrowserApp();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    await page.goto(app.url + galleryPath);
    await page.getByRole('heading', { name: 'Page not found' }).waitFor();
    expect(
      await page.getByRole('heading', { name: 'Component gallery' }).count(),
    ).toBe(0);
  } finally {
    await page.close();
    await app.close();
  }
});
