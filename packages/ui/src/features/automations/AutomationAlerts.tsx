import { Alert, Button, Group, Text } from '../../design-system';

import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { errorMessage } from '../../lib/api';
import { trpc, useQuery, useRefreshOnTick } from '../../lib/query';
import { paths } from '../../routes/paths';

export function AutomationAlerts({
  workflowId,
  tick,
  onCount,
}: {
  workflowId?: string;
  tick: number;
  onCount?: (count: number) => void;
}) {
  const [offset, setOffset] = useState(0);
  const result = useQuery(
    trpc.triggers.attention.queryOptions({ workflowId, offset }),
  );
  useRefreshOnTick(tick, result.refetch, true, result.isFetching);
  const page = result.data;
  const error = result.error ? errorMessage(result.error) : '';
  useEffect(() => {
    if (!page) return;
    if (offset > 0 && offset >= page.total) {
      setOffset(Math.max(0, Math.floor((page.total - 1) / 20) * 20));
      return;
    }
    onCount?.(page.total);
  }, [page, offset, onCount]);
  if (error && !page?.total)
    return (
      <Text role="alert" c="red">
        Could not load automation alerts. {error}
      </Text>
    );
  if (!page?.total) return null;
  return (
    <section aria-label="Automation alerts">
      {error && (
        <Text role="alert" c="red">
          Could not refresh automation alerts. {error}
        </Text>
      )}
      <Text fw={600} size="sm" mb="sm">
        Automation alerts · {page.total}
      </Text>
      {page.items.map((item) => (
        <Alert
          key={item.triggerId}
          color={item.kind === 'automatic_pause' ? 'red' : 'yellow'}
          mb="md"
          title={item.name}
        >
          <Text size="sm">{item.reason}</Text>
          <Link to={paths.workflowSchedule(item.workflowId, item.triggerId)}>
            Inspect automation
          </Link>
        </Alert>
      ))}
      <Group>
        {offset > 0 && (
          <Button
            variant="ghost"
            onClick={() => setOffset((n) => Math.max(0, n - 20))}
          >
            Previous automation alerts
          </Button>
        )}
        {page.nextOffset !== null && (
          <Button variant="ghost" onClick={() => setOffset(page.nextOffset!)}>
            More automation alerts
          </Button>
        )}
      </Group>
    </section>
  );
}
