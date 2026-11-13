import { createClient } from '@interlock/client';
import { blankDefinition } from '@interlock/core';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { paths } from '../../packages/ui/src/routes/paths';
import { openBrowserApp } from './app';

it.each([1440, 390])(
  'reviews and applies an existing board mapping from the import dialog at %dpx',
  async (width) => {
    const app = await openBrowserApp();
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(5000);
    try {
      const client = createClient(app.url);
      const destination = app.engine.boards.save({
        name: 'Local delivery',
        columns: [{ name: 'Verify' }, { name: 'Done' }],
        workflowIds: [],
      });
      const definition = blankDefinition();
      definition.nodes[1].stage = 'Review';
      definition.nodes[1].stageId = 'review';
      const draft = {
        id: 'portable-review',
        name: 'Portable review',
        description: '',
        ownerWorkflowId: null,
        draft: definition,
        draftRevision: 1,
        latestVersion: 1,
        versions: [{ version: 1, definition }],
        boardSuggestion: {
          id: 'source-board',
          name: 'Source delivery',
          columns: [{ id: 'source-review', name: 'Review' }],
          stages: [{ id: 'review', name: 'Review', columnId: 'source-review' }],
        },
      };
      const bundle = {
        format: 'interlock-workflows',
        formatVersion: 11,
        rootId: draft.id,
        workflows: [draft],
      };
      await page.goto(app.url + paths.workflows);
      await page
        .getByRole('button', { name: 'Browse starter workflows' })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Import workflows' });
      await dialog.getByRole('button', { name: 'Paste JSON' }).click();
      await dialog
        .getByRole('textbox', { name: 'Workflow JSON' })
        .fill(JSON.stringify(bundle));
      await dialog.getByRole('button', { name: 'Preview workflow' }).click();
      const setup = dialog.getByRole('region', { name: 'Board setup' });
      await setup.getByLabel('Board action').selectOption('existing');
      await setup.getByLabel('Existing board').selectOption(destination.id);
      await setup
        .getByLabel('Review', { exact: true })
        .selectOption(destination.columns[0].id);
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      const submit = dialog.getByRole('button', { name: 'Import workflow' });
      if (width === 1440) {
        app.engine.boards.save({
          id: destination.id,
          expectedRevision: destination.revision,
          name: destination.name,
          columns: [
            { ...destination.columns[0], name: 'Quality check' },
            destination.columns[1],
          ],
          workflowIds: [],
        });
        await submit.click();
        await dialog
          .getByRole('alert')
          .filter({ hasText: 'Board settings changed' })
          .waitFor();
        expect(app.engine.store.get('workflows', draft.id)).toBeUndefined();
        await setup
          .getByRole('button', { name: 'Reload board columns' })
          .click();
        await setup
          .getByRole('option', { name: 'Quality check' })
          .waitFor({ state: 'attached' });
        expect(
          await setup.getByLabel('Review', { exact: true }).inputValue(),
        ).toBe(destination.columns[0].id);
      }
      await submit.click();
      await dialog.waitFor({ state: 'hidden' });
      const workflow = app.engine.workflow(draft.id);
      expect(workflow.boardId).toBe(destination.id);
      expect(workflow.boardStageColumns).toEqual({
        review: destination.columns[0].id,
      });
      const run = await client.runs.startSummary.mutate({
        workflowId: draft.id,
        input: {},
      });
      const column = app.engine.boards
        .read({
          id: destination.id,
          status: 'all',
          offset: 0,
          limit: 30,
        })
        .columns.find(
          ({ name }) => name === (width === 1440 ? 'Quality check' : 'Verify'),
        );
      expect(column?.cards.map(({ runId }) => runId)).toEqual([run.runId]);
    } finally {
      await browser.close();
      await app.close();
    }
  },
);
