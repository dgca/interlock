import { useId, useRef, useState } from 'react';
import {
  memoryLimits,
  type MemoryHistory,
  type MemoryNote,
} from '@interlock/core';
import {
  Button,
  LoadingSkeleton,
  Modal,
  ModalBody,
  ModalFooter,
  Select,
  Textarea,
} from '../../design-system';
import { DiscardChangesDialog } from '../../components/DiscardChangesDialog';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import { api, errorMessage } from '../../lib/api';
import { trpc, useQuery } from '../../lib/query';
import { NoteMeta } from './MemoryNoteCard';
import styles from './Memory.module.css';

export type ScopeOption = { value: string; label: string };
export const workflowScope = 'workflow';

const titles = {
  add: ['Add note', 'Add note'],
  edit: ['Edit note', 'Save note'],
  approve: ['Edit and approve note', 'Save and approve'],
} as const;

/** Adds a live note, edits one, or edits a pending note before approving it. */
export function NoteDialog({
  mode,
  workflowId,
  note,
  scopes,
  onClose,
  onSaved,
  onLoadLatest,
}: {
  mode: keyof typeof titles;
  workflowId: string;
  note?: MemoryNote;
  scopes: ScopeOption[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onLoadLatest?: () => Promise<MemoryNote | undefined>;
}) {
  const formId = useId();
  const [base, setBase] = useState(note);
  const [content, setContent] = useState(note?.content ?? '');
  const [scope, setScope] = useState(workflowScope);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'close' | 'reload'>();
  const inFlight = useRef(false);
  const dirty =
    content !== (base?.content ?? '') ||
    (mode === 'add' && scope !== workflowScope);
  const length = content.trim().length;
  const tooLong = length > memoryLimits.noteCharacters;
  const conflict = /changed elsewhere/.test(error);
  const close = () => {
    if (busy) return;
    if (dirty) setConfirm('close');
    else onClose();
  };
  const reload = async () => {
    setConfirm(undefined);
    try {
      const latest = await onLoadLatest?.();
      if (!latest) throw new Error('This note no longer exists.');
      setBase(latest);
      setContent(latest.content);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const submit = async () => {
    if (inFlight.current || !length || tooLong) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      if (mode === 'add')
        await api.memory.manage.mutate({
          action: 'add',
          workflowId,
          ...(scope === workflowScope ? {} : { nodeId: scope }),
          content,
        });
      else
        await api.memory.manage.mutate({
          action: mode,
          noteId: base!.id,
          revision: base!.revision,
          content,
        });
      onSaved(
        mode === 'approve'
          ? 'Note approved'
          : mode === 'add'
            ? 'Note added'
            : 'Note saved',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <Modal
        title={titles[mode][0]}
        busy={busy}
        covered={Boolean(confirm)}
        size={640}
        onClose={close}
      >
        <ModalBody>
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {mode === 'add' && (
              <Select
                mb="md"
                label="Scope"
                allowDeselect={false}
                value={scope}
                disabled={busy}
                data={scopes}
                onChange={(value) => setScope(value ?? workflowScope)}
              />
            )}
            <Textarea
              label="Note"
              description="Markdown. Later runs read it as reference information, not as instructions."
              autosize
              minRows={6}
              maxRows={16}
              required
              value={content}
              disabled={busy}
              error={
                tooLong
                  ? `Shorten the note to ${memoryLimits.noteCharacters.toLocaleString()} characters.`
                  : undefined
              }
              onChange={(event) => setContent(event.currentTarget.value)}
              data-autofocus
            />
            <p className={styles.fieldMeta}>
              {length.toLocaleString()} /{' '}
              {memoryLimits.noteCharacters.toLocaleString()} characters
            </p>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
          </form>
        </ModalBody>
        <ModalFooter
          aside={
            conflict && onLoadLatest ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => (dirty ? setConfirm('reload') : void reload())}
              >
                Load latest
              </Button>
            ) : undefined
          }
        >
          <Button type="button" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={
              busy ||
              !length ||
              tooLong ||
              (mode !== 'add' && !dirty && mode !== 'approve')
            }
          >
            {titles[mode][1]}
          </Button>
        </ModalFooter>
      </Modal>
      {confirm && (
        <DiscardChangesDialog
          onKeepEditing={() => setConfirm(undefined)}
          onDiscard={() => (confirm === 'close' ? onClose() : void reload())}
        />
      )}
    </>
  );
}

/** Revision history for one note, with revert to an earlier revision. */
export function NoteHistoryDialog({
  note,
  onClose,
  onReverted,
}: {
  note: MemoryNote;
  onClose: () => void;
  onReverted: (message: string) => void;
}) {
  const query = useQuery(
    trpc.memory.read.queryOptions({
      action: 'history',
      noteId: note.id,
      limit: 50,
    }),
  );
  const history = query.data as MemoryHistory | undefined;
  const current = history?.note ?? note;
  const [busy, setBusy] = useState<number>();
  const [error, setError] = useState('');
  const revert = async (to: number) => {
    if (busy !== undefined) return;
    setBusy(to);
    setError('');
    try {
      await api.memory.manage.mutate({
        action: 'revert',
        noteId: note.id,
        revision: current.revision,
        to,
      });
      await query.refetch();
      onReverted(`Note reverted to revision ${to}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Modal
      title="Note history"
      busy={busy !== undefined}
      size={680}
      onClose={onClose}
    >
      <ModalBody>
        <WorkspaceReadWarning
          inline
          reads={[workspaceRead('note history', query)]}
        />
        {!history ? (
          !query.error && <LoadingSkeleton label="Loading note history…" />
        ) : (
          <ol className={styles.revisions} aria-label="Revisions, newest first">
            {history.items.map((revision) => (
              <li key={revision.id} className={styles.revision}>
                <NoteMeta
                  saved
                  note={{
                    ...revision,
                    status: 'live',
                    updatedAt: revision.createdAt,
                    workflowId: current.workflowId,
                  }}
                  scope={
                    revision.revision === current.revision
                      ? 'Current'
                      : revision.revertedFrom
                        ? `Reverted to revision ${revision.revertedFrom}`
                        : undefined
                  }
                />
                <p className={styles.body}>{revision.content}</p>
                {revision.revision !== current.revision &&
                  current.status === 'live' && (
                    <div>
                      <Button
                        disabled={busy !== undefined}
                        onClick={() => void revert(revision.revision)}
                      >
                        Revert to revision {revision.revision}
                      </Button>
                    </div>
                  )}
              </li>
            ))}
          </ol>
        )}
        {history && history.total > history.items.length && (
          <p className={styles.hint}>
            Showing the newest {history.items.length} of {history.total}{' '}
            revisions.
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button disabled={busy !== undefined} onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** Confirms deleting a note, or rejecting one that waits for review. */
export function RemoveNoteDialog({
  note,
  onClose,
  onRemoved,
}: {
  note: MemoryNote;
  onClose: () => void;
  onRemoved: (message: string) => void;
}) {
  const reject = note.status === 'pending';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.memory.manage.mutate({
        action: reject ? 'reject' : 'delete',
        noteId: note.id,
      });
      onRemoved(reject ? 'Note rejected' : 'Note deleted');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={reject ? 'Reject this note?' : 'Delete this note?'}
      busy={busy}
      onClose={() => !busy && onClose()}
    >
      <ModalBody>
        <p className={styles.hint}>
          {reject
            ? 'The note is removed and later runs never receive it.'
            : 'The note and its revision history are removed. Runs that already started keep their copy.'}
        </p>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <Button disabled={busy} onClick={onClose} data-autofocus>
          Cancel
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void remove()}>
          {reject ? 'Reject note' : 'Delete note'}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
