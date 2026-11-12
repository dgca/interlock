import { nodeSchema, requestListSchema } from '@interlock/core';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
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

async function openInNewTab(page: Page, link: Locator) {
  const [tab] = await Promise.all([
    page.context().waitForEvent('page'),
    link.click({ modifiers: ['ControlOrMeta'] }),
  ]);
  tab.setDefaultTimeout(5000);
  return tab;
}

const address = (page: Page) => {
  const { pathname, search } = new URL(page.url());
  return pathname + search;
};

const tags = { purpose: 'navigation' };
const branches = ['Plan', 'Rollout'];

function seedBoard(
  app: Awaited<ReturnType<typeof openBrowserApp>>,
  count: number,
) {
  const board = app.engine.boards.save({
    name: 'Fixture board',
    columns: [{ name: 'Review' }],
    workflowIds: [],
  });
  const definition = parallelDefinition({ keys: branches });
  for (const [index, branch] of branches.entries()) {
    definition.nodes[2 + index] = nodeSchema.parse({
      id: `r${index}`,
      parallelId: 'parallel',
      parallelBranchId: `r${index}`,
      kind: 'input',
      label: 'Review details',
      boardColumnId: board.columns[0].id,
      humanInput: {
        question: `Review ${branch}?`,
        answer: { kind: 'text' },
      },
    });
  }
  const workflow = app.engine.create('Fixture workflow', '', definition);
  app.engine.publish(workflow.id);
  app.engine.boards.assign({
    workflowId: workflow.id,
    boardId: board.id,
    expectedBoardId: null,
  });
  for (let index = 0; index < count; index++) {
    app.engine.startSummary(workflow.id, {}, undefined, 1, undefined, {
      title: `Fixture run ${index + 1}`,
      tags,
    });
  }
  return { board, workflow };
}

const requestAt = (url: URL) => JSON.parse(url.searchParams.get('request')!);

it.each([1440, 900, 390])(
  'opens exact run and request destinations and returns to their source at %dpx',
  async (width) => {
    const app = await openBrowserApp();
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    try {
      const { board, workflow } = seedBoard(app, 31);

      await page.goto(
        `${app.url}${paths.board(board.id)}?workflow=${workflow.id}&status=attention`,
      );
      const columns = page.getByRole('region', { name: 'Board columns' });
      const titles = columns.getByRole('link', { name: /^Fixture run / });
      await page.getByRole('button', { name: 'Load more in Review' }).click();
      await expect.poll(() => titles.count()).toBe(31);
      const sourceBoard = address(page);
      const title = titles.last();
      const runTitle = (await title.textContent())!.trim();
      const href = new URL((await title.getAttribute('href'))!, app.url);
      expect(href.searchParams.get('returnTo')).toBe(sourceBoard);
      const runId = href.pathname.split('/').at(-1)!;
      const requests = app.engine.requests.list(
        requestListSchema.parse({ runId }),
      ).items;
      expect(requests).toHaveLength(2);

      const inspector = await openInNewTab(page, title);
      await inspector
        .getByRole('heading', { name: runTitle, exact: true })
        .waitFor();
      expect(new URL(inspector.url()).pathname).toBe(`/runs/${runId}`);
      await inspector.getByRole('button', { name: 'Review 2 items' }).click();
      const targetByBranch = new Map(
        requests.map(({ target }) => [
          app.engine.run(target.runId).parallelBranch!.key,
          target,
        ]),
      );
      for (const branch of branches) {
        const item = inspector.getByRole('menuitem', {
          name: `Review request · Review details · ${branch}`,
          exact: true,
        });
        expect(
          requestAt(new URL((await item.getAttribute('href'))!, app.url)),
        ).toEqual(targetByBranch.get(branch));
      }
      const selected = targetByBranch.get(branches[0])!;
      await inspector
        .getByRole('menuitem', {
          name: `Review request · Review details · ${branches[0]}`,
        })
        .click();
      await inspector.getByRole('link', { name: 'Open run' }).click();
      await inspector
        .getByRole('link', { name: 'Review request', exact: true })
        .first()
        .click();
      expect(requestAt(new URL(inspector.url()))).toEqual(selected);
      const repeatUrl = address(inspector);
      await inspector.getByRole('link', { name: 'Open run' }).click();
      await inspector
        .getByRole('link', { name: 'Review request', exact: true })
        .first()
        .click();
      expect(address(inspector)).toBe(repeatUrl);
      await inspector.getByRole('button', { name: 'Back to run' }).click();
      await inspector.getByRole('button', { name: 'Back to board' }).click();
      expect(address(inspector)).toBe(sourceBoard);
      await expect
        .poll(() =>
          inspector
            .getByRole('region', { name: 'Board columns' })
            .getByRole('link', { name: /^Fixture run / })
            .count(),
        )
        .toBe(31);
      await inspector.close();

      const review = title
        .locator('xpath=ancestor::article')
        .getByRole('link', { name: 'Review request' });
      const request = await openInNewTab(page, review);
      await request.getByRole('button', { name: 'Switch request' }).click();
      expect(requestAt(new URL(request.url()))).toEqual(requests[0].target);
      const next = await openInNewTab(
        request,
        request.getByRole('menuitem', {
          name: `${requests[1].label} · ${requests[1].target.executionId!.slice(0, 8)}`,
          exact: true,
        }),
      );
      const requestUrl = address(next);
      await next
        .getByRole('heading', {
          name: `Review ${app.engine.run(requests[1].target.runId).parallelBranch!.key}?`,
        })
        .waitFor();
      expect(requestAt(new URL(next.url()))).toEqual(requests[1].target);
      await next.getByRole('link', { name: 'Open run' }).click();
      await next
        .getByRole('region', { name: 'Human input', exact: true })
        .waitFor();
      expect(new URL(next.url()).pathname).toBe(
        `/runs/${requests[1].target.runId}`,
      );
      expect(new URL(next.url()).searchParams.get('execution')).toBe(
        requests[1].target.executionId,
      );
      expect(
        await next
          .getByRole('complementary', { name: 'Selected step' })
          .textContent(),
      ).toContain('Human input');
      await next.getByRole('button', { name: 'Back to request' }).click();
      expect(address(next)).toBe(requestUrl);
      await next.getByRole('button', { name: 'Back to Fixture board' }).click();
      expect(address(next)).toBe(sourceBoard);
      await expect
        .poll(() =>
          next
            .getByRole('region', { name: 'Board columns' })
            .getByRole('link', { name: /^Fixture run / })
            .count(),
        )
        .toBe(31);

      const sourceRuns =
        width === 900
          ? paths.runs('attention', 0, tags, 'overview')
          : paths.workflowRuns(workflow.id, 'attention', 0, tags);
      await page.goto(app.url + sourceRuns);
      const runLink = page.getByRole('link', { name: runTitle, exact: true });
      const runTab = await openInNewTab(page, runLink);
      await runTab
        .getByRole('heading', { name: runTitle, exact: true })
        .waitFor();
      expect(new URL(runTab.url()).pathname).toBe(`/runs/${runId}`);
      await runTab.getByRole('button', { name: 'Back to runs' }).click();
      expect(address(runTab)).toBe(sourceRuns);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await context.close();
      await app.close();
    }
  },
);

it('restores large Board depths sequentially and stops at a failed page', async () => {
  const app = await openBrowserApp();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  let releaseFirstPage!: () => void;
  const firstPageHeld = new Promise<void>((resolve) => {
    releaseFirstPage = resolve;
  });
  try {
    const { board } = seedBoard(app, 61);
    const offsets: number[] = [];
    await page.route(
      (url) =>
        url.pathname.slice('/trpc/'.length).split(',').includes('boards.get'),
      async (route) => {
        const url = new URL(route.request().url());
        const procedures = url.pathname.slice('/trpc/'.length).split(',');
        const input = JSON.parse(url.searchParams.get('input')!) as Record<
          string,
          { column?: string; offset?: number; limit: number }
        >;
        const previousCount = offsets.length;
        procedures.forEach((procedure, index) => {
          const args = input[index];
          if (procedure !== 'boards.get' || args.column !== board.columns[0].id)
            return;
          expect(args.limit).toBe(30);
          offsets.push(args.offset!);
        });
        if (!previousCount && offsets.length) {
          await firstPageHeld;
          await route.abort('failed');
        } else await route.continue();
      },
    );
    const depth = new URLSearchParams({
      [`page:${board.columns[0].id}`]: String(Number.MAX_SAFE_INTEGER),
    });
    const source = `${paths.board(board.id)}?${depth}`;
    await page.goto(app.url + source);
    const cards = page.getByRole('link', { name: /^Fixture run / });
    await expect.poll(() => offsets).toEqual([30]);
    expect(await cards.count()).toBe(30);
    releaseFirstPage();
    const retry = page.getByRole('button', { name: 'Retry page 2 in Review' });
    await retry.waitFor();
    expect(offsets).toEqual([30]);
    await retry.click();
    await expect.poll(() => cards.count()).toBe(61);
    expect(offsets).toEqual([30, 30, 60]);
    expect(address(page)).toBe(source);
  } finally {
    releaseFirstPage();
    await page.close();
    await app.close();
  }
});
