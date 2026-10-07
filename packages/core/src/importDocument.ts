import { z } from 'zod';
import {
  blankDefinition,
  definitionSchema,
  InterlockError,
  promptIds,
  validateDefinition,
  validateWorkflowReferences,
  type Workflow,
} from './index.js';
import { workflowBundleSchema } from './transfer.js';

const legacySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().default(''),
  definition: definitionSchema.default(blankDefinition),
  ownerWorkflowId: z.null().optional(),
});
export type ImportDocument =
  | { format: 'portable'; bundle: z.infer<typeof workflowBundleSchema> }
  | { format: 'legacy'; workflow: z.infer<typeof legacySchema> };

/** Remote files must carry their own dependencies; local draft-save rules stay unchanged. */
export function parseImportDocument(data: unknown): ImportDocument {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new InterlockError('Expected a workflow object');
  if ('format' in data) {
    const bundle = workflowBundleSchema.parse(data);
    const records = new Map(bundle.workflows.map((w) => [w.id, w]));
    if (records.size !== bundle.workflows.length || !records.has(bundle.rootId))
      throw new InterlockError(
        'Bundle must include its root and unique workflow IDs',
      );
    const prompts = new Set((bundle.prompts ?? []).map((p) => p.id));
    if (prompts.size !== (bundle.prompts ?? []).length)
      throw new InterlockError('Bundle must contain unique prompt IDs');
    const workflows = bundle.workflows.map((w) => ({
      ...w,
      latestVersion: w.versions.length,
      archived: false,
      createdAt: '',
      updatedAt: '',
    })) satisfies Workflow[];
    for (const w of bundle.workflows) {
      if (w.ownerWorkflowId) {
        const owner = records.get(w.ownerWorkflowId);
        if (!owner || owner.ownerWorkflowId || owner.id === w.id)
          throw new InterlockError(
            `Missing or invalid owner ${w.ownerWorkflowId} for ${w.id}`,
          );
      }
      w.versions.forEach((v, i) => {
        if (v.version !== i + 1)
          throw new InterlockError(
            `Versions for ${w.id} must start at 1 and be consecutive`,
          );
        validateDefinition(v.definition);
      });
      for (const d of [w.draft, ...w.versions.map((v) => v.definition)]) {
        validateWorkflowReferences(w.id, d, workflows);
        for (const id of promptIds(d))
          if (!prompts.has(id))
            throw new InterlockError(`Bundle is missing saved prompt ${id}`);
        for (const node of d.nodes) {
          if (node.kind !== 'workflow') continue;
          const target = records.get(node.workflowId);
          if (!target)
            throw new InterlockError(
              `Bundle is missing workflow ${node.workflowId}`,
            );
          if (
            node.version !== null &&
            !target.versions.some((v) => v.version === node.version)
          )
            throw new InterlockError(
              `Bundle is missing published dependency ${node.workflowId}:${node.version}`,
            );
          if (d !== w.draft && node.version === null)
            throw new InterlockError(
              `Published dependency ${node.workflowId} requires a version pin`,
            );
        }
      }
    }
    return { format: 'portable', bundle };
  }
  if (!('name' in data)) throw new InterlockError('Not a workflow document');
  return { format: 'legacy', workflow: legacySchema.parse(data) };
}
export function importDocumentMetadata(document: ImportDocument) {
  if (document.format === 'legacy')
    return {
      format: document.format,
      rootId: null,
      name: document.workflow.name,
      description: document.workflow.description,
      versions: [] as number[],
      workflows: [] as {
        id: string;
        name: string;
        ownerWorkflowId: string | null;
        versions: number[];
      }[],
      prompts: [] as { id: string; name: string }[],
    };
  const b = document.bundle,
    root = b.workflows.find((w) => w.id === b.rootId)!;
  return {
    format: document.format,
    rootId: root.id,
    name: root.name,
    description: root.description,
    versions: root.versions.map((v) => v.version),
    workflows: b.workflows
      .filter((w) => w.id !== b.rootId)
      .map((w) => ({
        id: w.id,
        name: w.name,
        ownerWorkflowId: w.ownerWorkflowId,
        versions: w.versions.map((v) => v.version),
      })),
    prompts: (b.prompts ?? []).map((p) => ({ id: p.id, name: p.name })),
  };
}
