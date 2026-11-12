import { blankDefinition, nodeSchema } from '@interlock/core';
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
  'guards and reconciles a clean workflow publication at %dpx',
  async (width) => {
    const app = await openBrowserApp();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    let releasePublish!: () => void;
    const hold = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    let releaseCheck!: () => void;
    const holdCheck = new Promise<void>((resolve) => {
      releaseCheck = resolve;
    });
    let capturedCheck!: () => void;
    const staleCheck = new Promise<void>((resolve) => {
      capturedCheck = resolve;
    });
    try {
      const workflow = app.engine.create(
        'Draft for review',
        '',
        blankDefinition(),
      );
      const path = `/workflows/${workflow.id}`;
      let publications = 0;
      await page.route(
        (url) => url.pathname === '/trpc/workflows.publish',
        async (route) => {
          publications++;
          await hold;
          const response = await route.fetch();
          await response.dispose();
          await route.abort('failed');
        },
      );
      let failCheck = true;
      await page.route(
        (url) =>
          url.pathname.startsWith('/trpc/') &&
          url.pathname
            .slice('/trpc/'.length)
            .split(',')
            .includes('workflows.get'),
        async (route) => {
          if (failCheck) return route.abort('failed');
          const response = await route.fetch();
          capturedCheck();
          await holdCheck;
          await route.fulfill({ response });
          await response.dispose();
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
      const review = page.getByRole('dialog', { name: 'Review publication' });
      const check = review.getByRole('button', {
        name: 'Check published version',
      });
      await check.waitFor();
      expect(app.engine.workflow(workflow.id).latestVersion).toBe(1);
      await check.click();
      await review.getByRole('alert').waitFor();
      expect(publications).toBe(1);
      failCheck = false;
      await check.click();
      await staleCheck;
      app.engine.update(workflow.id, { name: 'Newer workflow' });
      app.engine.publish(workflow.id);
      await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange')),
      );
      const newerWorkflow = page.getByText('Newer workflow', { exact: true });
      await newerWorkflow.waitFor();
      releaseCheck();
      await page.getByText('Published version v2 is available.').waitFor();
      expect(await newerWorkflow.isVisible()).toBe(true);
      expect(publications).toBe(1);
      expect(new URL(page.url()).pathname).toBe(path);
    } finally {
      releasePublish();
      releaseCheck();
      await page.close();
      await app.close();
    }
  },
);

it('opens the parent after acknowledging a selected child version', async () => {
  const app = await openBrowserApp();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(5000);
  try {
    const parent = app.engine.create('Parent', '', blankDefinition());
    const child = app.engine.create(
      'Owned child',
      '',
      blankDefinition(),
      parent.id,
    );
    app.engine.publish(child.id);
    const childNode = nodeSchema.parse({
      id: 'agent',
      kind: 'workflow',
      label: 'Run child',
      workflowId: child.id,
      version: null,
    });
    const parentDraft = {
      ...parent.draft,
      nodes: parent.draft.nodes.map((node) =>
        node.id === childNode.id ? childNode : node,
      ),
    };
    app.engine.update(parent.id, {
      draft: parentDraft,
      draftRevision: parent.draftRevision,
    });
    await page.goto(`${app.url}/workflows/${child.id}`);
    await page.getByRole('button', { name: 'Use v1 in Run child' }).click();
    await page.waitForURL(`${app.url}/workflows/${parent.id}`);
    const selected = app.engine
      .workflow(parent.id)
      .draft.nodes.find((node) => node.id === childNode.id);
    expect(selected).toMatchObject({ version: 1, workflowId: child.id });
  } finally {
    await page.close();
    await app.close();
  }
});
