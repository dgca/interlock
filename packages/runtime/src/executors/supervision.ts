import type {
  ExecutorAnswer,
  ExecutorProfile,
  ManagedExecution,
  ModelUsage,
  WorkRequest,
} from '@interlock/core';

export const attemptsCollection = 'managedExecutions',
  sessionsCollection = 'executorSessions';
export const now = () => new Date().toISOString();
export const active = (r: ManagedExecution) =>
  ['starting', 'running', 'needs_human'].includes(r.state);
export interface Session {
  id: string;
  runId: string;
  profile: ExecutorProfile;
  permissionSource?: ManagedExecution['permissionSource'];
  modelSource?: ManagedExecution['modelSource'];
  effortSource?: ManagedExecution['effortSource'];
  command: string;
  cwd: string;
  nativeId?: string;
  sessionName?: string;
  resumeCommand?: string;
  deepLink?: string;
  requestedModel?: string;
  recoveryRequestedEffort?: ExecutorProfile['effort'];
  usage?: ModelUsage[];
  usageUncertain?: boolean;
}
export interface Job {
  record: ManagedExecution;
  work: WorkRequest;
  sessionKey: string;
  abort: AbortController;
  answers: Map<
    string,
    {
      resolve: (answer: ExecutorAnswer) => void;
      reject: (error: Error) => void;
    }
  >;
  sendMessage?: (message: string) => Promise<void>;
  done?: Promise<void>;
}
