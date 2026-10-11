import { z } from 'zod';

const owner = z.string().min(1).nullable();
export const ownershipPreviewSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe('Existing workflow ID to adopt, reparent or release.'),
    ownerWorkflowId: owner.describe(
      'Proposed library owner ID, or explicit null to release to the library.',
    ),
  })
  .strict();
export const ownershipChangeSchema = ownershipPreviewSchema.extend({
  expectedOwnerWorkflowId: owner.describe(
    'Current owner from get_workflow or preview_workflow_ownership; explicit null for a library workflow. Stale ownership rejects the change.',
  ),
});
export type OwnershipPreviewInput = z.infer<typeof ownershipPreviewSchema>;
export type OwnershipChangeInput = z.infer<typeof ownershipChangeSchema>;
