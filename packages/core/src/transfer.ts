import { eventConfigSchema } from './eventTriggers.js';
import { scheduleConfigSchema } from './workflowTriggers.js';
import { z } from 'zod';
import { definitionSchema } from './index.js';
import { savedPromptSchema, promptIds, samePromptContent } from './prompts.js';
import { deletedVersionSchema } from './versionCleanup.js';
import { variableRequirementSchema, variableReferences } from './variables.js';
import { modelAliasRequirementSchema } from './modelAliases.js';
import { boardSuggestionSchema, workflowStageId } from './workflowBoards.js';

export const workflowBundleSchema = z
  .object({
    format: z.literal('interlock-workflows'),
    formatVersion: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
      z.literal(9),
      z.literal(10),
      z.literal(11),
    ]),
    variables: z.array(variableRequirementSchema).max(4096).optional(),
    prompts: z.array(savedPromptSchema).optional(),
    promptRevisions: z.array(savedPromptSchema).optional(),
    modelAliases: z.array(modelAliasRequirementSchema).max(4096).optional(),
    rootId: z.string().min(1),
    workflows: z
      .array(
        z.preprocess(
          (value, ctx) => {
            if (
              value &&
              typeof value === 'object' &&
              Object.hasOwn(value, 'webhooks')
            )
              ctx.addIssue({
                code: 'custom',
                path: ['webhooks'],
                message: 'Webhook configurations are no longer supported',
              });
            return value;
          },
          z.object({
            id: z.string().min(1),
            name: z.string().trim().min(1).max(120),
            description: z.string(),
            ownerWorkflowId: z.string().nullable(),
            boardSuggestion: boardSuggestionSchema.optional(),
            schedules: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    config: scheduleConfigSchema,
                    enabled: z.boolean().default(false),
                  })
                  .strict(),
              )
              .optional(),
            eventTriggers: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    config: eventConfigSchema,
                    enabled: z.boolean().default(false),
                  })
                  .strict(),
              )
              .max(4096)
              .optional(),
            draft: definitionSchema,
            draftRevision: z.number().int().positive(),
            deletedVersions: z.array(deletedVersionSchema).optional(),
            versions: z.array(
              z.object({
                version: z.number().int().positive(),
                definition: definitionSchema,
                pinnedPromptRevisions: z
                  .record(z.string(), z.number().int().positive())
                  .optional(),
              }),
            ),
          }),
        ),
      )
      .min(1),
  })
  .superRefine((bundle, ctx) => {
    for (const workflow of bundle.workflows) {
      const nodes = [
        workflow.draft,
        ...workflow.versions.map((version) => version.definition),
      ].flatMap((definition) => definition.nodes);
      if (
        bundle.formatVersion < 11 &&
        (workflow.boardSuggestion || nodes.some((node) => node.stageId))
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Portable board stages require bundle formatVersion 11',
        });
      if (workflow.boardSuggestion) {
        const authored = new Set(nodes.map(workflowStageId));
        if (
          workflow.boardSuggestion.stages.some(
            (stage) => !authored.has(stage.id),
          )
        )
          ctx.addIssue({
            code: 'custom',
            message: 'Board suggestion references an unknown workflow stage',
          });
      }
    }
    if (
      bundle.formatVersion < 10 &&
      bundle.modelAliases?.some((alias) => alias.reference)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Authored model alias identities require bundle formatVersion 10',
      });
    for (const workflow of bundle.workflows)
      for (const version of workflow.versions) {
        const references = promptIds(version.definition);
        const pins = Object.keys(version.pinnedPromptRevisions ?? {});
        if (
          pins.some((id) => !references.includes(id)) ||
          (version.definition.pinPromptsAtPublish &&
            references.some((id) => !pins.includes(id)))
        )
          ctx.addIssue({
            code: 'custom',
            message:
              'Published prompt pin map must match its referenced prompts',
          });
      }
    const revisions = bundle.promptRevisions ?? [];
    const pinned = new Set(
      bundle.workflows.flatMap((workflow) =>
        workflow.versions.flatMap((version) =>
          Object.entries(version.pinnedPromptRevisions ?? {}).map(
            ([id, revision]) => `${id}:${revision}`,
          ),
        ),
      ),
    );
    if (revisions.length && bundle.formatVersion < 9)
      ctx.addIssue({
        code: 'custom',
        message: 'Pinned prompt snapshots require bundle formatVersion 9',
      });
    const keys = revisions.map((prompt) => `${prompt.id}:${prompt.revision}`);
    if (
      revisions.some((snapshot) => {
        const current = bundle.prompts?.find(
          (prompt) =>
            prompt.id === snapshot.id && prompt.revision === snapshot.revision,
        );
        return current && !samePromptContent(current, snapshot);
      })
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Conflicting pinned prompt snapshot content',
      });
    if (
      new Set(keys).size !== keys.length ||
      revisions.some(
        (prompt) =>
          !pinned.has(`${prompt.id}:${prompt.revision}`) ||
          !bundle.prompts?.some((current) => current.id === prompt.id),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Pinned prompt snapshots must have unique referenced identities and revisions',
      });
    if (bundle.formatVersion >= 9) {
      const supplied = new Set([
        ...keys,
        ...(bundle.prompts ?? []).map(
          (prompt) => `${prompt.id}:${prompt.revision}`,
        ),
      ]);
      if ([...pinned].some((key) => !supplied.has(key)))
        ctx.addIssue({
          code: 'custom',
          message: 'Bundle is missing a pinned prompt revision snapshot',
        });
    }
    if (
      bundle.formatVersion < 8 &&
      bundle.workflows.some((w) => w.eventTriggers?.length)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Event triggers require bundle formatVersion 8',
      });
    const workflowIds = new Set(bundle.workflows.map((w) => w.id));
    for (const workflow of bundle.workflows)
      for (const trigger of workflow.eventTriggers ?? [])
        if (
          trigger.config.scope.type === 'workflow' &&
          !workflowIds.has(trigger.config.scope.workflowId)
        )
          ctx.addIssue({
            code: 'custom',
            message:
              'Event trigger source workflow must be included in the bundle',
          });

    if (bundle.formatVersion < 6 && bundle.modelAliases?.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Model aliases require bundle formatVersion 6',
      });
    if (
      bundle.formatVersion < 5 &&
      bundle.workflows.some((w) => w.schedules?.length)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Schedules require bundle formatVersion 5',
      });
    const references = new Set(
      bundle.workflows.flatMap((w) => [
        ...[w.draft, ...w.versions.map((v) => v.definition)].flatMap(
          variableReferences,
        ),
      ]),
    );
    const required = new Set((bundle.variables ?? []).map((v) => v.id));
    if (
      required.size !== (bundle.variables?.length ?? 0) ||
      [...references].some((id) => !required.has(id)) ||
      [...required].some((id) => !references.has(id)) ||
      ((required.size || references.size) && bundle.formatVersion < 4)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Variables require formatVersion 4 and one safe requirement for every referenced identity',
      });
    if (
      bundle.formatVersion < 3 &&
      bundle.workflows.some((w) => w.deletedVersions?.length)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Deleted version identities require bundle formatVersion 3',
      });
    if (
      bundle.formatVersion === 1 &&
      (bundle.prompts?.length ||
        bundle.workflows.some((w) =>
          [w.draft, ...w.versions.map((v) => v.definition)].some(
            (d) => promptIds(d).length,
          ),
        ))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Saved prompts require bundle formatVersion 2',
      });
  });
export type WorkflowBundle = z.infer<typeof workflowBundleSchema>;
