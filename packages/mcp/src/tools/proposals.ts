import { z } from 'zod';
import type { createMcpClient } from '../client.js';
import type { createProfileServer } from './register.js';

/** Agents propose draft edits; people review them outside MCP. */
export function registerProposalTools(
  tool: ReturnType<typeof createProfileServer>['tool'],
  client: ReturnType<typeof createMcpClient>,
) {
  tool(
    'propose_workflow_change',
    'Propose a draft edit for a person to review; it never changes the workflow. In a claim pass workId and token to link its run and execution and default to its workflow; otherwise pass workflowId. Refused unless the workflow allows agent proposals, the edits stay within its allowed scope, and, without a claim on its runs, it allows that. Identical open proposals return the existing one; open proposals are capped per workflow and run.',
    {
      workflowId: z.string().optional(),
      workId: z.string().optional(),
      token: z.string().optional(),
      title: z.string().max(200),
      rationale: z.string().max(4000),
      edits: z
        .array(z.unknown())
        .min(1)
        .max(100)
        .describe('edit_workflow edits against the current draft'),
      sources: z
        .array(
          z.object({ runId: z.string(), executionId: z.string().optional() }),
        )
        .max(20)
        .optional()
        .describe('Other runs showing the problem'),
    },
    async (input) => {
      const proposal = await client.proposals.create(
        input as Parameters<typeof client.proposals.create>[0],
      );
      return {
        proposalId: proposal.id,
        status: proposal.status,
        baseDraftRevision: proposal.baseDraftRevision,
        deduplicated: 'deduplicated' in proposal,
      };
    },
  );
}
