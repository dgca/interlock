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
