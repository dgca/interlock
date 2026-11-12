import { blankDefinition } from '@interlock/core';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { paths } from '../../packages/ui/src/routes/paths';
import { openBrowserApp } from './app';

it('keeps unrelated catalogs out of Runs and opens instructions only when requested', async () => {
  const app = await openBrowserApp();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.setDefaultTimeout(5000);
  try {
    const prompt = app.engine.prompts.create({
      name: 'Reference',
      description: '',
      content: 'Check the proposed change before responding.',
    });
    const definition = blankDefinition();
    const agent = definition.nodes[1];
    if (agent.kind !== 'agent') throw new Error('Expected an Agent fixture');
    agent.promptIds = [prompt.id];
    const workflow = app.engine.create('Scoped workflow', '', definition);
    app.engine.publish(workflow.id);
    app.engine.startSummary(workflow.id, {}, undefined, 1, undefined, {
      title: 'Initial run',
    });

    const procedures = (url: URL) =>
      url.pathname.startsWith('/trpc/')
        ? url.pathname.slice('/trpc/'.length).split(',')
        : [];
    const reads = new Set<string>();
    page.on('request', (request) => {
      for (const procedure of procedures(new URL(request.url())))
        reads.add(procedure);
    });
    let failCatalog = true;
    await page.route(
      (url) => procedures(url).includes('prompts.catalog'),
      (route) => (failCatalog ? route.abort('failed') : route.continue()),
    );

    await page.goto(app.url + paths.runs());
    await page.getByRole('link', { name: 'Initial run' }).waitFor();
    app.engine.startSummary(workflow.id, {}, undefined, 1, undefined, {
      title: 'Live run',
    });
    await page.getByRole('link', { name: 'Live run' }).waitFor();
    expect(
      [...reads].filter((path) => /^(workflows|prompts)\./.test(path)),
    ).toEqual([]);

    reads.clear();
    await page.goto(app.url + paths.workflowRuns(workflow.id));
    await page.getByRole('link', { name: 'Live run' }).waitFor();
    expect(
      [...reads].filter((path) => /^(workflows|prompts)\./.test(path)),
    ).toEqual(['workflows.get']);
    const choices = page.waitForResponse((response) =>
      procedures(new URL(response.url())).includes('workflows.catalog'),
    );
    await page.getByRole('tab', { name: 'Editor', exact: true }).click();
    await choices;
    expect(reads.has('prompts.catalog')).toBe(false);

    await page.locator('.react-flow__controls-fitview').click();
    await page.locator('.react-flow__node[data-id="agent"]').dblclick();
    const settings = page.getByRole('dialog', { name: 'Agent assignment' });
    await settings.getByText('Could not load prompts.').waitFor();
    const instructions = settings.getByRole('textbox', {
      name: 'Task instructions',
    });
    await instructions.fill('Keep this local task draft.');
    failCatalog = false;
    await settings.getByRole('button', { name: 'Retry prompts' }).click();
    await settings.getByText('Reference', { exact: true }).waitFor();
    expect(await instructions.inputValue()).toBe('Keep this local task draft.');
    expect(reads.has('prompts.instructions')).toBe(false);
    await settings.getByText('View instructions', { exact: true }).click();
    await settings.getByText(prompt.content, { exact: true }).waitFor();
    expect(reads.has('prompts.instructions')).toBe(true);
    expect(reads.has('prompts.get')).toBe(false);
    expect(reads.has('prompts.list')).toBe(false);
    expect(reads.has('workflows.list')).toBe(false);
  } finally {
    await page.close();
    await browser.close();
    await app.close();
  }
});

it('checks exact children before offering deletion from scoped Runs', async () => {
  const app = await openBrowserApp();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(5000);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const workflow = app.engine.create('Parent workflow');
    app.engine.create('Owned child', '', blankDefinition(), workflow.id);
    let childReads = 0;
    await page.route(
      (url) =>
        url.pathname.includes('workflows.catalog') &&
        url.searchParams.get('input')?.includes('ownerWorkflowId') === true,
      async (route) => {
        if (++childReads === 1) {
          await hold;
          return route.abort('failed');
        }
        return route.continue();
      },
    );
    await page.goto(app.url + paths.workflowRuns(workflow.id));
    await page.getByRole('button', { name: 'Workflow actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete workflow' }).click();
    const dialog = page.getByRole('dialog');
    const remove = dialog.getByRole('button', { name: 'Delete', exact: true });
    await dialog
      .getByText('Checking for child workflows…', { exact: true })
      .waitFor();
    expect(await remove.count()).toBe(0);
    release();
    const retry = dialog.getByRole('button', { name: 'Retry child workflows' });
    await retry.waitFor();
    expect(await remove.count()).toBe(0);
    await retry.click();
    await page
      .getByRole('dialog', { name: 'Workflow has child workflows' })
      .waitFor();
    expect(await remove.count()).toBe(0);
    await dialog.getByRole('link', { name: 'View child workflows' }).click();
    await page.getByRole('button', { name: 'Open Owned child' }).waitFor();
    expect(childReads).toBe(2);
  } finally {
    release();
    await page.close();
    await browser.close();
    await app.close();
  }
});
