import { blankDefinition, nodeSchema } from '@interlock/core';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { paths } from '../../packages/ui/src/routes/paths';
import { openBrowserApp } from './app';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

function defer() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function heldRead() {
  return { started: defer(), release: defer() };
}

it.each([1440, 900, 390])(
  'recovers Board collections without mixing query results at %dpx',
  async (width) => {
    const app = await openBrowserApp();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    const initial = heldRead();
    const refresh = heldRead();
    const completed = heldRead();
    const completedFailed = defer();
    let listFailure: ReturnType<typeof heldRead> | undefined = initial;
    let completedFailure = true;
    try {
      const board = app.engine.boards.save({
        name: 'Operations',
        columns: [{ name: 'Review' }],
        workflowIds: [],
      });
      app.engine.boards.save({
        name: 'Backlog',
        columns: [{ name: 'Queued' }],
        workflowIds: [],
      });
      const definition = blankDefinition();
      definition.nodes[1] = nodeSchema.parse({
        id: 'agent',
        kind: 'input',
        label: 'Check result',
        humanInput: { question: 'Ready?', answer: { kind: 'text' } },
        boardColumnId: board.columns[0].id,
      });
      const workflow = app.engine.create('Review workflow', '', definition);
      app.engine.publish(workflow.id);
      app.engine.boards.assign({
        workflowId: workflow.id,
        boardId: board.id,
        expectedBoardId: null,
      });
      app.engine.startSummary(workflow.id, {}, undefined, 1, undefined, {
        title: 'Waiting for review',
      });

      await page.route(
        (url) =>
          url.pathname.startsWith('/trpc/') &&
          url.pathname
            .slice('/trpc/'.length)
            .split(',')
            .some(
              (procedure) =>
                procedure === 'boards.list' || procedure === 'boards.get',
            ),
        async (route) => {
          const url = new URL(route.request().url());
          const procedures = url.pathname.slice('/trpc/'.length).split(',');
          if (listFailure && procedures.includes('boards.list')) {
            const failure = listFailure;
            failure.started.resolve();
            await failure.release.promise;
            await route.abort('failed');
            return;
          }
          const index = procedures.indexOf('boards.get');
          if (index >= 0 && completedFailure) {
            const args = JSON.parse(url.searchParams.get('input')!)[index];
            if (args?.status === 'completed') {
              completed.started.resolve();
              await completed.release.promise;
              await route.abort('failed');
              completedFailed.resolve();
              return;
            }
          }
          await route.continue();
        },
      );

      await page.goto(app.url + paths.boards);
      const boardsLoading = page.getByText('Loading boards…', { exact: true });
      await boardsLoading.waitFor();
      await initial.started.promise;
      initial.release.resolve();
      const retryBoards = page.getByRole('button', {
        name: 'Retry boards',
        disabled: false,
      });
      await retryBoards.waitFor();
      expect(await boardsLoading.count()).toBe(0);
      expect(
        await page.getByRole('heading', { name: 'No boards yet' }).count(),
      ).toBe(0);
      await retryBoards.focus();
      listFailure = undefined;
      await page.keyboard.press('Enter');

      const search = page.getByRole('textbox', { name: 'Search boards' });
      const operations = page.getByRole('link', {
        name: 'Operations',
        exact: true,
      });
      await operations.waitFor();
      expect(
        await search.evaluate((element) => element === document.activeElement),
      ).toBe(true);
      expect(await operations.getAttribute('href')).toBe(paths.board(board.id));
      await search.fill('no such board');
      await page.getByRole('heading', { name: 'No matching boards' }).waitFor();
      expect(await operations.count()).toBe(0);
      const clearSearch = page.getByRole('button', { name: 'Clear search' });
      await clearSearch.focus();
      await page.keyboard.press('Enter');
      expect(
        await search.evaluate((element) => element === document.activeElement),
      ).toBe(true);
      await operations.waitFor();

      const run = page.getByRole('link', {
        name: 'Waiting for review',
        exact: true,
      });
      await operations.click();
      await run.waitFor();
      listFailure = refresh;
      await page.getByRole('button', { name: 'Back to boards' }).click();
      await refresh.started.promise;
      await operations.waitFor();
      expect(await boardsLoading.count()).toBe(0);
      refresh.release.resolve();
      const staleBoards = page.getByText(
        /Could not refresh boards\. Showing the last loaded data\./,
      );
      await staleBoards.waitFor();
      await operations.waitFor();
      await retryBoards.focus();
      listFailure = undefined;
      await page.keyboard.press('Enter');
      await staleBoards.waitFor({ state: 'hidden' });

      await operations.click();
      await run.waitFor();
      const status = page.getByRole('combobox', {
        name: 'Status',
        exact: true,
      });
      const selectStatus = async (name: string) => {
        await status.click();
        await page.getByRole('option', { name, exact: true }).click();
      };
      await selectStatus('Completed');
      await completed.started.promise;
      await page.getByText('Loading board…', { exact: true }).waitFor();
      expect(await run.count()).toBe(0);
      await selectStatus('Waiting');
      await run.waitFor();
      completed.release.resolve();
      await completedFailed.promise;
      const retryBoard = page.getByRole('button', {
        name: 'Retry board',
        exact: true,
      });
      expect(await retryBoard.count()).toBe(0);
      await run.waitFor();

      await selectStatus('Completed');
      await retryBoard.waitFor();
      expect(await run.count()).toBe(0);
      expect(await page.getByText('No runs match these filters.').count()).toBe(
        0,
      );
      await retryBoard
        .and(page.getByRole('button', { disabled: false }))
        .focus();
      completedFailure = false;
      await page.keyboard.press('Enter');
      await page.getByText('No runs match these filters.').waitFor();
      expect(
        await status.evaluate((element) => element === document.activeElement),
      ).toBe(true);
      const clearFilters = page.getByRole('button', {
        name: 'Clear filters',
        exact: true,
      });
      await clearFilters.focus();
      await page.keyboard.press('Enter');
      await run.waitFor();
      expect(
        await status.evaluate((element) => element === document.activeElement),
      ).toBe(true);
      expect(new URL(page.url()).search).toBe('');

      await page.getByRole('button', { name: 'Back to boards' }).click();
      await page.getByRole('link', { name: 'Backlog', exact: true }).click();
      await page.getByText('No runs on this board.', { exact: true }).waitFor();
      expect(await run.count()).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      initial.release.resolve();
      refresh.release.resolve();
      completed.release.resolve();
      await page.close();
      await app.close();
    }
  },
);

it('returns keyboard focus to Filter by tags after a Runs retry or filter reset', async () => {
  const app = await openBrowserApp();
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(5000);
  const delayed = heldRead();
  let unavailable = true;
  let holdRetry = false;
  try {
    const tags = { purpose: 'fixture' };
    const list = paths.runs('active', 0, tags);
    await page.route(
      (url) =>
        url.pathname.startsWith('/trpc/') &&
        url.pathname
          .slice('/trpc/'.length)
          .split(',')
          .includes('runs.summaries'),
      async (route) => {
        const url = new URL(route.request().url());
        const procedures = url.pathname.slice('/trpc/'.length).split(',');
        const input = JSON.parse(url.searchParams.get('input')!);
        const isFilteredRuns = procedures.some(
          (procedure, index) =>
            procedure === 'runs.summaries' &&
            input[index]?.tab === 'active' &&
            input[index]?.offset === 0 &&
            input[index]?.tags?.purpose === tags.purpose,
        );
        if (!isFilteredRuns) return route.continue();
        if (unavailable) {
          await route.abort('failed');
          return;
        }
        if (holdRetry) {
          holdRetry = false;
          delayed.started.resolve();
          await delayed.release.promise;
        }
        await route.continue();
      },
    );
    const retry = page.getByRole('button', {
      name: 'Retry runs',
      exact: true,
      disabled: false,
    });
    const filter = page.getByRole('button', { name: /^Filter by tags/ });
    const clear = page.getByRole('button', {
      name: 'Clear filters',
      exact: true,
    });
    const keyboardActivate = async (button: typeof retry) => {
      await button.focus();
      await page.keyboard.press('Enter');
    };
    const expectFocus = async (button: typeof retry) =>
      expect(
        await button.evaluate((element) => document.activeElement === element),
      ).toBe(true);

    await page.goto(app.url + list);
    await retry.focus();
    unavailable = false;
    await page.keyboard.press('Enter');
    await clear.waitFor();
    await expectFocus(filter);
    await keyboardActivate(clear);
    await page.getByText('No active runs.', { exact: true }).waitFor();
    await expectFocus(filter);
    expect(new URL(page.url()).searchParams.has('tags')).toBe(false);

    await page.goto(app.url + paths.runs('active', 0, tags, 'overview'));
    await keyboardActivate(clear);
    await page.getByText('No active runs.', { exact: true }).waitFor();
    await expectFocus(filter);
    expect(new URL(page.url()).searchParams.has('tags')).toBe(false);

    unavailable = true;
    await page.goto(app.url + list);
    await retry.focus();
    holdRetry = true;
    unavailable = false;
    await page.keyboard.press('Enter');
    await delayed.started.promise;
    const history = page.getByRole('button', { name: 'History settings' });
    await history.focus();
    delayed.release.resolve();
    await clear.waitFor();
    await expectFocus(history);
  } finally {
    delayed.release.resolve();
    await page.close();
    await app.close();
  }
});

it('refreshes the exact inspector read after an event arrives while it is pending', async () => {
  const app = await openBrowserApp();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.setDefaultTimeout(5000);
  const initial = heldRead();
  const procedure = (url: URL, name: string) =>
    url.pathname.startsWith('/trpc/') &&
    url.pathname.slice('/trpc/'.length).split(',').includes(name);
  let inspectorReads = 0;
  let inspectorReadFailed = false;
  try {
    const workflow = app.engine.create(
      'Inspector refresh fixture',
      '',
      blankDefinition(),
    );
    app.engine.publish(workflow.id);
    const run = app.engine.startSummary(
      workflow.id,
      {},
      undefined,
      1,
      undefined,
      {
        title: 'Refresh while reading',
      },
    );
    await page.route(
      (url) => procedure(url, 'runs.get'),
      async (route) => {
        inspectorReads++;
        if (inspectorReads > 1) {
          await route.continue();
          return;
        }
        const beforeEvent = await route.fetch();
        initial.started.resolve();
        await initial.release.promise;
        await route.fulfill({ response: beforeEvent });
      },
    );
    page.on('requestfailed', (request) => {
      if (procedure(new URL(request.url()), 'runs.get'))
        inspectorReadFailed = true;
    });

    await page.goto(app.url + paths.runs());
    await page
      .getByRole('link', { name: 'Refresh while reading', exact: true })
      .click();
    await initial.started.promise;
    await page.getByText('Loading run…', { exact: true }).waitFor();

    const eventRefresh = page.waitForRequest((request) =>
      procedure(new URL(request.url()), 'triggers.attention'),
    );
    app.engine.cancel(run.runId);
    await eventRefresh;
    expect(inspectorReads).toBe(1);
    initial.release.resolve();

    const summary = page.getByRole('status').filter({ hasText: 'Cancelled' });
    await summary.waitFor();
    expect(new URL(page.url()).pathname).toBe(paths.run(run.runId));
    expect(inspectorReads).toBe(2);
    expect(inspectorReadFailed).toBe(false);
  } finally {
    initial.release.resolve();
    await page.close();
    await app.close();
  }
});
