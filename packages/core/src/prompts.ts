import { z } from 'zod';
import type { WorkflowDefinition } from './index.js';
import { startRequestIdSchema } from './runStarts.js';

export const promptRevisionConflict =
  'Prompt changed elsewhere. Reload before saving. Your edits have not been saved.';

export const promptContentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe(
      'Nonblank display name, trimmed, up to 120 characters. References use the stable ID; names need not be unique.',
    ),
  description: z
    .string()
    .default('')
    .describe(
      'Optional description for discovering the prompt; defaults to empty.',
    ),
  content: z
    .string()
    .refine((s) => s.trim().length > 0, 'Instructions cannot be blank')
    .describe(
      'Reusable Markdown instructions. Must contain non-whitespace text. Included in full at workflow run startup; does not grant capabilities.',
    ),
});
export const promptCreateSchema = promptContentSchema.extend({
  requestId: startRequestIdSchema
    .optional()
    .describe(
      'Stable key for retrying the same creation after a lost response, up to 120 characters.',
    ),
});
export const savedPromptSchema = promptContentSchema.extend({
  id: z.string().min(1),
  revision: z.number().int().positive(),
});
export type PromptSnapshot = z.infer<typeof savedPromptSchema>;
export type PromptContent = z.infer<typeof promptContentSchema>;
export function samePromptContent(a: PromptContent, b: PromptContent) {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.content === b.content
  );
}
export interface SavedPrompt extends PromptSnapshot {
  createdAt: string;
  updatedAt: string;
}
export interface PromptUsage {
  workflowId: string;
  name: string;
  draft: boolean;
  versions: number[];
}
export const promptReadSchema = z
  .object({
    id: z.string().min(1),
    revision: z.number().int().positive().optional(),
    history: z
      .object({
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(25).default(10),
      })
      .strict()
      .optional(),
  })
  .strict();
export function promptIds(definition: WorkflowDefinition) {
  return [
    ...new Set(
      definition.nodes.flatMap((node) =>
        node.kind === 'agent' ? (node.promptIds ?? []) : [],
      ),
    ),
  ];
}
export function snapshotPrompt(prompt: PromptSnapshot): PromptSnapshot {
  const { id, revision, name, description, content } = prompt;
  return { id, revision, name, description, content };
}
export function composePrompt(task: string, prompts: PromptSnapshot[]) {
  if (!prompts.length) return task;
  return [
    ...prompts.map(
      (prompt) => `## Saved prompt: ${prompt.name}\n\n${prompt.content}`,
    ),
    `## Task instructions\n\n${task}`,
  ].join('\n\n');
}
