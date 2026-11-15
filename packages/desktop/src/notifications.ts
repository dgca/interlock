import type { Engine } from '@interlock/runtime';
import type { Store } from '@interlock/storage';
import { createClient } from '@interlock/client';

export interface AttentionTarget {
  kind: string;
  runId: string;
  executionId?: string;
  requestId?: string;
}

export interface AttentionRequestItem {
  target: AttentionTarget;
  cardId?: string;
  label?: string;
  reason?: string;
  title?: string;
}

export interface FailedRunItem {
  id: string;
  title?: string;
  error?: string;
}

export interface AttentionSnapshot {
  attentionRequests: AttentionRequestItem[];
  failedRuns: FailedRunItem[];
}

export interface NotificationItem {
  title: string;
  body: string;
  runId: string;
  kind: 'attention' | 'failed';
}

export interface AttentionTrackerOptions {
  snapshotProvider: () => Promise<AttentionSnapshot> | AttentionSnapshot;
  setDockBadge: (badge: string) => void;
  isWindowFocused: () => boolean;
  notify: (item: NotificationItem) => void;
  onNavigateToRun?: (runId: string) => void;
}

export function getAttentionRequestKey(req: AttentionRequestItem): string {
  const kind = req.target.kind ?? '';
  const runId = req.target.runId ?? '';
  const executionId = req.target.executionId ?? '';
  const requestId = req.target.requestId ?? '';
  return `${kind}:${runId}:${executionId}:${requestId}`;
}

export function createOwnedSnapshot(
  engine?: Engine,
  store?: Store,
): AttentionSnapshot {
  const requests: AttentionRequestItem[] = [];
  if (engine?.requests?.current) {
    const rawRequests = engine.requests.current();
    for (const req of rawRequests) {
      const target = req.target as {
        kind?: unknown;
        runId?: unknown;
        executionId?: unknown;
        requestId?: unknown;
      };
      requests.push({
        target: {
          kind: typeof target.kind === 'string' ? target.kind : '',
          runId: typeof target.runId === 'string' ? target.runId : '',
          executionId:
            typeof target.executionId === 'string'
              ? target.executionId
              : undefined,
          requestId:
            typeof target.requestId === 'string' ? target.requestId : undefined,
        },
        cardId: req.cardId,
        label: req.label,
        reason: req.reason,
      });
    }
  }

  const failedRuns: FailedRunItem[] = [];
  if (store) {
    try {
      const runs = store.runs();
      for (const run of runs) {
        if (run.status === 'failed') {
          failedRuns.push({
            id: run.id,
            title: run.title ?? run.workflowName,
            error: run.error,
          });
        }
      }
    } catch {
      // ignore query error
    }
  }

  return { attentionRequests: requests, failedRuns };
}

export function createAttachedSnapshotProvider(
  engineUrl: string,
  token?: string,
): () => Promise<AttentionSnapshot> {
  const client = createClient(engineUrl, { token });
  return async () => {
    try {
      const [requestList, runs] = await Promise.all([
        client.requests.list.query({ limit: 100, offset: 0 }),
        client.runs.list.query(),
      ]);
      const attentionRequests: AttentionRequestItem[] = requestList.items.map(
        (req) => {
          const target = req.target as {
            kind?: unknown;
            runId?: unknown;
            executionId?: unknown;
            requestId?: unknown;
          };
          return {
            target: {
              kind: typeof target.kind === 'string' ? target.kind : '',
              runId: typeof target.runId === 'string' ? target.runId : '',
              executionId:
                typeof target.executionId === 'string'
                  ? target.executionId
                  : undefined,
              requestId:
                typeof target.requestId === 'string'
                  ? target.requestId
                  : undefined,
            },
            cardId: req.cardId,
            label: req.label,
            reason: req.reason,
          };
        },
      );
      const failedRuns: FailedRunItem[] = [];
      for (const run of runs) {
        if (run.status === 'failed') {
          failedRuns.push({
            id: run.id,
            title: run.title ?? run.workflowName,
            error: run.error,
          });
        }
      }
      return { attentionRequests, failedRuns };
    } catch {
      return { attentionRequests: [], failedRuns: [] };
    }
  };
}

export class AttentionNotificationTracker {
  private initialized = false;
  private seenRequestKeys = new Set<string>();
  private seenFailedRunIds = new Set<string>();
  private pollTimer?: NodeJS.Timeout;

  constructor(private readonly options: AttentionTrackerOptions) {}

  isInitialized(): boolean {
    return this.initialized;
  }

  reset(): void {
    this.initialized = false;
    this.seenRequestKeys.clear();
    this.seenFailedRunIds.clear();
  }

  start(intervalMs = 2000): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      void this.evaluate();
    }, intervalMs);
    this.pollTimer.unref();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  handleClick(runId: string): void {
    this.options.onNavigateToRun?.(runId);
  }

  async evaluate(providedSnapshot?: AttentionSnapshot): Promise<void> {
    const snapshot =
      providedSnapshot ?? (await this.options.snapshotProvider());

    const uniqueAttentionRuns = new Set<string>();
    for (const req of snapshot.attentionRequests) {
      const runId = req.cardId || req.target.runId;
      if (runId) {
        uniqueAttentionRuns.add(runId);
      }
    }

    const badgeCount = uniqueAttentionRuns.size;
    this.options.setDockBadge(badgeCount > 0 ? String(badgeCount) : '');

    if (!this.initialized) {
      for (const req of snapshot.attentionRequests) {
        this.seenRequestKeys.add(getAttentionRequestKey(req));
      }
      for (const run of snapshot.failedRuns) {
        this.seenFailedRunIds.add(run.id);
      }
      this.initialized = true;
      return;
    }

    const focused = this.options.isWindowFocused();

    for (const req of snapshot.attentionRequests) {
      const key = getAttentionRequestKey(req);
      if (!this.seenRequestKeys.has(key)) {
        this.seenRequestKeys.add(key);
        if (!focused) {
          const runId = req.target.runId || req.cardId || '';
          const title = req.title ?? 'Run Requires Attention';
          const detail = req.label ?? req.reason;
          const body = detail
            ? `Run ${runId}: ${detail}`
            : `Run ${runId} is waiting for user action.`;
          this.options.notify({
            title,
            body,
            runId,
            kind: 'attention',
          });
        }
      }
    }

    for (const run of snapshot.failedRuns) {
      if (!this.seenFailedRunIds.has(run.id)) {
        this.seenFailedRunIds.add(run.id);
        if (!focused) {
          const title = run.title ? `Run Failed: ${run.title}` : 'Run Failed';
          const body = run.error
            ? `Run ${run.id}: ${run.error}`
            : `Run ${run.id} failed.`;
          this.options.notify({
            title,
            body,
            runId: run.id,
            kind: 'failed',
          });
        }
      }
    }
  }
}
