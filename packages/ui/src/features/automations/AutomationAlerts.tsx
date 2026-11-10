import { Alert, Button, Group, Text } from '../../design-system';

import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { api, errorMessage } from '../../lib/api';
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
  const [page, setPage] =
    useState<Awaited<ReturnType<typeof api.triggers.attention.query>>>();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void api.triggers.attention
      .query({ workflowId, offset })
      .then((result) => {
        if (current) {
          if (offset > 0 && offset >= result.total) {
            setOffset(Math.max(0, Math.floor((result.total - 1) / 20) * 20));
            return;
          }
          setPage(result);
          setError('');
          onCount?.(result.total);
        }
      })
      .catch((e) => {
        if (current) setError(errorMessage(e));
      });
    return () => {
      current = false;
    };
  }, [workflowId, offset, onCount, tick]);
  if (error)
    return (
      <Text role="alert" c="red">
        Could not load automation alerts. {error}
      </Text>
    );
  if (!page?.total) return null;
  return (
    <section aria-label="Automation alerts">
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
