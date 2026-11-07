import type { RunAttentionReason } from './runAttention.js';

export interface DesktopNotification {
  runId: string;
  workflowId: string;
  workflowName?: string;
  title: string;
  message: string;
  reasons: RunAttentionReason[];
  occurredAt: string;
}

export type DesktopNotificationSender = (
  notification: DesktopNotification,
) => Promise<unknown> | unknown;
