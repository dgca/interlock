import { z } from 'zod';
import { workflowEditsSchema } from './workflowEdits.js';
import type { DraftDiagnostic } from './draftDiagnostics.js';

/** Defaults that keep a looping agent from flooding a workflow's review queue. */
export const proposalLimits = {
  openPerWorkflow: 20,
  openPerRun: 3,
  sources: 20,
  simulatedCases: 20,
} as const;

const proposalNodeKinds = [
  'entry',
  'exit',
  'agent',
  'script',
  'fetch',
  'input',
  'wait',
  'condition',
  'switch',
  'workflow',
  'batch',
  'parallel',
] as const;

/**
 * Per-workflow proposal policy. People can always propose; agents only when
 * `agents` is on, and only within the node kinds and fields listed (omitted
 * lists allow every kind or field).
 */
export const proposalSettingsSchema = z
  .object({
    agents: z.boolean(),
    nodeKinds: z.array(z.enum(proposalNodeKinds)).max(20).optional(),
    fields: z.array(z.string().min(1).max(100)).max(100).optional(),
    otherWorkflows: z.boolean().optional(),
  })
  .strict();
export type ProposalSettings = z.infer<typeof proposalSettingsSchema>;
export const defaultProposalSettings: ProposalSettings = { agents: false };

const id = z.string().min(1).max(200);
const proposalSourceSchema = z
  .object({ runId: id, executionId: id.optional() })
  .strict();
export type ProposalSource = z.infer<typeof proposalSourceSchema>;

export const proposalCreateSchema = z
  .object({
    workflowId: id.optional(),
    workId: id.optional(),
    token: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(200),
    rationale: z.string().trim().min(1).max(4000),
    edits: workflowEditsSchema.min(1),
    sources: z
      .array(proposalSourceSchema)
      .max(proposalLimits.sources)
      .optional(),
  })
  .strict();
export type ProposalCreate = z.input<typeof proposalCreateSchema>;

export const proposalListSchema = z
  .object({
    workflowId: id.optional(),
    runId: id.optional(),
    status: z.enum(['open', 'approved', 'rejected', 'all']).default('all'),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const proposalDecisionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('approve'),
      id,
      edits: workflowEditsSchema.min(1).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('reject'),
      id,
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z.object({ action: z.literal('reapply'), id }).strict(),
]);
export type ProposalDecision = z.input<typeof proposalDecisionSchema>;

type ProposalStatus = 'open' | 'approved' | 'rejected';
type ProposalAuthor =
  { kind: 'agent'; workerId?: string; workId?: string } | { kind: 'person' };

/** One case's pass/fail against the current draft and with the proposal applied. */
export type ProposalCaseResult = {
  suiteId: string;
  suiteName: string;
  caseId: string;
  caseName: string;
  before: string;
  after: string;
  error?: string;
};
export type ProposalSimulation =
  | {
      state: 'running';
      draftRevision: number;
      startedAt: string;
    }
  | {
      state: 'unavailable';
      draftRevision: number;
      reason: string;
      finishedAt: string;
    }
  | {
      state: 'completed';
      draftRevision: number;
      cases: ProposalCaseResult[];
      omittedCases: number;
      coverage: {
        before: { coveredEdges: number; totalEdges: number };
        after: { coveredEdges: number; totalEdges: number };
      };
      finishedAt: string;
    };

export interface WorkflowProposal {
  id: string;
  workflowId: string;
  title: string;
  rationale: string;
  /** Exactly the operations edit_workflow accepts, against baseDraftRevision. */
  edits: unknown[];
  baseDraftRevision: number;
  author: ProposalAuthor;
  /** The run and execution of the claim that created it, when there was one. */
  runId?: string;
  executionId?: string;
  sources: ProposalSource[];
  status: ProposalStatus;
  /** Canonical edits used to merge identical open proposals. */
  fingerprint: string;
  simulation?: ProposalSimulation;
  decision?: {
    at: string;
    reason?: string;
    edited?: boolean;
    /** The operations applied, when a person edited them before approval. */
    edits?: unknown[];
    draftRevision?: number;
  };
  createdAt: string;
  updatedAt: string;
}

/** Whether the proposal still applies to the current draft. */
export type ProposalConflict =
  | { state: 'current' }
  | { state: 'reapplicable'; draftRevision: number }
  | {
      state: 'conflicting';
      draftRevision: number;
      diagnostics: DraftDiagnostic[];
    };
