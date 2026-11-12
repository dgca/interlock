import { blankDefinition, scheduleConfigSchema } from '@interlock/core';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openBrowserApp } from './app';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

async function checkTable(page: Page, name: string, headings: string[]) {
  const table = page.getByRole('table', { name, exact: true });
  await table.waitFor();
  expect(await table.getByRole('columnheader').allTextContents()).toEqual(
    headings,
  );
  expect(
    await table.evaluate((element: HTMLTableElement) =>
      Array.from(element.rows).every((row) =>
        Array.from(row.cells).every((cell, index) =>
          row.rowIndex === 0
            ? cell.scope === 'col'
            : index === 0 && cell.colSpan === 1
              ? cell.scope === 'row'
              : cell.tagName === 'TD',
        ),
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  return table;
}

it.each([1440, 900, 390])(
  'keeps collection headers and row controls available at %dpx',
  async (width) => {
    const app = await openBrowserApp();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    try {
      const workflow = app.engine.create(
        'Fixture workflow',
        '',
        blankDefinition(),
      );
      app.engine.publish(workflow.id);
      app.engine.triggers.mutate({
        action: 'create',
        workflowId: workflow.id,
        config: scheduleConfigSchema.parse({
          name: 'Fixture automation',
          timing: { type: 'interval', intervalMs: 30000 },
        }),
      });
      app.engine.prompts.create({
        name: 'Fixture prompt',
        description: 'A prompt used to check collection layout',
        content: 'Review the run.',
      });
      app.engine.variables.mutate({
        action: 'create',
        name: 'FIXTURE_VARIABLE',
        kind: 'config',
        value: 'fixture',
      });
      app.engine.modelAliases.mutate({
        action: 'create',
        name: 'Fixture preset',
        candidates: [{ model: 'fixture-model', profileId: 'codex' }],
      });
      app.engine.executors.manage({
        action: 'save',
        profile: {
          id: 'fixture-integration',
          name: 'Fixture integration',
          harness: 'custom',
          mode: 'direct',
          transport: 'http',
          turnUrl: 'http://127.0.0.1:1/fixture',
          expectedRevision: 0,
        },
      });

      await page.goto(`${app.url}/automations`);
      const automations = await checkTable(page, 'Automations', [
        'Automation',
        'Workflow',
        'Status',
        'Activity',
      ]);
      const automationLink = automations
        .getByRole('rowheader')
        .getByRole('link', { name: 'Fixture automation', exact: true });
      await automationLink.waitFor();
      if (width === 390) {
        const scroll = page.getByRole('region', { name: 'Scroll Automations' });
        await scroll.focus();
        await page.keyboard.press('ArrowRight');
        await expect
          .poll(() => scroll.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
        await page.keyboard.press('Tab');
        expect(
          await automationLink.evaluate(
            (element) => element === document.activeElement,
          ),
        ).toBe(true);
      }

      await page.goto(`${app.url}/prompts`);
      const prompts = await checkTable(page, 'Prompts', [
        'Name',
        'Revision',
        'Updated',
      ]);
      await prompts
        .getByRole('rowheader')
        .getByRole('link', {
          name: 'Fixture prompt',
          exact: true,
        })
        .waitFor();

      await page.goto(`${app.url}/variables`);
      const variables = await checkTable(page, 'Variables', [
        'Name',
        'Kind',
        'Status',
        'Updated',
      ]);
      await variables
        .getByRole('rowheader')
        .getByRole('link', {
          name: 'FIXTURE_VARIABLE',
          exact: true,
        })
        .waitFor();

      await page.goto(`${app.url}/settings/ai?tab=model-aliases`);
      const presets = await checkTable(page, 'Agent presets', [
        'Preset',
        'Primary choice',
        'Fallbacks',
        'Actions',
      ]);
      await presets
        .getByRole('cell')
        .getByRole('button', {
          name: 'Edit preset Fixture preset',
        })
        .waitFor();

      await page.goto(`${app.url}/settings/ai?tab=harnesses`);
      const harnesses = await checkTable(page, 'Harnesses', [
        'Harness',
        'Connection',
        'Managed execution',
        'Actions',
      ]);
      const defaults = harnesses.getByRole('button', {
        name: 'Edit defaults for Fixture integration',
      });
      await defaults.focus();
      await page.keyboard.press('Enter');
      const editor = harnesses.getByRole('form', {
        name: 'Fixture integration defaults',
      });
      const cancel = editor.getByRole('button', { name: 'Cancel' });
      await cancel.waitFor();
      const box = (await editor.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      await cancel.click();
      expect(
        await defaults.evaluate(
          (element) => element === document.activeElement,
        ),
      ).toBe(true);

      await page.goto(`${app.url}/workflows`);
      const workflowLink = page.getByRole('link', {
        name: 'Fixture workflow',
        exact: true,
      });
      await page
        .getByRole('list')
        .getByRole('listitem')
        .filter({ has: workflowLink })
        .waitFor();
    } finally {
      await page.close();
      await app.close();
    }
  },
);
