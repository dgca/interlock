import { useLayoutEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { AppContext } from '../App';
import { useBeforeUnloadWarning } from './useBeforeUnloadWarning';

/** Protect one route's draft and its in-flight write through the workspace guard. */
export function useEditorDraft(dirty: boolean, warnOnUnload = dirty) {
  const setGuard = useOutletContext<AppContext | null>()?.onEditorGuard;
  const active = useRef(false);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  useBeforeUnloadWarning(warnOnUnload || busy);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      setGuard?.(undefined);
    };
  }, [setGuard]);
  useLayoutEffect(() => {
    if (!saving.current) setGuard?.(dirty ? 'dirty' : undefined);
  }, [dirty, setGuard]);

  const beginSave = () => {
    if (saving.current) return false;
    saving.current = true;
    setGuard?.('saving');
    setBusy(true);
    return true;
  };

  const finishSave = (saved: boolean) => {
    if (!active.current) return false;
    saving.current = false;
    // Clear synchronously so navigation following an acknowledged save is allowed.
    setGuard?.(!saved && dirty ? 'dirty' : undefined);
    setBusy(false);
    return true;
  };

  return { busy, beginSave, finishSave };
}
