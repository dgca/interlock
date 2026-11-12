import { createClient } from '@interlock/client';
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

      await modal.getByRole('button', { name: 'Delete preset' }).click();
      const deletion = page.getByRole('dialog', { name: 'Delete Reviewer?' });
      const cancelDeletion = deletion.getByRole('button', { name: 'Cancel' });
      await cancelDeletion.focus();
      await page.goBack();
      const keep = confirm.getByRole('button', { name: 'Keep editing' });
      await expect
        .poll(() => keep.evaluate((node) => node === document.activeElement))
        .toBe(true);
      await keep.click();
      await expect
        .poll(() =>
          cancelDeletion.evaluate((node) => node === document.activeElement),
        )
        .toBe(true);
      await cancelDeletion.click();
      expect(await name.inputValue()).toBe('Local edit');
      expect(writes).toBe(0);

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

it('keeps unexposed configuration when renaming an API-created integration', async () => {
  const app = await openBrowserApp();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(5000);
  try {
    const client = createClient(app.url);
    const preserved = {
      provider: 'fixture-provider',
      tools: ['fixture-tool'],
      skills: ['fixture-skill'],
      continueOnMissingResult: {
        maxTurns: 2,
        message: 'Return the configured result',
      },
      transientRetry: { maxRetries: 1, windowMs: 1000, initialBackoffMs: 0 },
    };
    await client.executors.manage.mutate({
      action: 'save',
      profile: {
        id: 'custom-fixture',
        name: 'Original integration',
        harness: 'custom',
        mode: 'direct',
        transport: 'http',
        turnUrl: 'http://127.0.0.1:1/fixture',
        cwd: '/tmp',
        expectedRevision: 0,
        ...preserved,
      },
    });
    await page.goto(`${app.url}/settings/ai`);
    await page
      .getByRole('button', { name: 'Edit defaults for Original integration' })
      .click();
    const link = page.getByRole('link', { name: 'Edit integration' });
    expect(await link.getAttribute('aria-haspopup')).toBeNull();
    await link.click();
    expect(
      await page
        .getByRole('link', { name: 'AI Settings' })
        .getAttribute('aria-current'),
    ).toBe('page');
    await page
      .getByRole('textbox', { name: /^Name/ })
      .fill('Renamed integration');
    await page.getByText('Advanced settings', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Working directory' }).fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByRole('heading', { name: 'Renamed integration' }).waitFor();
    const stored = (await client.executors.profiles.query()).find(
      (profile) => profile.id === 'custom-fixture',
    );
    expect(stored).toMatchObject({
      name: 'Renamed integration',
      revision: 2,
      ...preserved,
    });
    expect(stored).not.toHaveProperty('cwd');
  } finally {
    await page.close();
    await app.close();
  }
});
