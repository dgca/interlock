import type { Run } from '@interlock/core';

/** The memory revision and notes a run captured at startup, in run inspection. */
export function CapturedMemory({
  run,
  className,
}: {
  run: Pick<Run, 'memoryCapture'>;
  className?: string;
}) {
  const capture = run.memoryCapture;
  if (!capture) return null;
  const count = capture.notes.length;
  return (
    <details className={className}>
      <summary>
        Captured memory · revision {capture.revision} · {count}{' '}
        {count === 1 ? 'note' : 'notes'}
      </summary>
      {capture.notes.map((note) => (
        <details key={note.id}>
          <summary>
            {note.nodeId ? `Step ${note.nodeId}` : 'Workflow'} note ·{' '}
            {note.id.slice(0, 8)} · revision {note.revision}
          </summary>
          <p className="assignment-prompt">{note.content}</p>
        </details>
      ))}
    </details>
  );
}
