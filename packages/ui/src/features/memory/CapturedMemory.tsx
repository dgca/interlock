import type { Run } from '@interlock/core';

/** The memory revision a run captured at startup, in run inspection. */
export function CapturedMemory({
  run,
  className,
}: {
  run: Pick<Run, 'memoryCapture'>;
  className?: string;
}) {
  const capture = run.memoryCapture;
  if (!capture) return null;
  return (
    <p className={className}>
      Captured memory · revision {capture.revision} · {capture.noteCount}{' '}
      {capture.noteCount === 1 ? 'note' : 'notes'} ·{' '}
      {capture.budget.toLocaleString()}-character prompt budget
    </p>
  );
}
