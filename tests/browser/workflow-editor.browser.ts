import { blankDefinition } from '@interlock/core';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserApp } from './app';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

it.each([1440, 900, 390])(
  'guards a clean workflow publication at %dpx',
  async (width) => {
    const app = await openBrowserApp();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    let releasePublish!: () => void;
    const hold = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    try {
      const workflow = app.engine.create(
        'Draft for review',
        '',
        blankDefinition(),
      );
      const path = `/workflows/${workflow.id}`;
      await page.route(
        (url) => url.pathname === '/trpc/workflows.publish',
        async (route) => {
          await hold;
          await route.continue();
        },
      );
      await page.goto(`${app.url}/workflows`);
      await page.locator(`a[href="${path}"]`).click();
      await page.getByRole('button', { name: 'Review & publish' }).click();
      await page.getByRole('button', { name: 'Publish version' }).click();
      await page.getByRole('button', { name: 'Publishing…' }).waitFor();

      const beforeUnload = page.waitForEvent('dialog');
      await page.evaluate(() => window.setTimeout(() => location.reload(), 0));
      const unload = await beforeUnload;
      expect(unload.type()).toBe('beforeunload');
      await unload.dismiss();

      await page.goBack();
      await page.getByRole('dialog', { name: 'Review publication' }).waitFor();
      expect(
        await page
          .getByRole('dialog', { name: 'Discard unsaved changes?' })
          .isVisible(),
      ).toBe(false);
      releasePublish();
      await page.getByText('Published “Draft for review” as v1.').waitFor();
      expect(new URL(page.url()).pathname).toBe(path);
    } finally {
      releasePublish();
      await page.close();
      await app.close();
    }
  },
);
