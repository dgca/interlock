import { z } from 'zod';
import type { Workflow } from './index.js';
import type { SavedPrompt } from './prompts.js';

export const workflowCatalogQuerySchema = z
  .object({
    id: z.string().min(1).optional(),
    boardId: z.string().min(1).optional(),
    ownerWorkflowId: z.string().min(1).optional(),
  })
  .strict();

export type WorkflowCatalogQuery = z.infer<typeof workflowCatalogQuerySchema>;

export type WorkflowCatalogEntry = Pick<
  Workflow,
  | 'id'
  | 'name'
  | 'description'
  | 'archived'
  | 'boardId'
  | 'ownerWorkflowId'
  | 'latestVersion'
> & {
  nodeCount: number;
  stepCount: number;
};

export function workflowCatalogEntry(workflow: Workflow): WorkflowCatalogEntry {
  const {
    id,
    name,
    description,
    archived,
    boardId,
    ownerWorkflowId,
    latestVersion,
    draft,
  } = workflow;
  return {
    id,
    name,
    description,
    archived,
    boardId,
    ownerWorkflowId: ownerWorkflowId ?? null,
    latestVersion,
    nodeCount: draft.nodes.length,
    stepCount: draft.nodes.filter(
      ({ kind }) => kind !== 'entry' && kind !== 'exit',
    ).length,
  };
}

export type PromptCatalogEntry = Omit<SavedPrompt, 'content'>;

export function promptCatalogEntry({
  id,
  name,
  description,
  revision,
  createdAt,
  updatedAt,
}: SavedPrompt): PromptCatalogEntry {
  return { id, name, description, revision, createdAt, updatedAt };
}
