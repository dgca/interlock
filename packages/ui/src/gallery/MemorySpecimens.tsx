import { useSearchParams } from 'react-router';
import type { MemoryNote } from '@interlock/core';
import { Button } from '../design-system';
import { CapturedMemory } from '../features/memory/CapturedMemory';
import { NoteDialog } from '../features/memory/MemoryDialogs';
import { MemoryNoteCard, NoteMeta } from '../features/memory/MemoryNoteCard';
import { MemoryViewSkeleton } from '../features/memory/MemoryViewSkeleton';
import styles from '../features/memory/Memory.module.css';
import { Section, Specimen } from './GalleryLayout';

const note = (extra: Partial<MemoryNote>): MemoryNote => ({
  id: '3f2a91c0-0000-4000-8000-000000000000',
  workflowId: 'workflow',
  status: 'live',
  revision: 1,
  content: 'Run tests with `pnpm test --changed`.',
  author: 'person',
  createdAt: '2026-03-02T10:15:00Z',
  updatedAt: '2026-03-02T10:15:00Z',
  ...extra,
});
const pending = note({
  id: '5b4c3d2e-0000-4000-8000-000000000000',
  status: 'pending',
  author: 'agent',
  nodeId: 'implement',
  content:
    'Run tests with `pnpm test --changed`; the full suite exceeds the step timeout.',
  source: { runId: '8c1d2e3f-0000-4000-8000-000000000000', executionId: 'x' },
});
const live = note({ revision: 3 });
const long = note({
  id: '9a8b7c6d-0000-4000-8000-000000000000',
  revision: 2,
  content: [
    'Release checklist conventions reviewers enforce:',
    '',
    '- Changelog entries use the past tense and name the user-visible change.',
    '- Screenshots for UI changes are taken at 1440 and 390 pixels wide.',
    '- Generated files under `packages/ui/dist` are never committed.',
    '',
    'A very long identifier that must wrap instead of widening the card: release-notes-generation-pipeline-configuration-for-the-quarterly-platform-release.',
  ].join('\n'),
});

/** Memory notes, captured memory and the note editor. */
export function Memory() {
  const [params, setParams] = useSearchParams();
  const show = (value: string | null) =>
    setParams(value ? { open: value } : {}, { replace: true });
  return (
    <Section id="memory" title="Memory">
      <Specimen name="MemoryNoteCard" wide>
        <ul className={styles.notes}>
          <MemoryNoteCard
            content={pending.content}
            meta={<NoteMeta note={pending} scope="Step: Implement" />}
            actions={
              <>
                <Button variant="ghost" color="red">
                  Reject
                </Button>
                <Button>Edit and approve</Button>
                <Button variant="primary">Approve</Button>
              </>
            }
          />
          {[live, long].map((item) => (
            <MemoryNoteCard
              key={item.id}
              content={item.content}
              meta={<NoteMeta note={item} />}
              actions={
                <>
                  <Button variant="ghost">History</Button>
                  <Button>Edit</Button>
                  <Button variant="ghost" color="red">
                    Delete
                  </Button>
                </>
              }
            />
          ))}
        </ul>
      </Specimen>
      <Specimen name="CapturedMemory">
        <CapturedMemory
          run={{
            memoryCapture: {
              workflowId: 'workflow',
              revision: 7,
              budget: 8000,
              notes: [live, pending].map(
                ({ id, nodeId, revision, content, updatedAt }) => ({
                  id,
                  ...(nodeId ? { nodeId } : {}),
                  revision,
                  content,
                  updatedAt,
                }),
              ),
            },
          }}
        />
      </Specimen>
      <Specimen name="Note editor">
        <Button onClick={() => show('memory-note')}>Open note editor</Button>
      </Specimen>
      <Specimen name="MemoryViewSkeleton" wide>
        <MemoryViewSkeleton />
      </Specimen>
      {params.get('open') === 'memory-note' && (
        <NoteDialog
          mode="approve"
          workflowId="workflow"
          note={pending}
          scopes={[]}
          onClose={() => show(null)}
          onSaved={() => show(null)}
        />
      )}
    </Section>
  );
}
