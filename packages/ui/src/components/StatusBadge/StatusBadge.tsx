import { Badge } from '../../design-system';

const statusColors: Record<string, string> = {
  completed: 'green',
  passed: 'green',
  published: 'green',
  running: 'blue',
  claimed: 'blue',
  waiting: 'yellow',
  queued: 'yellow',
  available: 'yellow',
  failed: 'red',
  unsupported: 'yellow',
  cancelled: 'gray',
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      component="span"
      color={statusColors[status] ?? 'gray'}
      variant="light"
    >
      {status.replaceAll('_', ' ')}
    </Badge>
  );
}
