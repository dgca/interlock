import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { MemoryNote } from '@interlock/core';
import { Anchor } from '../../design-system';
import { paths } from '../../routes/paths';
import styles from './Memory.module.css';

const time = (value: string) => (
  <time dateTime={value}>{new Date(value).toLocaleString()}</time>
);

/** Author, revision, source run and time for one note. */
export function NoteMeta({
  note,
  scope,
  saved = false,
}: {
  note: Pick<
    MemoryNote,
    'status' | 'revision' | 'author' | 'source' | 'updatedAt' | 'workflowId'
  >;
  scope?: string;
  /** A history entry: the time the revision was saved. */
  saved?: boolean;
}) {
  const author = note.author === 'agent' ? 'Agent' : 'Person';
  return (
    <p className={styles.meta}>
      {scope && <>{scope} · </>}
      {note.status === 'pending'
        ? author
        : `Revision ${note.revision} · ${author}`}
      {note.source && (
        <>
          {' · '}
          <Anchor
            component={Link}
            to={paths.run(note.source.runId, {
              workflowId: note.workflowId,
              executionId: note.source.executionId,
            })}
            underline="hover"
            inherit
          >
            Run {note.source.runId.slice(0, 8)}
          </Anchor>
        </>
      )}
      {' · '}
      {saved ? 'Saved ' : note.status === 'pending' ? 'Written ' : 'Updated '}
      {time(note.updatedAt)}
    </p>
  );
}

/** One memory note: its Markdown text, details and actions. */
export function MemoryNoteCard({
  content,
  meta,
  actions,
}: {
  content: string;
  meta: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className={styles.note}>
      <p className={styles.body}>{content}</p>
      <div className={styles.footer}>
        {meta}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </li>
  );
}
