import {
  Button,
  LoadingSkeleton,
  Modal,
  ModalBody,
  ModalFooter,
} from '../../design-system';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';

import { useRef, useState } from 'react';

import { Link } from 'react-router';
import { paths } from '../../routes/paths';
import type { Workflow } from '@interlock/core';

import { api } from '../../lib/api';
import type { Action } from '../../lib/useActionFeedback';
import { trpc, useQuery, useQueryClient } from '../../lib/query';
import { forgetWorkflowLayout } from './useWorkflowLayout';

export function DeleteWorkflowDialog({
  workflow,
  onClose,
  returnFocusTo,
  onDeleted,
  act,
}: {
  workflow: Pick<Workflow, 'id' | 'name'>;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
  onDeleted: () => void;
  act: Action;
}) {
  const queryClient = useQueryClient();
  const children = useQuery(
    trpc.workflows.catalog.queryOptions(
      { ownerWorkflowId: workflow.id },
      { meta: { engineRefresh: false } },
    ),
  );
  const [busy, setBusy] = useState(false);
  const checked = busy || (children.isSuccess && !children.isFetching);
  const hasChildren = !busy && checked && Boolean(children.data?.length);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const remove = async () => {
    if (inFlight.current || !checked || hasChildren) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await act(
        async () => {
          await api.workflows.delete.mutate({ id: workflow.id });
          forgetWorkflowLayout(queryClient, workflow.id);
          queryClient.removeQueries(
            trpc.workflows.get.queryFilter({ id: workflow.id }),
          );
          const catalog = trpc.workflows.catalog.queryKey();
          void queryClient.cancelQueries({ queryKey: catalog, exact: true });
          queryClient.setQueryData(catalog, (items) =>
            items?.filter((item) => item.id !== workflow.id),
          );
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
        {!checked ? (
          children.error ? (
            <WorkspaceReadWarning
              reads={[workspaceRead('child workflows', children)]}
              inline
            />
          ) : (
            <LoadingSkeleton label="Checking for child workflows…" />
          )
        ) : hasChildren ? (
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
        ) : checked ? (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </Button>
        ) : null}
      </ModalFooter>
    </Modal>
  );
}
