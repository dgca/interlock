import { useState } from 'react';
import { useOutletContext } from 'react-router';
import type { AppContext } from '../App';
import { DiscardChangesDialog } from '../components/DiscardChangesDialog';

export function useDraftDismissal(
  dirty: boolean,
  busy: boolean,
  onClose: () => void,
) {
  const navigationBlocked = useOutletContext<AppContext | null>()
    ?.editorNavigationBlocked;
  const [confirming, setConfirming] = useState(false);
  return {
    dismiss: () => {
      if (busy || confirming || navigationBlocked) return;
      if (dirty) setConfirming(true);
      else onClose();
    },
    covered: confirming || navigationBlocked,
    confirmation: confirming && !navigationBlocked && (
      <DiscardChangesDialog
        onKeepEditing={() => setConfirming(false)}
        onDiscard={onClose}
      />
    ),
  };
}
