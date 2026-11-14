import type { ReactNode } from 'react';
import type { DiffItem, ValueChange, WorkflowDiff } from './workflowDiff';
import styles from './WorkflowDiffList.module.css';

function format(value: unknown): string {
  if (value === undefined) return 'Not set';
  if (typeof value === 'string') return value || '(empty)';
  return JSON.stringify(value, null, 2);
}

function changeCount(count: number, subject: string): string {
  return `${count} ${subject} change${count === 1 ? '' : 's'}`;
}

type Labels = { before: string; after: string };

function Detail({
  path,
  before,
  after,
  labels,
}: ValueChange & { labels: Labels }) {
  return (
    <div className={styles.detail}>
      <div className={styles.path}>{path}</div>
      <div className={styles.values}>
        <div>
          <span>{labels.before}</span>
          <pre>{format(before)}</pre>
        </div>
        <div>
          <span>{labels.after}</span>
          <pre>{format(after)}</pre>
        </div>
      </div>
    </div>
  );
}

function ChangeGroup({
  title,
  items,
  labels,
}: {
  title: string;
  items: DiffItem[];
  labels: Labels;
}) {
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
              <Detail key={detail.path} {...detail} labels={labels} />
            ))}
          </div>
        </details>
      ))}
    </section>
  );
}

/** Node, route and workflow changes between two definitions, as publication review shows them. */
export function WorkflowDiffList({
  diff,
  before,
  after,
  children,
}: {
  diff: WorkflowDiff;
  /** Labels for the compared values, such as Published and Draft. */
  before: string;
  after: string;
  /** Shown between the counts and the changes, such as an empty note. */
  children?: ReactNode;
}) {
  const labels = { before, after };
  return (
    <>
      <div className={styles.counts} aria-label="Change summary">
        <span>{changeCount(diff.nodes.length, 'node')}</span>
        <span>{changeCount(diff.routes.length, 'route')}</span>
        <span>{changeCount(diff.workflow.length, 'workflow')}</span>
      </div>
      {children}
      <div>
        <ChangeGroup title="Nodes" items={diff.nodes} labels={labels} />
        <ChangeGroup title="Routes" items={diff.routes} labels={labels} />
        <ChangeGroup
          title="Workflow contracts and settings"
          items={diff.workflow}
          labels={labels}
        />
      </div>
    </>
  );
}
