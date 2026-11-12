import {
  blankDefinition,
  promptCatalogEntry,
  workflowCatalogEntry,
} from '@interlock/core';
import { Engine } from '@interlock/runtime';
import { Store } from '@interlock/storage';
import { expect, it, vi } from 'vitest';
import { appRouter } from '../packages/server/src/router';

it('reads workflow and prompt metadata without loading full catalogs or versions', async () => {
  const store = new Store(':memory:');
  const engine = new Engine(store, process.cwd());
  try {
    const definition = blankDefinition();
    const node = definition.nodes[1];
    if (node.kind !== 'agent') throw new Error('Expected an Agent fixture');
    node.prompt = 'Large workflow instructions. '.repeat(200);
    const root = engine.create('Root', '', definition);
    const child = engine.create('Owned child', '', definition, root.id);
    for (let index = 0; index < 20; index++) {
      const unrelated = engine.create(`Unrelated ${index}`, '', definition);
      engine.publish(unrelated.id);
    }
    engine.publish(root.id);
    const board = engine.boards.save({
      name: 'Operations',
      columns: [{ name: 'Review' }],
      workflowIds: [],
    });
    engine.boards.assign({
      workflowId: root.id,
      boardId: board.id,
      expectedBoardId: null,
    });
    const prompt = engine.prompts.create({
      name: 'Reference',
      description: '',
      content: 'Large prompt instructions. '.repeat(200),
    });
    const expected = engine.workflow(root.id);
    const fullLists = vi.spyOn(store, 'list');
    const versions = vi.spyOn(store, 'getVersion');
    const caller = appRouter.createCaller({ engine });

    const workflowRows = await caller.workflows.catalog();
    expect(workflowRows).toHaveLength(22);
    expect(
      workflowRows.find((row) => row.id === child.id)?.ownerWorkflowId,
    ).toBe(root.id);
    expect(await caller.workflows.catalog({ id: root.id })).toEqual([
      workflowCatalogEntry(expected),
    ]);
    expect(await caller.workflows.catalog({ boardId: board.id })).toEqual([
      workflowCatalogEntry(expected),
    ]);
    expect(
      await caller.workflows.catalog({ id: child.id, boardId: board.id }),
    ).toEqual([]);
    expect(
      await caller.workflows.catalog({ ownerWorkflowId: root.id }),
    ).toEqual([workflowCatalogEntry(child)]);
    expect(await caller.prompts.catalog()).toEqual([
      promptCatalogEntry(prompt),
    ]);
    expect(await caller.prompts.instructions({ id: prompt.id })).toEqual(
      prompt,
    );
    expect(fullLists).not.toHaveBeenCalled();
    expect(versions).not.toHaveBeenCalled();
    expect(JSON.stringify(workflowRows)).not.toContain(node.prompt);
  } finally {
    engine.stop();
    store.close();
  }
});
