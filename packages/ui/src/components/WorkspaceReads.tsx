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

function RetryReads({
  reads,
  children,
}: {
  reads: WorkspaceRead[];
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      loading={reads.every((read) => read.fetching)}
      onClick={() => {
        for (const read of reads) if (!read.fetching) read.retry();
      }}
    >
      {children}
    </Button>
  );
}

export function WorkspaceReadWarning({
  reads,
  inline = false,
}: {
  reads: WorkspaceRead[];
  inline?: boolean;
}) {
  const failed = reads.filter((read) => read.error);
  if (!failed.length) return null;
  const resources = failed.map((read) => read.resource).join(' and ');
  return (
    <Group
      className={inline ? undefined : 'engine-warning'}
      justify="space-between"
      gap="xs"
    >
      <Text size="sm" role="status">
        {failed.every((read) => read.ready)
          ? `Could not refresh ${resources}. Showing the last loaded data.`
          : `Could not load ${resources}.`}
      </Text>
      <RetryReads reads={failed}>Retry {resources}</RetryReads>
    </Group>
  );
}

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
  if (waiting.length) {
    const failed = waiting.filter((read) => read.error);
    if (!failed.length) return loading;
    const failure = (
      <>
        <ActionError
          message={`Could not load ${subject}. ${failed.map((read) => read.error).join(' ')}`}
        />
        <RetryReads reads={failed}>Retry</RetryReads>
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
      <WorkspaceReadWarning reads={reads} />
      {children}
    </>
  );
}
