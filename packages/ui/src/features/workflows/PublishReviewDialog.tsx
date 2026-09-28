import { useEffect, useState } from 'react';
import type { WorkflowDefinition, WorkflowVersion } from '@interlock/core';
import { Modal } from '../../components/Modal/Modal';
import { Button } from '../../components/Button/Button';
import { api, errorMessage } from '../../lib/api';
import {
  compareWorkflow,
  type DiffItem,
  type ValueChange,
} from './workflowDiff';
import styles from './PublishReviewDialog.module.css';

function format(value: unknown): string {
  if (value === undefined) return 'Not set';
  if (typeof value === 'string') return value || '(empty)';
  return JSON.stringify(value, null, 2);
}

function changeCount(count: number, subject: string): string {
  return `${count} ${subject} change${count === 1 ? '' : 's'}`;
}

function Detail({ path, before, after }: ValueChange) {
  return (
    <div className={styles.detail}>
      <div className={styles.path}>{path}</div>
      <div className={styles.values}>
        {before !== undefined && (
          <div>
            <span>Published</span>
            <pre>{format(before)}</pre>
          </div>
        )}
        {after !== undefined && (
          <div>
            <span>Draft</span>
            <pre>{format(after)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function ChangeGroup({ title, items }: { title: string; items: DiffItem[] }) {
  if (!items.length) return null;
  return (
    <section className={styles.group}>
      <h3>
        {title} <span>{items.length}</span>
      </h3>
      {items.map((item) => (
        <details key={item.id} className={styles.item}>
          <summary>
            <span className={`${styles.kind} ${styles[item.kind]}`}>
              {item.kind}
            </span>
            <span>{item.title}</span>
            {item.kind === 'changed' && (
              <small>
                {item.details.map((field) => field.path).join(', ')}
              </small>
            )}
          </summary>
          <div className={styles.details}>
            {item.details.map((detail) => (
              <Detail key={detail.path} {...detail} />
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}

export function PublishReviewDialog({
  workflowId,
  latestVersion,
  draft,
  pending,
  editorChanged,
  onClose,
  onPublish,
}: {
  workflowId: string;
  latestVersion: number;
  draft: WorkflowDefinition;
  pending: boolean;
  editorChanged: boolean;
  onClose: () => void;
  onPublish: () => void;
}) {
  const [versions, setVersions] = useState<WorkflowVersion[]>();
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  useEffect(() => {
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
  }, [workflowId, latestVersion, request]);

  const baseline = versions?.at(-1);
  const stale = Boolean(versions && (baseline?.version ?? 0) !== latestVersion);
  const diff =
    versions &&
    !stale &&
    !editorChanged &&
    compareWorkflow(draft, baseline?.definition);
  const count = diff
    ? diff.nodes.length +
      diff.routes.length +
      diff.workflow.length +
      diff.layout.length
    : 0;

  return (
    <Modal
      title="Review publication"
      size={780}
      className={styles.modal}
      onClose={() => !pending && onClose()}
    >
      <div className={styles.body}>
        <p className={styles.baseline}>
          {latestVersion
            ? `Draft compared with published v${latestVersion}`
            : 'First publication · no published version yet'}
        </p>
        {!versions && !error && <p role="status">Loading published version…</p>}
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
            This workflow changed since the review opened. Close it and review
            the current draft before publishing.
          </p>
        )}
        {diff && (
          <>
            <div className={styles.counts} aria-label="Change summary">
              <span>{changeCount(diff.nodes.length, 'node')}</span>
              <span>{changeCount(diff.routes.length, 'route')}</span>
              <span>{changeCount(diff.workflow.length, 'workflow')}</span>
              {diff.layout.length > 0 && (
                <span>{changeCount(diff.layout.length, 'layout')}</span>
              )}
            </div>
            {count === 0 && (
              <p className={styles.empty}>
                No definition changes. Publishing still creates a new version.
              </p>
            )}
            {diff.firstPublication && (
              <p className={styles.first}>
                This version adds the draft definition.
              </p>
            )}
            <div className={styles.list}>
              <ChangeGroup title="Nodes" items={diff.nodes} />
              <ChangeGroup title="Routes" items={diff.routes} />
              <ChangeGroup
                title="Workflow contracts and settings"
                items={diff.workflow}
              />
              <ChangeGroup title="Layout" items={diff.layout} />
            </div>
          </>
        )}
        <div className={styles.actions}>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!diff || pending}
            onClick={onPublish}
          >
            {pending ? 'Publishing…' : 'Publish version'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
