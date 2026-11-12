import type { ExternalTask } from '@interlock/core';
import { ArrowUpRight } from 'lucide-react';
import { Anchor } from '../design-system';

export function ExternalTaskLink({
  task,
  withArrow = false,
  className,
}: {
  task?: ExternalTask;
  withArrow?: boolean;
  className?: string;
}) {
  if (!task?.url) return null;
  return (
    <Anchor
      href={task.url}
      target="_blank"
      rel="noreferrer"
      size="sm"
      className={className}
    >
      {task.system} {task.id}
      {withArrow && <ArrowUpRight size={14} aria-hidden="true" />}
    </Anchor>
  );
}
