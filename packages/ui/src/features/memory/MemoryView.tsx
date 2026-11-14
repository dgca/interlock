import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { MemoryListing, MemoryNote, Workflow } from '@interlock/core';
import { Alert, Button, PageToolbar, workspacePage } from '../../design-system';
import {
  WorkspaceReadWarning,
  workspaceRead,
} from '../../components/WorkspaceReads';
import { api } from '../../lib/api';
import type { Action } from '../../lib/useActionFeedback';
import { trpc, useQuery } from '../../lib/query';
import { MemoryNoteCard, NoteMeta } from './MemoryNoteCard';
import {
  NoteDialog,
  NoteHistoryDialog,
  RemoveNoteDialog,
  workflowScope,
  type ScopeOption,
} from './MemoryDialogs';
import { MemoryViewSkeleton } from './MemoryViewSkeleton';
import styles from './Memory.module.css';

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit' | 'approve' | 'history' | 'remove'; note: MemoryNote };

const newestFirst = (a: MemoryNote, b: MemoryNote) =>
  b.updatedAt.localeCompare(a.updatedAt);

/** The workflow's Memory section: review queue, workflow notes and step notes. */
export function MemoryView({
  workflow,
  act,
}: {
  workflow: Pick<Workflow, 'id' | 'draft'>;
  act: Action;
}) {
  const query = useQuery(
    trpc.memory.read.queryOptions({ action: 'list', workflowId: workflow.id }),
  );
  const [dialog, setDialog] = useState<Dialog>();
  const [approving, setApproving] = useState<string>();
  const data = query.data as MemoryListing | undefined;
  if (!data && !query.error) return <MemoryViewSkeleton />;
  const notes = [...(data?.notes ?? [])].sort(newestFirst);
  const agents = workflow.draft.nodes.filter((node) => node.kind === 'agent');
  const labels = new Map(agents.map((node) => [node.id, node.label]));
  const scopeLabel = (note: MemoryNote) =>
    note.nodeId
      ? `Step: ${labels.get(note.nodeId) ?? note.nodeId}`
      : 'Workflow';
  const pending = notes.filter((note) => note.status === 'pending');
  const live = notes.filter((note) => note.status === 'live');
  const removed = live.filter(
    (note) => note.nodeId && !labels.has(note.nodeId),
  );
  const scopes: ScopeOption[] = [
    { value: workflowScope, label: 'Workflow (every Agent step)' },
    ...agents.map((node) => ({ value: node.id, label: `Step: ${node.label}` })),
  ];
  const settings = data?.settings;
  const done = (message: string) => {
    setDialog(undefined);
    void act(() => query.refetch(), message);
  };
  const approve = (note: MemoryNote) => {
    if (approving) return;
    setApproving(note.id);
    void act(
      () =>
        api.memory.manage
          .mutate({
            action: 'approve',
            noteId: note.id,
            revision: note.revision,
          })
          .then(() => query.refetch()),
      'Note approved',
    ).finally(() => setApproving(undefined));
  };
  const liveActions = (note: MemoryNote) => (
    <>
      <Button
        variant="ghost"
        onClick={() => setDialog({ kind: 'history', note })}
      >
        History
      </Button>
      <Button onClick={() => setDialog({ kind: 'edit', note })}>Edit</Button>
      <Button
        variant="ghost"
        color="red"
        onClick={() => setDialog({ kind: 'remove', note })}
      >
        Delete
      </Button>
    </>
  );
  const list = (items: MemoryNote[], empty: string, scoped = false) =>
    items.length ? (
      <ul className={styles.notes}>
        {items.map((note) => (
          <MemoryNoteCard
            key={note.id}
            content={note.content}
            meta={
              <NoteMeta
                note={note}
                scope={scoped ? scopeLabel(note) : undefined}
              />
            }
            actions={liveActions(note)}
          />
        ))}
      </ul>
    ) : (
      <p className={styles.hint}>{empty}</p>
    );
  const section = (title: ReactNode, children: ReactNode) => (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
  return (
    <div className={workspacePage.page}>
      <PageToolbar
        summary={
          settings &&
          `Memory revision ${settings.revision} · ${live.length} live ${live.length === 1 ? 'note' : 'notes'}${settings.enabled ? ` · Agent notes ${settings.agentWrites === 'live' ? 'go live immediately' : 'wait for review'}` : ''}`
        }
      >
        <Button
          variant="primary"
          leftSection={<Plus size={14} aria-hidden="true" />}
          disabled={!data}
          onClick={() => setDialog({ kind: 'add' })}
        >
          Add note
        </Button>
      </PageToolbar>
      <div className={workspacePage.content}>
        <div className={styles.content}>
          <WorkspaceReadWarning
            inline
            reads={[workspaceRead('memory', query)]}
          />
          {settings && !settings.enabled && (
            <Alert title="Memory is off">
              Runs don&apos;t receive these notes and agents can&apos;t save new
              ones. Turn on Use memory in the workflow&apos;s Settings.
            </Alert>
          )}
          {pending.length > 0 &&
            section(
              <>
                Waiting for review
                <span className={styles.count}>{pending.length}</span>
              </>,
              <ul className={styles.notes}>
                {pending.map((note) => (
                  <MemoryNoteCard
                    key={note.id}
                    content={note.content}
                    meta={<NoteMeta note={note} scope={scopeLabel(note)} />}
                    actions={
                      <>
                        <Button
                          variant="ghost"
                          color="red"
                          disabled={Boolean(approving)}
                          onClick={() => setDialog({ kind: 'remove', note })}
                        >
                          Reject
                        </Button>
                        <Button
                          disabled={Boolean(approving)}
                          onClick={() => setDialog({ kind: 'approve', note })}
                        >
                          Edit and approve
                        </Button>
                        <Button
                          variant="primary"
                          disabled={Boolean(approving)}
                          onClick={() => approve(note)}
                        >
                          Approve
                        </Button>
                      </>
                    }
                  />
                ))}
              </ul>,
            )}
          {section(
            'Workflow notes',
            list(
              live.filter((note) => !note.nodeId),
              'No workflow notes. Every Agent step receives these.',
            ),
          )}
          {section(
            'Step notes',
            agents.length ? (
              agents.map((node) => (
                <div key={node.id} className={styles.section}>
                  <h3>{node.label}</h3>
                  {list(
                    live.filter((note) => note.nodeId === node.id),
                    'No notes for this step.',
                  )}
                </div>
              ))
            ) : (
              <p className={styles.hint}>This workflow has no Agent steps.</p>
            ),
          )}
          {removed.length > 0 &&
            section(
              'Removed steps',
              list(removed, 'No notes for removed steps.', true),
            )}
        </div>
      </div>
      {(dialog?.kind === 'add' ||
        dialog?.kind === 'edit' ||
        dialog?.kind === 'approve') && (
        <NoteDialog
          mode={dialog.kind}
          workflowId={workflow.id}
          note={dialog.kind === 'add' ? undefined : dialog.note}
          scopes={scopes}
          onClose={() => setDialog(undefined)}
          onSaved={done}
          onLoadLatest={async () => {
            const latest = (await query.refetch()).data as
              MemoryListing | undefined;
            return dialog.kind === 'add'
              ? undefined
              : latest?.notes.find((note) => note.id === dialog.note.id);
          }}
        />
      )}
      {dialog?.kind === 'history' && (
        <NoteHistoryDialog
          note={dialog.note}
          onClose={() => {
            setDialog(undefined);
            void query.refetch();
          }}
          onReverted={(message) => void act(() => query.refetch(), message)}
        />
      )}
      {dialog?.kind === 'remove' && (
        <RemoveNoteDialog
          note={dialog.note}
          onClose={() => setDialog(undefined)}
          onRemoved={done}
        />
      )}
    </div>
  );
}
