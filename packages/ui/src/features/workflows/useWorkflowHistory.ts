import { useReducer } from 'react';
import type { WorkflowDefinition } from '@interlock/core';

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
  | { type: 'begin' | 'end' | 'undo' | 'redo' };
const equal = (a: EditorSnapshot, b: EditorSnapshot) =>
  JSON.stringify(a) === JSON.stringify(b);
const append = (past: EditorSnapshot[], snapshot: EditorSnapshot) =>
  [...past, snapshot].slice(-50);

function reduce(history: History, action: Action): History {
  switch (action.type) {
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
    begin: () => dispatch({ type: 'begin' }),
    end: () => dispatch({ type: 'end' }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
  };
}
