import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserApp } from './app';

let browser: Browser;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

it.each([1440, 900, 390])(
  'recovers a prompt draft and a conflicting edit at %dpx',
  async (width) => {
    const app = await openBrowserApp();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    const releaseCreate = deferred();
    try {
      const requests: unknown[] = [];
      const created = deferred();
      await page.route(
        (url) => url.pathname === '/trpc/prompts.create',
        async (route) => {
          requests.push(route.request().postDataJSON());
          if (requests.length === 1) {
            const response = await route.fetch();
            await response.dispose();
            created.resolve();
            await releaseCreate.promise;
            await route.abort('failed');
          } else {
            await route.continue();
          }
        },
      );
      let failRead = true;
      await page.route(
        (url) =>
          url.pathname.startsWith('/trpc/') &&
          url.pathname
            .slice('/trpc/'.length)
            .split(',')
            .includes('prompts.get'),
        (route) => (failRead ? route.abort('failed') : route.continue()),
      );

      await page.goto(`${app.url}/prompts`);
      await page.getByRole('link', { name: 'New prompt' }).click();
      await page.getByRole('heading', { name: 'New prompt' }).waitFor();
      const name = page.getByRole('textbox', { name: /^Name/ });
      const instructions = page.getByRole('textbox', { name: /^Instructions/ });
      await name.fill('Release review');
      const draft =
        '# Check the release\n\n' +
        'Review the change in context.\n'.repeat(22);
      await instructions.fill(draft);

      const discard = page.getByRole('dialog', {
        name: 'Discard unsaved changes?',
      });
      await page.goBack();
      await discard.waitFor();
      expect(
        await discard
          .getByRole('button', { name: 'Keep editing' })
          .evaluate((button) => button === document.activeElement),
      ).toBe(true);
      await page.keyboard.press('Escape');
      await discard.waitFor({ state: 'hidden' });
      await expect
        .poll(() =>
          instructions.evaluate((field) => field === document.activeElement),
        )
        .toBe(true);
      expect(await instructions.inputValue()).toBe(draft);

      const beforeUnload = page.waitForEvent('dialog');
      await page.evaluate(() => window.setTimeout(() => location.reload(), 0));
      const unload = await beforeUnload;
      expect(unload.type()).toBe('beforeunload');
      await unload.dismiss();

      const create = page.getByRole('button', { name: 'Create prompt' });
      await create.click();
      await created.promise;
      expect(app.engine.prompts.list()).toHaveLength(1);
      expect(await create.isDisabled()).toBe(true);
      expect(
        await page
          .getByRole('button', { name: 'Back to prompts' })
          .isDisabled(),
      ).toBe(true);
      await page.goBack();
      releaseCreate.resolve();
      const retryCreate = page.getByRole('button', { name: 'Retry creation' });
      await retryCreate.waitFor();
      expect(await discard.isVisible()).toBe(false);
      expect(await instructions.inputValue()).toBe(draft);
      await retryCreate.click();
      await page.getByRole('heading', { name: 'Release review' }).waitFor();
      expect(requests).toEqual([requests[0], requests[0]]);
      const [saved] = app.engine.prompts.list();
      expect(app.engine.prompts.list()).toHaveLength(1);

      const retryRead = page.getByRole('button', {
        name: 'Retry prompt details',
      });
      await retryRead.waitFor();
      expect(await instructions.inputValue()).toBe(draft);
      expect(
        await page.getByText('No workflows use this prompt yet.').isVisible(),
      ).toBe(false);
      failRead = false;
      await retryRead.click();
      await page.getByText('No workflows use this prompt yet.').waitFor();
      expect(requests).toHaveLength(2);

      await instructions.fill('My edit');
      app.engine.prompts.update(saved.id, saved.revision, {
        name: saved.name,
        description: saved.description,
        content: 'Edit from another client',
      });
      await page.getByRole('button', { name: 'Save changes' }).click();
      const load = page.getByRole('button', { name: 'Load latest' });
      await load.waitFor();
      expect(await instructions.inputValue()).toBe('My edit');
      await load.click();
      await discard.getByRole('button', { name: 'Keep editing' }).click();
      expect(await instructions.inputValue()).toBe('My edit');
      await load.click();
      await discard.getByRole('button', { name: 'Discard changes' }).click();
      await expect
        .poll(() => instructions.inputValue())
        .toBe('Edit from another client');
      expect(
        await page.getByRole('button', { name: 'Save changes' }).isDisabled(),
      ).toBe(true);

      let updates = 0;
      await page.route(
        (url) => url.pathname === '/trpc/prompts.update',
        async (route) => {
          updates++;
          const response = await route.fetch();
          await response.dispose();
          await route.abort('failed');
        },
      );
      await name.fill('  Approved release review  ');
      await instructions.fill('Confirmed by reading the saved prompt');
      await page.getByRole('button', { name: 'Save changes' }).click();
      const checkSaved = page.getByRole('button', {
        name: 'Check saved prompt',
      });
      await checkSaved.waitFor();
      expect(app.engine.prompts.get(saved.id).revision).toBe(3);
      await checkSaved.click();
      await page.getByText('Saved · Revision 3').waitFor();
      expect(await name.inputValue()).toBe('Approved release review');
      expect(updates).toBe(1);

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    } finally {
      releaseCreate.resolve();
      await page.close();
      await app.close();
    }
  },
);
