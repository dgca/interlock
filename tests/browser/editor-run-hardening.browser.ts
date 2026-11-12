import { createClient } from '@interlock/client';
import { nodeSchema } from '@interlock/core';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { paths } from '../../packages/ui/src/routes/paths';
import { parallelDefinition } from '../fixtures/parallel';
import { openBrowserApp } from './app';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

it.each([1440, 900])(
  'guards pending native defaults saves and preserves drafts during conflict recovery at %dpx',
  async (width) => {
    const app = await openBrowserApp();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    let releaseWrite!: () => void;
    const holdWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    try {
      const client = createClient(app.url);
      const original = (await client.executors.profiles.query()).find(
        (profile) => profile.id === 'codex',
      )!;
      const { detection: _detection, revision, ...profile } = original;
      let writes = 0;
      await page.route(
        (url) => url.pathname === '/trpc/executors.manage',
        async (route) => {
          if (++writes === 1) await holdWrite;
          await route.continue();
        },
      );
      await page.goto(`${app.url}${paths.harnesses}`);
      const opener = page.getByRole('button', {
        name: 'Edit defaults for Codex',
      });
      await opener.click();
      const form = page.getByRole('form', { name: 'Codex defaults' });
      await form.getByText('Advanced settings', { exact: true }).click();
      const cwd = form.getByRole('textbox', { name: 'Working directory' });
      await cwd.fill('/tmp/local-edit');
      const confirm = page.getByRole('dialog', {
        name: 'Discard unsaved changes?',
      });
      const keep = confirm.getByRole('button', { name: 'Keep editing' });
      await form.getByLabel('Default model', { exact: true }).click();
      const modelSearch = page.getByPlaceholder('Find or enter a model ID');
      await modelSearch.press('Escape');
      await modelSearch.waitFor({ state: 'hidden' });
      expect(await confirm.isVisible()).toBe(false);
      expect(await cwd.inputValue()).toBe('/tmp/local-edit');

      await client.executors.manage.mutate({
        action: 'save',
        profile: { ...profile, cwd: '/tmp/latest', expectedRevision: revision },
      });

      await form.getByRole('button', { name: 'Save defaults' }).click();
      await expect.poll(() => writes).toBe(1);
      for (const name of ['Boards', 'Agent presets']) {
        await page.getByRole('link', { name, exact: true }).click();
        await page.evaluate(() => new Promise(requestAnimationFrame));
        if (await confirm.isVisible())
          await confirm
            .getByRole('button', { name: 'Discard changes' })
            .click();
        expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(
          paths.harnesses,
        );
        expect(await confirm.isVisible()).toBe(false);
        expect(await form.isVisible()).toBe(true);
      }
      releaseWrite();
      const reload = form.getByRole('button', { name: 'Reload defaults' });
      await reload.waitFor();
      expect(await cwd.inputValue()).toBe('/tmp/local-edit');
      await reload.click();
      await keep.click();
      expect(await cwd.inputValue()).toBe('/tmp/local-edit');
      await reload.click();
      await confirm.getByRole('button', { name: 'Discard changes' }).click();
      await expect.poll(() => cwd.inputValue()).toBe('/tmp/latest');
      await cwd.fill('/tmp/cancel-edit');
      await form.getByRole('button', { name: 'Cancel' }).click();
      await keep.click();
      expect(await cwd.inputValue()).toBe('/tmp/cancel-edit');
      await form.getByRole('button', { name: 'Cancel' }).click();
      await confirm.getByRole('button', { name: 'Discard changes' }).click();
      await form.waitFor({ state: 'hidden' });
      await expect
        .poll(() =>
          opener.evaluate((button) => button === document.activeElement),
        )
        .toBe(true);
      expect(writes).toBe(1);

      // The next write succeeds even though refreshing the harness list fails.
      const profilesRead = (url: URL) =>
        url.pathname.startsWith('/trpc/') &&
        url.pathname
          .slice('/trpc/'.length)
          .split(',')
          .includes('executors.profiles');
      const failedRefresh = (route: Route) => route.abort();
      await page.route(profilesRead, failedRefresh);
      await opener.click();
      await form.getByText('Advanced settings', { exact: true }).click();
      await cwd.fill('/tmp/acknowledged');
      await form.getByRole('button', { name: 'Save defaults' }).click();
      await form.waitFor({ state: 'hidden' });
      const retry = page.getByRole('button', { name: 'Retry harnesses' });
      await retry.waitFor();
      await opener.click();
      await form.getByText('Advanced settings', { exact: true }).click();
      expect(await cwd.inputValue()).toBe('/tmp/acknowledged');
      await cwd.press('Escape');
      await form.waitFor({ state: 'hidden' });
      await page.unroute(profilesRead, failedRefresh);
      await retry.click();
      await retry.waitFor({ state: 'hidden' });
      expect(writes).toBe(2);
    } finally {
      releaseWrite();
      await page.close();
      await app.close();
    }
  },
);

it('agrees on run status before, during, and after manual completion', async () => {
  const app = await openBrowserApp();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  try {
    const definition = parallelDefinition();
    const agent = nodeSchema.parse({
      kind: 'agent',
      id: 'agent',
      label: 'Review change',
      prompt: 'Review the change.',
    });
    const workflow = app.engine.create('Review workflow', '', {
      ...definition,
      nodes: [definition.nodes[0], agent, definition.nodes.at(-1)!],
      edges: [
        { id: 'in', source: 'entry', target: 'agent', port: 'default' },
        { id: 'out', source: 'agent', target: 'exit', port: 'default' },
      ],
    });
    app.engine.publish(workflow.id);
    const board = app.engine.boards.save({
      name: 'Reviews',
      columns: [{ name: 'Review' }],
      workflowIds: [workflow.id],
    });
    const run = app.engine.startSummary(
      workflow.id,
      {},
      undefined,
      1,
      undefined,
      {
        title: 'Status check',
      },
    );
    async function open(path: string) {
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      await page.goto(app.url + path);
      return page;
    }
    const [inspector, overview, list, boardPage] = await Promise.all([
      open(paths.run(run.runId)),
      open(paths.runs('active', 0, undefined, 'overview')),
      open(paths.runs()),
      open(paths.board(board.id)),
    ]);
    const title = { name: 'Status check', exact: true };
    const inspectorHeader = inspector.locator('header').filter({
      has: inspector.getByRole('heading', title),
    });
    const cardFor = (page: Page, item: string) =>
      page.locator(item).filter({ has: page.getByRole('link', title) });
    const overviewCard = cardFor(overview, '.run-row');
    const listRow = cardFor(list, '.run-row');
    const boardCard = cardFor(boardPage, 'li');
    const views = [inspectorHeader, overviewCard, listRow, boardCard];

    for (const view of views)
      await view.getByText('waiting', { exact: true }).waitFor();
    await boardCard
      .getByText('Waiting for an agent', { exact: true })
      .waitFor();
    await inspector
      .getByRole('button', { name: 'Claim for manual completion' })
      .click();
    for (const view of views)
      await view.getByText('running', { exact: true }).waitFor();
    for (const view of [overviewCard, listRow, boardCard])
      await view.getByText('Agent working', { exact: true }).waitFor();

    await inspector.getByRole('button', { name: 'Submit result' }).click();
    await list.getByRole('tab', { name: /^History/ }).click();
    for (const view of views)
      await view.getByText('completed', { exact: true }).waitFor();
  } finally {
    await context.close();
    await app.close();
  }
});

it.each(['default', 'authored'] as const)(
  'renders the %s Parallel run graph with separate bounds for the group and outer nodes',
  async (layout) => {
    const app = await openBrowserApp();
    const page = await browser.newPage({
      viewport: { width: 900, height: 900 },
    });
    page.setDefaultTimeout(5000);
    try {
      const client = createClient(app.url);
      const definition = parallelDefinition();
      for (const id of ['r0', 'r1']) {
        const index = definition.nodes.findIndex((node) => node.id === id);
        definition.nodes[index] = nodeSchema.parse({
          id,
          parallelId: 'parallel',
          parallelBranchId: id,
          kind: 'input',
          label: 'Review details',
          humanInput: { question: `Review ${id}?`, answer: { kind: 'text' } },
        });
      }
      const positions = {
        entry: { x: 140, y: 80 },
        parallel: { x: 480, y: 120 },
        exit: { x: 1160, y: 220 },
      };
      if (layout === 'authored') {
        for (const node of definition.nodes) {
          const position = positions[node.id as keyof typeof positions];
          if (position) node.position = position;
        }
      }
      const workflow = await client.workflows.create.mutate({
        name: 'API-created Parallel',
        definition: {
          ...definition,
          nodes:
            layout === 'authored'
              ? definition.nodes
              : definition.nodes.map(
                  ({ position: _position, ...node }) => node,
                ),
        },
      });
      await client.workflows.publish.mutate({ id: workflow.id });
      const run = await client.runs.startSummary.mutate({
        workflowId: workflow.id,
        input: {},
      });
      await page.goto(app.url + paths.run(run.runId));
      await page
        .getByRole('status')
        .filter({ hasText: 'Human input needed' })
        .waitFor();
      const nodeBounds = async (id: string) => {
        const node = page.locator(`.react-flow__node[data-id="${id}"]`);
        await node.waitFor();
        return (await node.boundingBox())!;
      };
      const [entry, group, exit, firstBranch, secondBranch] = await Promise.all(
        ['entry', 'parallel', 'exit', 'r0', 'r1'].map(nodeBounds),
      );
      expect(entry.x + entry.width).toBeLessThan(group.x);
      expect(group.x + group.width).toBeLessThan(exit.x);
      expect(firstBranch.y + firstBranch.height).toBeLessThan(secondBranch.y);
      for (const branch of [firstBranch, secondBranch]) {
        expect(branch.x).toBeGreaterThan(group.x);
        expect(branch.x + branch.width).toBeLessThan(group.x + group.width);
        expect(branch.y).toBeGreaterThan(group.y);
        expect(branch.y + branch.height).toBeLessThan(group.y + group.height);
      }
      if (layout === 'authored') {
        for (const [id, position] of Object.entries(positions)) {
          const rendered = await page
            .locator(`.react-flow__node[data-id="${id}"]`)
            .evaluate((node) => {
              const matrix = new DOMMatrix(getComputedStyle(node).transform);
              return { x: matrix.m41, y: matrix.m42 };
            });
          expect(rendered).toEqual(position);
        }
      }
    } finally {
      await page.close();
      await app.close();
    }
  },
);
