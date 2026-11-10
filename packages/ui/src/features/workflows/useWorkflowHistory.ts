import { useReducer } from 'react';
import {
  applyWorkflowPositions,
  withoutWorkflowPositions,
  workflowPositions,
  type WorkflowDefinition,
  type WorkflowPositions,
} from '@interlock/core';

export type EditorSnapshot = {
  draft: WorkflowDefinition;
  name: string;
  description: string;
};
type History = {
  past: EditorSnapshot[];
  present: EditorSnapshot;
  future: EditorSnapshot[];
  groupStart?: EditorSnapshot;
};
type Action =
  | { type: 'change'; update: (current: EditorSnapshot) => EditorSnapshot }
  | { type: 'reset'; snapshot: EditorSnapshot }
  | { type: 'layout'; positions: WorkflowPositions }
  | { type: 'begin' | 'end' | 'undo' | 'redo' };
// API validation can reorder object keys without changing the authored draft.
function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
}
export function serializeSnapshot(snapshot: EditorSnapshot): string {
  return serialize(snapshot);
}
export function serializeContentSnapshot(snapshot: EditorSnapshot): string {
  return serialize({
    ...snapshot,
    draft: withoutWorkflowPositions(snapshot.draft),
  });
}
const equal = (a: EditorSnapshot, b: EditorSnapshot) =>
  serializeSnapshot(a) === serializeSnapshot(b);
const append = (past: EditorSnapshot[], snapshot: EditorSnapshot) =>
  [...past, snapshot].slice(-50);

export function changedPositions(
  before: WorkflowDefinition,
  after: WorkflowDefinition,
): WorkflowPositions {
  const previous = workflowPositions(before);
  return Object.fromEntries(
    after.nodes
      .filter(
        (node) =>
          !Object.hasOwn(previous, node.id) ||
          previous[node.id].x !== node.position.x ||
          previous[node.id].y !== node.position.y,
      )
      .map((node) => [node.id, node.position]),
  );
}

function reduce(history: History, action: Action): History {
  switch (action.type) {
    case 'layout': {
      const present = {
        ...history.present,
        draft: applyWorkflowPositions(history.present.draft, action.positions),
      };
      if (equal(present, history.present)) return history;
      const positions = changedPositions(history.present.draft, present.draft);
      const rebase = (snapshot: EditorSnapshot) => ({
        ...snapshot,
        draft: applyWorkflowPositions(snapshot.draft, positions),
      });
      return {
        ...history,
        present,
        past: history.past.map(rebase),
        future: history.future.map(rebase),
      };
    }
    case 'reset':
      return { past: [], present: action.snapshot, future: [] };
    case 'begin':
      return history.groupStart
        ? history
        : { ...history, groupStart: history.present };
    case 'end': {
      const { groupStart, ...rest } = history;
      if (!groupStart || equal(groupStart, history.present)) return rest;
      return { ...rest, past: append(history.past, groupStart), future: [] };
    }
    case 'change': {
      const present = action.update(history.present);
      if (equal(history.present, present)) return history;
      return history.groupStart
        ? { ...history, present }
        : { past: append(history.past, history.present), present, future: [] };
    }
    case 'undo': {
      if (history.groupStart || !history.past.length) return history;
      return {
        past: history.past.slice(0, -1),
        present: history.past.at(-1)!,
        future: [history.present, ...history.future],
      };
    }
    case 'redo': {
      if (history.groupStart || !history.future.length) return history;
      return {
        past: append(history.past, history.present),
        present: history.future[0],
        future: history.future.slice(1),
      };
    }
  }
}

export function useWorkflowHistory(snapshot: EditorSnapshot) {
  const [history, dispatch] = useReducer(reduce, {
    past: [],
    present: snapshot,
    future: [],
  });
  return {
    ...history,
    change: (update: (current: EditorSnapshot) => EditorSnapshot) =>
      dispatch({ type: 'change', update }),
    reset: (snapshot: EditorSnapshot) => dispatch({ type: 'reset', snapshot }),
    layout: (positions: WorkflowPositions) =>
      dispatch({ type: 'layout', positions }),
    begin: () => dispatch({ type: 'begin' }),
    end: () => dispatch({ type: 'end' }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
  };
}
