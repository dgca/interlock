import {
  assignmentSizeQuerySchema,
  measureAssignment,
  composePrompt,
  resolveBindingFields,
  assertContract,
  InterlockError,
  type AssignmentSizeQuery,
  type SizePart,
  type WorkRequest,
  type Workflow,
  type Json,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import type { Prompts } from './prompts.js';
const known = (value: unknown): SizePart => ({ state: 'known', value });
const unknown: SizePart = { state: 'unknown' };
const absent: SizePart = { state: 'absent' };

export class AssignmentSizes {
  constructor(
    private store: Store,
    private prompts: Prompts,
    private describe: (work: WorkRequest) => WorkRequest,
  ) {}
  read(input: AssignmentSizeQuery) {
    const q = assignmentSizeQuerySchema.parse(input);
    if (q.workId) {
      if (q.workflowId || q.nodeId || q.version || q.sample)
        throw new InterlockError(
          'Choose workId alone, or workflowId and nodeId for a preview',
        );
      const stored = this.store.get<WorkRequest>('work', q.workId);
      if (!stored) throw new InterlockError('Work not found');
      const work = this.describe(stored);
      return {
        source: 'assignment' as const,
        workId: work.id,
        runId: work.runId,
        ...measureAssignment(
          {
            ...(work.trialEnvironment
              ? { trialEnvironment: known(work.trialEnvironment) }
              : {}),
            prompt: known(work.prompt),
            context: known(work.context),
            input: known(work.input),
            outputSchema: known(work.outputSchema),
            ...(work.resultRules
              ? { resultRules: known(work.resultRules) }
              : {}),
            executionInstructions: work.executionInstructions
              ? known(work.executionInstructions)
              : absent,
            savedPrompts: work.savedPrompts ? known(work.savedPrompts) : absent,
          },
          q.warningBytes,
        ),
        unresolved: { items: [], total: 0, truncated: false },
        inputValidation: 'captured' as const,
      };
    }
    if (!q.workflowId || !q.nodeId)
      throw new InterlockError('Provide workId or workflowId and nodeId');
    const workflow = this.store.get<Workflow>('workflows', q.workflowId);
    if (!workflow) throw new InterlockError('Workflow not found');
    const definition = q.version
      ? this.store.getVersion(q.workflowId, q.version)?.definition
      : workflow.draft;
    if (!definition) throw new InterlockError('Workflow version not found');
    const node = definition.nodes.find((n) => n.id === q.nodeId);
    if (node?.kind !== 'agent')
      throw new InterlockError('Size previews require an Agent node');
    const unresolved: { field: string; reason: string }[] = [];
    const add = (field: string, reason: string) =>
      unresolved.push({ field: field.slice(0, 256), reason });
    const captured = (node.promptIds ?? []).flatMap((id) => {
      try {
        return [this.prompts.get(id)];
      } catch {
        add('prompt', 'saved_prompt_missing');
        return [];
      }
    });
    const promptKnown = captured.length === (node.promptIds ?? []).length;
    const snapshots = captured.map(
      ({ id, name, revision, description, content }) => ({
        id,
        name,
        revision,
        description,
        content,
      }),
    );
    let resolved: Json | undefined = q.sample?.input;
    if (node.inputBindings) {
      const fields: [string, Json][] = [];
      for (const [field, binding] of Object.entries(node.inputBindings)) {
        let reason:
          | 'item_scope_required'
          | 'invalid_node_scope'
          | 'source_not_supplied'
          | 'path_unresolved' = 'path_unresolved';
        try {
          const value = resolveBindingFields({ [field]: binding }, (leaf) => {
            if (leaf.source === 'itemInput' && !node.batchId) {
              reason = 'item_scope_required';
              throw new Error(reason);
            }
            if (leaf.source === 'node') {
              const source = definition.nodes.find((n) => n.id === leaf.nodeId);
              if (
                !source ||
                source.batchId !== node.batchId ||
                source.kind === 'entry' ||
                source.kind === 'exit'
              ) {
                reason = 'invalid_node_scope';
                throw new Error(reason);
              }
            }
            const source =
              leaf.source === 'node'
                ? q.sample?.outputs &&
                  Object.hasOwn(q.sample.outputs, leaf.nodeId)
                  ? q.sample.outputs[leaf.nodeId]
                  : undefined
                : q.sample?.[leaf.source];
            if (source === undefined) {
              reason = 'source_not_supplied';
              throw new Error(reason);
            }
            return source;
          });
          fields.push([field, value[field]]);
        } catch {
          add(field, reason);
        }
      }
      resolved =
        fields.length === Object.keys(node.inputBindings).length
          ? Object.fromEntries(fields)
          : undefined;
    }
    if (
      resolved === undefined &&
      !unresolved.some((item) => item.field !== 'prompt')
    )
      add('input', 'source_not_supplied');
    if (node.context.mode === 'fresh')
      add('executionInstructions', 'run_and_work_ids_not_allocated');
    let inputValidation: 'valid' | 'invalid' | 'unknown' = 'unknown';
    if (resolved !== undefined) {
      try {
        assertContract(node.inputSchema, resolved, 'Preview');
        inputValidation = 'valid';
      } catch {
        inputValidation = 'invalid';
      }
    }
    const report = measureAssignment(
      {
        prompt: promptKnown
          ? known(composePrompt(node.prompt, snapshots))
          : unknown,
        context: known(node.context),
        input: resolved === undefined ? unknown : known(resolved),
        outputSchema: known(node.outputSchema),
        ...(node.resultRules ? { resultRules: known(node.resultRules) } : {}),
        executionInstructions: node.context.mode === 'fresh' ? unknown : absent,
        savedPrompts: !promptKnown
          ? unknown
          : snapshots.length
            ? known(snapshots)
            : absent,
      },
      q.warningBytes,
    );
    return {
      source: 'preview' as const,
      version: q.version ?? null,
      draftRevision: q.version ? null : workflow.draftRevision,
      promptSource: 'current_library' as const,
      ...report,
      warnings: [
        ...report.warnings,
        ...(inputValidation === 'invalid' ? ['invalid_sample_input'] : []),
      ],
      inputValidation,
      unresolved: {
        items: unresolved.slice(0, 20),
        total: unresolved.length,
        truncated: unresolved.length > 20,
      },
    };
  }
}
