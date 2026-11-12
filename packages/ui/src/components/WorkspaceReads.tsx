import type { ReactNode, RefObject } from 'react';
import { errorMessage } from '../lib/api';
import {
  ActionError,
  Button,
  Group,
  PageHeader,
  Text,
  workspacePage,
} from '../design-system';

export type WorkspaceRead = {
  resource: string;
  ready: boolean;
  error: string;
  fetching: boolean;
  retry: () => void;
};

export function workspaceRead(
  resource: string,
  query: {
    data: unknown;
    error: unknown;
    isFetching: boolean;
    refetch: (options: {
      cancelRefetch: false;
    }) => Promise<{ isSuccess: boolean }>;
  },
  focusAfterRetry?: RefObject<HTMLElement | null>,
): WorkspaceRead {
  return {
    resource,
    ready: query.data !== undefined,
    error: query.error ? errorMessage(query.error) : '',
    fetching: query.isFetching,
    retry: () => {
      const trigger = document.activeElement;
      void query.refetch({ cancelRefetch: false }).then(({ isSuccess }) => {
        if (
          isSuccess &&
          trigger instanceof HTMLButtonElement &&
          (document.activeElement === trigger ||
            (!trigger.isConnected && document.activeElement === document.body))
        )
          focusAfterRetry?.current?.focus();
      });
    },
  };
}

function RetryReads({
  reads,
  children,
}: {
  reads: WorkspaceRead[];
  children: ReactNode;
}) {
  const pending = reads.every((read) => read.fetching);
  return (
    <Button
      type="button"
      variant="secondary"
      aria-disabled={pending || undefined}
      data-disabled={pending || undefined}
      aria-busy={pending || undefined}
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
  showDetails = false,
}: {
  reads: WorkspaceRead[];
  inline?: boolean;
  showDetails?: boolean;
}) {
  const failed = reads.filter((read) => read.error);
  if (!failed.length) return null;
  const resources = failed.map((read) => read.resource).join(' and ');
  const stale = failed.every((read) => read.ready);
  const summary = stale
    ? `Could not refresh ${resources}. Showing the last loaded data.`
    : `Could not load ${resources}.`;
  const message = showDetails
    ? `${summary} ${failed.map((read) => read.error).join(' ')}`
    : summary;
  return (
    <Group
      className={inline ? undefined : 'engine-warning'}
      justify="space-between"
      gap="xs"
      mb={showDetails ? 'md' : undefined}
    >
      {showDetails && !stale ? (
        <ActionError message={message} />
      ) : (
        <Text size="sm" role="status" style={{ overflowWrap: 'anywhere' }}>
          {message}
        </Text>
      )}
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
