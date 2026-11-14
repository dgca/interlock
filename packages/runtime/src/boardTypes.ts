import { randomUUID } from 'node:crypto';
import {
  InterlockError,
  boardTypeContentSchema,
  type BoardType,
  type SaveBoardType,
  type WorkflowBoard,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { boardCollection } from './boardImport.js';

export const boardTypeCollection = 'boardTypes';
const boardTypeRevisionConflict = 'Board type changed. Refresh and try again.';

/** Reusable board templates. Boards reference a type by ID and read its current revision. */
export class BoardTypes {
  constructor(
    private store: Store,
    private changed: () => void,
  ) {}

  list() {
    const used = new Map<string, number>();
    for (const board of this.store.list<WorkflowBoard>(boardCollection))
      if (board.typeId)
        used.set(board.typeId, (used.get(board.typeId) ?? 0) + 1);
    return this.store
      .list<BoardType>(boardTypeCollection)
      .map((type) => ({ ...type, boardCount: used.get(type.id) ?? 0 }));
  }

  get(id: string) {
    const type = this.store.get<BoardType>(boardTypeCollection, id);
    if (!type) throw new InterlockError('Board type not found');
    return type;
  }

  save(input: SaveBoardType) {
    const content = boardTypeContentSchema.parse(input.type);
    const saved = this.store.transaction(() => {
      const current = input.id
        ? this.store.get<BoardType>(boardTypeCollection, input.id)
        : undefined;
      if ((current?.revision ?? 0) !== (input.expectedRevision ?? 0))
        throw new InterlockError(boardTypeRevisionConflict);
      const type: BoardType = {
        ...content,
        id: input.id ?? randomUUID(),
        revision: (current?.revision ?? 0) + 1,
      };
      this.store.put(boardTypeCollection, type);
      return type;
    });
    this.changed();
    return saved;
  }

  delete(id: string) {
    this.store.transaction(() => {
      this.get(id);
      if (
        this.store
          .list<WorkflowBoard>(boardCollection)
          .some((board) => board.typeId === id)
      )
        throw new InterlockError('Boards still use this board type');
      this.store.remove(boardTypeCollection, id);
    });
    this.changed();
  }
}
