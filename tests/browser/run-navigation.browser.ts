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
      const board = app.engine.boards.save({
        name: 'Fixture board',
        columns: [{ name: 'Review' }],
        workflowIds: [],
      });
      const definition = parallelDefinition();
      for (const [index, label] of ['Plan', 'Rollout'].entries()) {
        definition.nodes[2 + index] = nodeSchema.parse({
          id: `r${index}`,
          parallelId: 'parallel',
          parallelBranchId: `r${index}`,
          kind: 'input',
          label,
          boardColumnId: board.columns[0].id,
          humanInput: {
            question: `Review ${label}?`,
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
      const tags = { purpose: 'navigation' };
      for (let index = 0; index < 31; index++) {
        app.engine.startSummary(workflow.id, {}, undefined, 1, undefined, {
          title: `Fixture run ${index + 1}`,
          tags,
        });
      }

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
      expect(
        JSON.parse(new URL(request.url()).searchParams.get('request')!),
      ).toEqual(requests[0].target);
      const next = await openInNewTab(
        request,
        request.getByRole('menuitem', { name: requests[1].label }),
      );
      const requestUrl = address(next);
      await next
        .getByRole('heading', { name: `Review ${requests[1].label}?` })
        .waitFor();
      expect(
        JSON.parse(new URL(next.url()).searchParams.get('request')!),
      ).toEqual(requests[1].target);
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
