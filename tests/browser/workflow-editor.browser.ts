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

it.each([
  [1440, 'settled metadata'],
  [900, 'pending metadata'],
  [390, 'a newer version'],
] as const)(
  'guards and reconciles a clean workflow publication at %dpx with %s',
  async (width, scenario) => {
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
    let releaseObservedRead!: () => void;
    const holdObservedRead = new Promise<void>((resolve) => {
      releaseObservedRead = resolve;
    });
    let capturedObservedRead!: (ordinal: number) => void;
    const pendingObservedRead = new Promise<number>((resolve) => {
      capturedObservedRead = resolve;
    });
    try {
      const workflow = app.engine.create(
        'Draft for review',
        '',
        blankDefinition(),
      );
      const path = `/workflows/${workflow.id}`;
      let publications = 0;
      let workflowReads = 0;
      let nextRead: 'pass' | 'fail-check' | 'hold-check' | 'hold-observed' =
        'pass';
      // This test drives background refresh explicitly to separate it from the publication check.
      await page.route('**/events', (route) => route.abort());
      await page.route(
        (url) =>
          url.pathname.startsWith('/trpc/') &&
          url.pathname
            .slice('/trpc/'.length)
            .split(',')
            .includes('workflows.get'),
        async (route) => {
          const ordinal = ++workflowReads;
          const behavior = nextRead;
          nextRead = 'pass';
          if (behavior === 'pass') return route.continue();
          if (behavior === 'fail-check') return route.abort('failed');
          const response = await route.fetch();
          try {
            if (behavior === 'hold-observed') {
              capturedObservedRead(ordinal);
              await holdObservedRead;
            } else {
              capturedCheck();
              await holdCheck;
            }
            await route.fulfill({ response });
          } finally {
            await response.dispose();
          }
        },
      );
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
      nextRead = 'fail-check';
      await check.click();
      await review.getByRole('alert').waitFor();
      expect(publications).toBe(1);
      nextRead = 'hold-check';
      await check.click();
      await staleCheck;
      const renamed = app.engine.update(workflow.id, {
        name: 'Newer workflow',
      });
      expect(renamed.draftRevision).toBe(workflow.draftRevision);
      expect(renamed.latestVersion).toBe(1);
      if (scenario === 'a newer version') app.engine.publish(workflow.id);
      nextRead = scenario === 'pending metadata' ? 'hold-observed' : 'pass';
      await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange')),
      );
      const newerWorkflow = page.getByText('Newer workflow', { exact: true });
      const heldRead =
        scenario === 'pending metadata' ? await pendingObservedRead : undefined;
      if (heldRead === undefined) await newerWorkflow.waitFor();
      releaseCheck();
      const observedVersion = scenario === 'a newer version' ? 2 : 1;
      await page
        .getByText(`Published version v${observedVersion} is available.`)
        .waitFor();
      releaseObservedRead();
      await newerWorkflow.waitFor();
      if (heldRead !== undefined)
        await expect.poll(() => workflowReads).toBeGreaterThan(heldRead);
      expect(publications).toBe(1);
      expect(new URL(page.url()).pathname).toBe(path);
    } finally {
      releasePublish();
      releaseCheck();
      releaseObservedRead();
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
