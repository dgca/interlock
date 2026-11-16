import type { Json } from './json.js';
import type {
  ContextPolicy,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from './workflowDefinition.js';
import type { RunStatus } from './runQueries.js';
import type { FetchRequest } from './fetch.js';
import type { ExecutionProvenance } from './executionProvenance.js';
export interface Workflow {
  id: string;
  boardId?: string;
  boardStageColumns?: Record<string, string | null>;
  boardSuggestion?: import('./workflowBoards.js').BoardSuggestion;
  ownerWorkflowId?: string | null;
  name: string;
  description: string;
  archived: boolean;
  draft: WorkflowDefinition;
  draftRevision: number;
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
}
export interface WorkflowVersion {
  workflowId: string;
  version: number;
  definition: WorkflowDefinition;
  pinnedPromptRevisions?: Record<string, number>;
  createdAt: string;
}
export interface NodeExecution {
  id: string;
  /** Published definition used for this visit. Legacy visits use the run's original version. */
  version?: number;
  nodeId: string;
  kind: WorkflowNode['kind'];
  label: string;
  input: Json;
  originalInput?: Json;
  output?: Json;
  /** Raw validated operation result when outputBindings shape the forwarded output. */
  result?: Json;
  status: RunStatus;
  startedAt: string;
  completedAt?: string;
  resources?: string[];
  resourceAttempt?: number;
  resourceActive?: boolean;
  resourceBlocked?: import('./workResources.js').ResourceBlock;
  operationStartedAt?: string;
  error?: string;
  childRunIds: string[];
  nextItem: number;
  /** Script or Wait attempt within a single visit. Omission means the first attempt. */
  attempt?: number;
  retryChildRunIds?: string[];
  request?: FetchRequest;
  background?: import('./backgroundScripts.js').BackgroundScript;
  externalInput?: import('./externalInput.js').ExternalInputMetadata;
  humanInput?: import('./humanInput.js').HumanInputCapture;
  /** Waiting for a person to approve this imported Script content. */
  scriptApproval?: { hash: string; since: string };
  resumeAt?: string;
  /** Polling Wait: when the next check runs, the deadline, and the latest check. */
  nextCheckAt?: string;
  timeoutAt?: string;
  check?: PollCheckResult;
  port?: WorkflowEdge['port'];
  resolvedCwd?: string;
  provenance?: ExecutionProvenance;
  privateNetwork?: import('./fetch.js').PrivateNetworkTarget;
}
export interface PollCheckResult {
  count: number;
  at: string;
  output?: Json;
  error?: string;
}
export interface Run {
  cancellationReason?: string;
  /** join: cancelled because its Parallel join was satisfied; reports skip it. */
  cancellationKind?: 'join';
  versionPolicy?: import('./runVersions.js').RunVersionPolicy;
  versionRevision?: number;
  versionBlocker?: import('./runVersions.js').RunVersionBlocker;
  versionChanges?: import('./runVersions.js').RunVersionChange[];
  /** Trigger identities inherited by all causal descendants and continuations. */
  triggerChain?: string[];
  schedule?: {
    triggerId: string;
    scheduledAt: string;
    waitForPrevious: boolean;
    previousRunIds: string[];
  };
  admission?: import('./runStarts.js').RunAdmission;
  startRequestId?: string;
  title?: string;
  externalTask?: import('./runStarts.js').ExternalTask;
  tags?: import('./runTags.js').RunTags;
  chain?: import('./runChains.js').RunChainLink;
  contextRevision?: number;
  externalInputHold?: import('./externalInput.js').ExternalInputHold;
  budgetRevision?: number;
  comparison?: import('./testbench.js').ComparisonRunContext;
  id: string;
  workflowId: string;
  workflowName: string;
  version: number;
  parentRunId?: string;
  parentMode?: 'detached';
  parentExecutionId?: string;
  // Item runs execute members of this Batch in the same published graph.
  batchNodeId?: string;
  batchItemIndex?: number;
  parallelBranch?: { nodeId: string; id: string; key: string };
  toolCall?: import('./toolEdges.js').ToolCallLink;
  /** Branch node starts charged to this workflow run, including prior visits. */
  parallelSteps?: number;
  /** Attempt reserved for a Script or Wait step by explicit retry. */
  nextScriptAttempt?: number;
  status: RunStatus;
  input: Json;
  output?: Json;
  error?: string;
  cursor: string;
  value: Json;
  executions: NodeExecution[];
  createdAt: string;
  updatedAt: string;
  promptSnapshots?: import('./prompts.js').PromptSnapshot[];
  variableCaptures?: import('./variables.js').VariableCapture[];
  modelAliasCaptures?: import('./modelAliases.js').ModelAliasCapture[];
  memoryCapture?: import('./memory.js').MemoryCapture;
  ignoredWorkflowModelAlias?: string;
  /** Harness inherited from the owning caller; see docs/managed-executors.md. */
  callerExecutor?: string;
}
export type RunSummary = Pick<
  Run,
  | 'id'
  | 'workflowId'
  | 'workflowName'
  | 'version'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'parentRunId'
  | 'parentMode'
  | 'parentExecutionId'
  | 'parallelBranch'
  | 'comparison'
  | 'startRequestId'
  | 'title'
  | 'externalTask'
  | 'tags'
> & {
  executionCount: number;
  parentWorkflowName?: string;
  waitReason?:
    | 'held'
    | 'agent'
    | 'managed'
    | 'claimed'
    | 'external_input'
    | 'external_review'
    | 'timer'
    | 'child';
};
export interface RunAncestry {
  workflowId: string;
  parentRunId?: string;
  parentMode?: 'detached';
  rootRunId: string;
  rootWorkflowId: string;
}
export interface WorkRequest {
  maxExecutionMs?: number;
  claimedAt?: string;
  lastActivityAt?: string;
  availableSince?: string;
  idleRecoveryCount?: number;
  idleNudge?: { attempt: number; activityAt: string; at: string };
  executor?: string;
  executorPermissions?: import('./executors.js').ExecutorPermissionMode;
  executorPermissionsSource?: import('./executors.js').ManagedExecution['permissionSource'];
  modelAliasSelection?: import('./modelAliases.js').ModelAliasSelection;
  executorModel?: string;
  executorModelSource?: 'node' | 'workflow';
  executorEffort?: string | null;
  executorEffortSource?: 'node' | 'workflow';
  executorSource?: 'caller';
  managedExecution?: import('./executors.js').ManagedWorkSummary;
  resources?: string[];
  resourceBlocked?: import('./workResources.js').ResourceBlock;
  resourceReservations?: import('./workResources.js').ResourceOwner[]; // Derived inspection, not stored.
  resolvedCwd?: string;
  cwdBlocked?: { reason: string; path?: string };

  trialEnvironment?: import('./trialEnvironments.js').TrialWorkContext;
  hold?: import('./workHolds.js').WorkHold;
  holdRevision?: number;
  endedAt?: string;
  heldClaimCount?: number;
  // Internal idempotency fingerprint, never exposed to executors.
  holdReceipt?: string;
  // Derived bounded inspection only, not stored with the assignment.
  holdHistory?: import('./workHolds.js').WorkHoldHistory;
  resultRules?: import('./resultRules.js').ResultRule[];
  modelSelection?: import('./modelTiers.js').ModelSelection;
  continuity?: import('./contextContinuity.js').ContextContinuity;
  sessionNameTemplate?: string;
  sessionName?: string;
  resumeCommand?: string;
  deepLink?: string;
  pauseBlocked?: import('./pauseHolds.js').PauseBlock;
  budgetBlocked?: import('./budgets.js').BudgetBlock;
  id: string;
  runId: string;
  executionId: string;
  nodeId: string;
  label: string;
  prompt: string;
  savedPrompts?: import('./prompts.js').PromptSnapshot[];
  executionInstructions?: string;
  input: Json;
  context: ContextPolicy;
  outputSchema: Record<string, unknown>;
  tools?: import('./toolEdges.js').WorkTool[];
  status:
    | 'available'
    | 'held'
    | 'claimed'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'timed_out';
  availableUntil?: string;
  attempt: number;
  maxAttempts: number;
  maxLeaseExpiries?: number;
  failureCount?: number;
  leaseExpiryCount?: number;
  // Internal diagnostic receipts, excluded from external work responses.
  expiredClaims?: { tokenHash: string; expiredAt: string; attempt: number }[];
  workerId?: string;
  token?: string;
  leaseUntil?: string;
  // Optional default captured from the published Agent node.
  leaseSeconds?: number;
  // Duration established by the current claim, reused by omitted renewals.
  claimLeaseSeconds?: number;
  output?: Json;
  error?: string;
  createdAt: string;
}
export interface RunEvent {
  id: string;
  runId: string;
  type: string;
  message: string;
  at: string;
  boardColumnId?: string;
  stage?: string | null;
  waiting?: import('./runProjection.js').RunWaiting | null;
  actor?: import('./runProjection.js').RunProjection['actor'];
}
