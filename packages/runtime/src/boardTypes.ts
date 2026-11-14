import { randomUUID } from 'node:crypto';
import {
  InterlockError,
  boardTypeContentSchema,
  boardTypePresets,
  type BoardType,
  type SaveBoardType,
  type WorkflowBoard,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { boardCollection } from './boardImport.js';

const boardTypeCollection = 'boardTypes';
const boardTypeRevisionConflict = 'Board type changed. Refresh and try again.';
/**
 * The presets under their IDs (`coding`, `design`, `research`), at revision 0
 * until a board uses one or someone saves it, which stores an editable copy.
 */
const builtIn = (id: string): BoardType | undefined =>
  Object.hasOwn(boardTypePresets, id)
    ? {
        ...boardTypePresets[id as keyof typeof boardTypePresets],
        id,
        revision: 0,
      }
    : undefined;

/** Reusable board templates. Boards reference a type by ID and read its current revision. */
export class BoardTypes {
  constructor(
    private store: Store,
    private changed: () => void,
  ) {}

  /** Saved types; with `builtIn`, also the presets not saved yet, marked `builtIn: true`. */
  list(options: { builtIn?: boolean } = {}) {
    const used = new Map<string, number>();
    for (const board of this.store.list<WorkflowBoard>(boardCollection))
      if (board.typeId)
        used.set(board.typeId, (used.get(board.typeId) ?? 0) + 1);
    const saved = this.store.list<BoardType>(boardTypeCollection);
    const ids = new Set(saved.map((type) => type.id));
    const presets = options.builtIn
      ? Object.keys(boardTypePresets)
          .filter((id) => !ids.has(id))
          .map((id) => ({ ...builtIn(id)!, builtIn: true as const }))
      : [];
    return [...presets, ...saved].map((type) => ({
      ...type,
      boardCount: used.get(type.id) ?? 0,
    }));
  }

  get(id: string) {
    const type =
      this.store.get<BoardType>(boardTypeCollection, id) ?? builtIn(id);
    if (!type) throw new InterlockError('Board type not found');
    return type;
  }

  /** The saved type, storing a copy of a preset the first time a board uses it. Call inside a transaction. */
  use(id: string) {
    const type = this.get(id);
    if (type.revision) return type;
    const copy = { ...type, revision: 1 };
    this.store.put(boardTypeCollection, copy);
    return copy;
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
      if (!this.get(id).revision)
        throw new InterlockError('Built-in board types cannot be deleted');
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
