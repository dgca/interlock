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
  'guards the Agent preset dialog and restores focus at %dpx',
  async (width) => {
    const app = await openBrowserApp();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    let releaseWrite!: () => void;
    const holdWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    try {
      const alias = app.engine.modelAliases.mutate({
        action: 'create',
        name: 'Reviewer',
        candidates: [{ model: 'fixture-model', profileId: 'codex' }],
      });
      let writes = 0;
      await page.route(
        (url) => url.pathname === '/trpc/modelAliases.mutate',
        async (route) => {
          if (++writes === 1) await holdWrite;
          await route.continue();
        },
      );
      await page.goto(`${app.url}/settings/ai?tab=harnesses`);
      await page.getByRole('link', { name: 'Agent presets' }).click();
      const trigger = page.getByRole('button', {
        name: 'Edit preset Reviewer',
      });
      const modal = page.getByRole('dialog', { name: 'Edit preset' });
      const confirm = page.getByRole('dialog', {
        name: 'Discard unsaved changes?',
      });
      await trigger.click();
      const name = modal.getByRole('textbox', { name: /^Name/ });
      await name.fill('Local edit');
      await page.keyboard.press('Escape');
      await confirm.getByRole('button', { name: 'Keep editing' }).click();
      expect(await name.inputValue()).toBe('Local edit');
      await expect
        .poll(() => name.evaluate((node) => node === document.activeElement))
        .toBe(true);

      app.engine.modelAliases.mutate({
        action: 'update',
        id: alias.id,
        expectedRevision: 1,
        description: 'Edited in another client',
      });
      await modal.getByRole('button', { name: 'Save changes' }).click();
      await expect.poll(() => writes).toBe(1);
      await page.goBack();
      await expect
        .poll(() => new URL(page.url()).search)
        .toBe('?tab=model-aliases');
      expect(await confirm.isVisible()).toBe(false);
      releaseWrite();
      await modal.getByRole('button', { name: 'Load latest' }).click();
      expect(await name.inputValue()).toBe('Local edit');
      await confirm.getByRole('button', { name: 'Discard changes' }).click();
      await expect.poll(() => name.inputValue()).toBe('Reviewer');
      expect(
        await modal.getByRole('textbox', { name: 'Description' }).inputValue(),
      ).toBe('Edited in another client');
      await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'hidden' });
      await expect
        .poll(() => trigger.evaluate((node) => node === document.activeElement))
        .toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally {
      releaseWrite();
      await page.close();
      await app.close();
    }
  },
);
