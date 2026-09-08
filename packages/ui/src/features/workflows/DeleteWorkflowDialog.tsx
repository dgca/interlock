import { useRef, useState } from 'react';
import type { Workflow } from '@interlock/core';
import { Modal } from '../../components/Modal/Modal';
import { Button } from '../../components/Button/Button';
import { api, errorMessage } from '../../lib/api';
import type { Action } from '../../lib/useActionFeedback';

export function DeleteWorkflowDialog({
  workflow,
  onClose,
  onDeleted,
  act,
}: {
  workflow: Pick<Workflow, 'id' | 'name'>;
  onClose: () => void;
  onDeleted: () => void;
  act: Action;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const remove = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await act(async () => {
        try {
          await api.workflows.delete.mutate({ id: workflow.id });
        } catch (error) {
          setError(errorMessage(error));
          throw error;
        }
        onDeleted();
      }, 'Workflow permanently deleted.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Delete workflow?"
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
    >
      <p>
        Permanently delete <strong>{workflow.name}</strong>?
      </p>
      <p>
        This removes its draft, published versions, and run history, including
        child runs. This cannot be undone.
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="actions">
        <Button disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void remove()}>
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </Modal>
  );
}
