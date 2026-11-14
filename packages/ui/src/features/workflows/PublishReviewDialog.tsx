import {
  LoadingSkeleton,
  Modal,
  ModalBody,
  ModalFooter,
  Button,
} from '../../design-system';

import { useEffect, useState } from 'react';
import type { WorkflowDefinition, WorkflowVersion } from '@interlock/core';

import { api, errorMessage } from '../../lib/api';
import { compareWorkflow } from './workflowDiff';
import { WorkflowDiffList } from './WorkflowDiffList';
import styles from './PublishReviewDialog.module.css';

export function PublishReviewDialog({
  workflowId,
  latestVersion,
  draft,
  pending,
  publicationCheck,
  editorChanged,
  onClose,
  onPublish,
}: {
  workflowId: string;
  latestVersion: number;
  draft: WorkflowDefinition;
  pending: boolean;
  publicationCheck?: { checking: boolean; error: string; onCheck: () => void };
  editorChanged: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  const [versions, setVersions] = useState<WorkflowVersion[]>();
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const unconfirmed = Boolean(publicationCheck);
  useEffect(() => {
    if (unconfirmed) return;
    let active = true;
    setVersions(undefined);
    setError('');
    api.workflows.versions
      .query({ id: workflowId })
      .then((result) => {
        if (active) setVersions(result);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [workflowId, latestVersion, request, unconfirmed]);

  const baseline = versions?.at(-1);
  const stale = Boolean(versions && (baseline?.version ?? 0) !== latestVersion);
  const diff =
    versions &&
    !stale &&
    !editorChanged &&
    compareWorkflow(draft, baseline?.definition);
  const count = diff
    ? diff.nodes.length + diff.routes.length + diff.workflow.length
    : 0;
  const busy = pending || Boolean(publicationCheck?.checking);

  return (
    <Modal
      title="Review publication"
      size={780}
      busy={busy}
      onClose={() => !busy && onClose()}
    >
      <ModalBody>
        <div className={styles.body}>
          {publicationCheck ? (
            <>
              <p role="status">
                Interlock could not confirm publication. Check the saved version
                before publishing again.
              </p>
              {publicationCheck.error && (
                <p role="alert" className={styles.error}>
                  {publicationCheck.error}
                </p>
              )}
            </>
          ) : (
            <>
              <p className={styles.baseline}>
                {latestVersion
                  ? `Draft compared with published v${latestVersion}`
                  : 'First publication · no published version yet'}
              </p>
              {!versions && !error && (
                <LoadingSkeleton label="Loading published version…" />
              )}
              {error && (
                <div role="alert" className={styles.error}>
                  Could not load published versions: {error}
                  <Button onClick={() => setRequest((value) => value + 1)}>
                    Retry
                  </Button>
                </div>
              )}
              {(stale || editorChanged) && (
                <p role="alert" className={styles.error}>
                  This workflow changed since the review opened. Close it and
                  review the current draft before publishing.
                </p>
              )}
              {diff && (
                <>
                  <WorkflowDiffList
                    diff={diff}
                    before="Published"
                    after="Draft"
                  >
                    {count === 0 && (
                      <p className={styles.empty}>
                        No definition changes. Publishing still creates a new
                        version.
                      </p>
                    )}
                  </WorkflowDiffList>
                </>
              )}
            </>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {publicationCheck ? (
          <Button
            variant="primary"
            loading={publicationCheck.checking}
            onClick={publicationCheck.onCheck}
          >
            Check published version
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!diff || pending}
            onClick={onPublish}
          >
            {pending ? 'Publishing…' : 'Publish version'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
