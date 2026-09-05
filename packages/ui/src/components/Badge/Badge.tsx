import { Badge as MantineBadge } from '@mantine/core';

const statusColors: Record<string, string> = {
  completed: 'blue',
  published: 'blue',
  running: 'blue',
  claimed: 'blue',
  waiting: 'yellow',
  available: 'yellow',
  failed: 'red',
  cancelled: 'gray',
};
export function Badge({ status }: { status: string }) {
  return (
    <MantineBadge
      color={statusColors[status] ?? 'gray'}
      variant="light"
      size="sm"
      tt="none"
      fw={500}
    >
      {status.replaceAll('_', ' ')}
    </MantineBadge>
  );
}
