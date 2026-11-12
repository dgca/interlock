import type { ReactNode } from 'react';
import {
  ActionError,
  Button,
  Group,
  PageHeader,
  Text,
  workspacePage,
} from '../design-system';

export type WorkspaceRead = {
  resource: 'workflows' | 'prompts';
  ready: boolean;
  error: string;
  fetching: boolean;
  retry: () => void;
};

export function WorkspaceReads({
  reads,
  subject,
  loading,
  title,
  children,
}: {
  reads: WorkspaceRead[];
  subject: string;
  loading: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  const waiting = reads.filter((read) => !read.ready);
  const failed = (waiting.length ? waiting : reads).filter(
    (read) => read.error,
  );
  const retrying = failed.every((read) => read.fetching);
  const retry = () => {
    for (const read of failed) if (!read.fetching) read.retry();
  };
  const resources = failed.map((read) => read.resource).join(' and ');

  if (waiting.length) {
    if (!failed.length) return loading;
    const failure = (
      <>
        <ActionError
          message={`Could not load ${subject}. ${failed.map((read) => read.error).join(' ')}`}
        />
        <Button variant="secondary" loading={retrying} onClick={retry}>
          Retry
        </Button>
      </>
    );
    return title ? (
      <section className={workspacePage.page}>
        <PageHeader title={title} />
        <div className={workspacePage.content}>{failure}</div>
      </section>
    ) : (
      <div className="content-page">{failure}</div>
    );
  }

  return (
    <>
      {failed.length > 0 && (
        <Group className="engine-warning" justify="space-between" gap="xs">
          <Text size="sm" role="status">
            Could not refresh {resources}. Showing the last loaded data.
          </Text>
          <Button variant="secondary" loading={retrying} onClick={retry}>
            Retry {resources}
          </Button>
        </Group>
      )}
      {children}
    </>
  );
}
