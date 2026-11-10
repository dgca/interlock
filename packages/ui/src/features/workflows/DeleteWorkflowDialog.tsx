import { Button, Modal, ModalBody, ModalFooter } from '../../design-system';

import { useRef, useState } from 'react';

import { Link } from 'react-router';
import { paths } from '../../routes/paths';
import type { Workflow } from '@interlock/core';

import { api } from '../../lib/api';
import type { Action } from '../../lib/useActionFeedback';
import { useQueryClient } from '../../lib/query';
import { forgetWorkflowLayout } from './useWorkflowLayout';

export function DeleteWorkflowDialog({
  workflow,
  onClose,
  hasChildren = false,
  returnFocusTo,
  onDeleted,
  act,
}: {
  workflow: Pick<Workflow, 'id' | 'name'>;
  onClose: () => void;
  hasChildren?: boolean;
  returnFocusTo?: () => HTMLElement | null;
  onDeleted: () => void;
  act: Action;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const remove = async () => {
    if (inFlight.current || hasChildren) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await act(
        async () => {
          await api.workflows.delete.mutate({ id: workflow.id });
          forgetWorkflowLayout(queryClient, workflow.id);
          onDeleted();
        },
        'Workflow permanently deleted.',
        setError,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={hasChildren ? 'Workflow has child workflows' : 'Delete workflow?'}
      returnFocusTo={returnFocusTo}
      busy={busy}
      onClose={() => {
        if (!inFlight.current) onClose();
      }}
    >
      <ModalBody>
        {hasChildren ? (
          <p>
            Remove the child workflows before deleting{' '}
            <strong>{workflow.name}</strong>.
          </p>
        ) : (
          <>
            <p>
              Permanently delete <strong>{workflow.name}</strong>?
            </p>
            <p>
              This removes its draft, published versions, and run history,
              including child runs. This cannot be undone.
            </p>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button disabled={busy} onClick={onClose}>
          {hasChildren ? 'Close' : 'Cancel'}
        </Button>
        {hasChildren ? (
          <Button
            variant="primary"
            component={Link}
            to={paths.workflow(workflow.id) + '?view=children'}
            onClick={onClose}
          >
            View child workflows
          </Button>
        ) : (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
