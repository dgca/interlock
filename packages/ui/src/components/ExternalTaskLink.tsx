import type { ExternalTask } from '@interlock/core';
import { ArrowUpRight } from 'lucide-react';
import { Anchor } from '../design-system';

export function ExternalTaskLink({
  task,
  withArrow = false,
}: {
  task?: ExternalTask;
  withArrow?: boolean;
}) {
  if (!task?.url) return null;
  return (
    <Anchor href={task.url} target="_blank" rel="noreferrer" size="sm">
      {task.system} {task.id}
      {withArrow && <ArrowUpRight size={14} aria-hidden="true" />}
    </Anchor>
  );
}
