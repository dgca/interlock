import { randomUUID } from 'node:crypto';
import { Store } from '@interlock/storage';
import {
  InterlockError,
  variableMutationSchema,
  variableReadSchema,
  variableReferences,
  type SavedVariable,
  type VariableCapture,
  type VariableBinding,
  type VariableKind,
  type VariableRead,
  type VariableMutation,
  type VariableImportBindings,
  type VariableRequirement,
  type WorkflowDefinition,
  type WorkflowComparison,
  type Run,
} from '@interlock/core';

const stamp = () => new Date().toISOString();
const active = (status: string) => status === 'running' || status === 'waiting';
/** The library owns lookup, revision capture, dependency checks, and disclosure. */
export class Variables {
  constructor(private store: Store) {}
  get(id: string): SavedVariable {
    const binding = this.store.get<VariableBinding>('variableBindings', id);
    const value = this.store.get<SavedVariable>(
      'variables',
      binding?.variableId ?? id,
    );
    if (value && binding && value.kind !== binding.kind)
      throw new InterlockError(
        'Variable binding has an incompatible kind. Correct the local binding before use.',
      );
    if (!value)
      throw new InterlockError(
        `Variable ${id} is missing. Provision it or bind its portable reference in Variables.`,
      );
    return value;
  }
  private ready(capture: VariableCapture): string {
    const current = this.store.get<SavedVariable>(
      'variables',
      capture.variableId,
    );
    if (!current)
      throw new InterlockError(
        `Variable ${capture.name} was deleted. Provision it and start a new run.`,
      );
    if (!current.enabled)
      throw new InterlockError(
        `Variable ${current.name} is disabled. Enable it in Variables before retrying.`,
      );
    if (current.kind !== capture.kind)
      throw new InterlockError(
        'Variable kind changed. Start a new run after correcting the reference.',
      );
    return this.store.protectedValues.read(
      capture.variableId,
      capture.kind,
      capture.valueRevision,
    );
  }
  status(variable: SavedVariable): 'ready' | 'unset' | 'disabled' | 'locked' {
    if (!variable.enabled) return 'disabled';
    if (variable.valueRevision === null) return 'unset';
    try {
      this.store.protectedValues.read(
        variable.id,
        variable.kind,
        variable.valueRevision,
      );
      return 'ready';
    } catch {
      return 'locked';
    }
  }
  private metadata(v: SavedVariable) {
    return { ...v, availability: this.status(v) };
  }
  private idsFor(id: string) {
    return new Set([
      id,
      ...this.store
        .list<VariableBinding>('variableBindings')
        .filter((b) => b.variableId === id)
        .map((b) => b.id),
    ]);
  }
  private dependencies(id: string) {
    const ids = this.idsFor(id);
    const workflows = this.store.workflows().flatMap((w) => {
      const draft = variableReferences(w.draft).some((ref) => ids.has(ref));
      const versions = this.store
        .listVersions(w.id)
        .filter((v) =>
          variableReferences(v.definition).some((ref) => ids.has(ref)),
        )
        .map((v) => v.version);
      return draft || versions.length
        ? [{ workflowId: w.id, name: w.name, draft, versions }]
        : [];
    });
    const runs = this.store
      .activeRuns()
      .filter((r) => r.variableCaptures?.some((c) => c.variableId === id))
      .map((r) => r.id);
    const comparisons = this.store
      .list<WorkflowComparison>('comparisons')
      .filter(
        (c) =>
          c.status === 'running' &&
          c.variableCaptures?.some((v) => v.variableId === id),
      )
      .map((c) => c.id);
    return { workflows, runs, comparisons };
  }
  read(input: VariableRead) {
    const parsed = variableReadSchema.safeParse(input);
    if (!parsed.success)
      throw new InterlockError(
        'Invalid variable read. Check the action, identity, and pagination limits.',
      );
    const q = parsed.data;
    if (q.action === 'list') {
      const all = this.store
        .list<SavedVariable>('variables')
        .filter(
          (v) =>
            !q.search ||
            `${v.name} ${v.description}`
              .toLowerCase()
              .includes(q.search.toLowerCase()),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        items: all
          .slice(q.offset, q.offset + q.limit)
          .map((v) => this.metadata(v)),
        total: all.length,
        offset: q.offset,
        limit: q.limit,
        truncated: q.offset + q.limit < all.length,
      };
    }
    const variable = this.get(q.id);
    if (q.action === 'config_value') {
      if (variable.kind === 'secret')
        throw new InterlockError(
          'Secret values cannot be read back. Use Replace value in Variables.',
        );
      if (variable.valueRevision === null)
        throw new InterlockError(
          'Variable has no value. Set a value in Variables.',
        );
      return {
        id: variable.id,
        value: this.store.protectedValues.read(
          variable.id,
          variable.kind,
          variable.valueRevision,
        ),
      };
    }
    const deps = this.dependencies(variable.id);
    const bindings = this.store
      .list<VariableBinding>('variableBindings')
      .filter((b) => b.variableId === variable.id);
    return {
      ...this.metadata(variable),
      referenceId: q.id,
      storage: this.store.protectedValues.info(),
      dependencies: {
        items: deps.workflows.slice(q.offset, q.offset + q.limit).map((w) => ({
          ...w,
          versionCount: w.versions.length,
          versions: w.versions.slice(0, 20),
          versionsTruncated: w.versions.length > 20,
        })),
        total: deps.workflows.length,
        offset: q.offset,
        limit: q.limit,
        truncated: q.offset + q.limit < deps.workflows.length,
        activeRunCount: deps.runs.length,
        runningComparisonCount: deps.comparisons.length,
      },
      bindings: {
        items: bindings.slice(q.offset, q.offset + q.limit),
        total: bindings.length,
        truncated: q.offset + q.limit < bindings.length,
      },
    };
  }
  private checkName(name: string, id: string) {
    if (
      this.store
        .list<SavedVariable>('variables')
        .some((v) => v.id !== id && v.name.toLowerCase() === name.toLowerCase())
    )
      throw new InterlockError(
        'A variable with that name already exists. Choose a different name.',
      );
  }
  private revision(old: SavedVariable, expected: number) {
    if (old.revision !== expected)
      throw new InterlockError(
        'Variable changed elsewhere. Reload before saving. Your edits have not been saved.',
      );
  }
  private saveValue(v: SavedVariable, value: string) {
    if (v.kind === 'secret' && !value.length)
      throw new InterlockError('Secret value cannot be empty.');
    const previous =
      this.store.get<{ id: string; latest: number }>(
        'variableValueCounters',
        v.id,
      )?.latest ?? 0;
    const next = Math.max(v.valueRevision ?? 0, previous) + 1;
    this.store.protectedValues.write(v.id, v.kind, next, value);
    this.store.put('variableValueCounters', { id: v.id, latest: next });
    v.valueRevision = next;
  }
  private create(
    name: string,
    description: string,
    kind: VariableKind,
    value?: string,
    id: string = randomUUID(),
  ): SavedVariable {
    if (
      this.store.get('variables', id) ||
      this.store.get('variableBindings', id)
    )
      throw new InterlockError(
        'Variable identity already exists. Choose an explicit local binding.',
      );
    this.checkName(name, id);
    const time = stamp();
    const v: SavedVariable = {
      id,
      name,
      description,
      kind,
      enabled: true,
      revision: 1,
      valueRevision: null,
      createdAt: time,
      updatedAt: time,
    };
    if (value !== undefined) this.saveValue(v, value);
    this.store.put('variables', v);
    return v;
  }
  mutate(input: VariableMutation) {
    const parsed = variableMutationSchema.safeParse(input);
    if (!parsed.success)
      throw new InterlockError(
        'Invalid variable change. Check required fields, name, value size, and expectedRevision. Values were not saved.',
      );
    const q = parsed.data;
    return this.store.transaction(() => {
      if (q.action === 'create')
        return this.metadata(
          this.create(q.name, q.description, q.kind, q.value),
        );
      if (q.action === 'bind')
        return this.bind(q.id, q.variableId, q.kind, q.expectedRevision);
      const v = this.store.get<SavedVariable>('variables', q.id);
      if (!v)
        throw new InterlockError('Variable does not exist. Reload Variables.');
      this.revision(v, q.expectedRevision);
      if (q.action === 'delete') {
        const deps = this.dependencies(v.id);
        if (
          deps.workflows.length ||
          deps.runs.length ||
          deps.comparisons.length
        )
          throw new InterlockError(
            `Cannot delete variable: ${deps.workflows.length} dependent workflows, ${deps.runs.length} active runs, ${deps.comparisons.length} running comparisons. Inspect dependencies and remove retained references first.`,
          );
        for (const e of this.store.list<{ id: string; variableId: string }>(
          'variableValues',
        ))
          if (e.variableId === v.id) this.store.remove('variableValues', e.id);
        for (const b of this.store.list<VariableBinding>('variableBindings'))
          if (b.variableId === v.id)
            this.store.remove('variableBindings', b.id);
        this.store.remove('variables', v.id);
        return { id: v.id };
      }
      if (q.name !== undefined) {
        this.checkName(q.name, v.id);
        v.name = q.name;
      }
      if (q.description !== undefined) v.description = q.description;
      if (q.enabled !== undefined) v.enabled = q.enabled;
      if (q.value !== undefined) this.saveValue(v, q.value);
      v.revision++;
      v.updatedAt = stamp();
      this.store.put('variables', v);
      return this.metadata(v);
    });
  }
  private bind(
    id: string,
    variableId: string,
    kind: VariableKind,
    expectedRevision: number,
  ) {
    const target = this.store.get<SavedVariable>('variables', variableId);
    if (!target || target.kind !== kind)
      throw new InterlockError(
        'Select a local variable of the required kind. Bindings must point directly to a local value.',
      );
    const own = this.store.get<SavedVariable>('variables', id);
    if (own) {
      if (own.id === variableId && own.kind === kind && expectedRevision === 0)
        return { id, variableId, kind, revision: 0 };
      throw new InterlockError(
        'Cannot redirect a value-owning variable identity. Edit the workflow reference instead.',
      );
    }
    const old = this.store.get<VariableBinding>('variableBindings', id);
    if (old && old.kind !== kind)
      throw new InterlockError(
        'Portable variable kind is immutable. Select a local variable of its original kind.',
      );
    if ((old?.revision ?? 0) !== expectedRevision)
      throw new InterlockError(
        'Variable binding changed elsewhere. Reload dependencies before rebinding.',
      );
    if (old?.variableId === variableId && old.kind === kind) return old;
    const binding: VariableBinding = {
      id,
      variableId,
      kind,
      revision: (old?.revision ?? 0) + 1,
    };
    this.store.put('variableBindings', binding);
    return binding;
  }
  requirements(ids: string[]): VariableRequirement[] {
    return ids.map((id) => {
      const v = this.get(id);
      return { id, name: v.name, kind: v.kind };
    });
  }
  previewRequirements(requirements: VariableRequirement[]) {
    return requirements.map((r) => {
      try {
        const v = this.get(r.id);
        return {
          ...r,
          local: this.metadata(v),
          bindingRevision:
            this.store.get<VariableBinding>('variableBindings', r.id)
              ?.revision ?? 0,
        };
      } catch {
        return { ...r, local: null, bindingRevision: 0 };
      }
    });
  }
  importRequirements(
    requirements: VariableRequirement[],
    choices: VariableImportBindings = {},
  ) {
    const expected = new Set(requirements.map((r) => r.id));
    if (Object.keys(choices).some((id) => !expected.has(id)))
      throw new InterlockError(
        'Import contains an extra variable binding. Refresh the import preview.',
      );
    for (const r of requirements) {
      const choice = choices[r.id];
      if (!choice)
        throw new InterlockError(
          `Choose a local binding or provision variable ${r.name} before import.`,
        );
      if (choice.action === 'provision') {
        this.create(choice.name ?? r.name, '', r.kind, undefined, r.id);
      } else {
        if (!choice.variableId)
          throw new InterlockError(`Select a local variable for ${r.name}.`);
        const existing = this.store.get<VariableBinding>(
          'variableBindings',
          r.id,
        );
        if (existing && existing.variableId !== choice.variableId)
          throw new InterlockError(
            'Import would change an existing variable binding. Rebind it explicitly after reviewing dependencies.',
          );
        this.bind(r.id, choice.variableId, r.kind, existing?.revision ?? 0);
      }
    }
  }
  captureIds(ids: string[]): VariableCapture[] {
    if (ids.length > 64)
      throw new InterlockError(
        'At most 64 distinct variable references can be captured.',
      );
    let bytes = 0;
    return ids.map((referenceId) => {
      const v = this.get(referenceId);
      if (v.valueRevision === null)
        throw new InterlockError(
          `Variable ${v.name} has no value. Set its value in Variables.`,
        );
      const c = {
        referenceId,
        variableId: v.id,
        name: v.name,
        kind: v.kind,
        valueRevision: v.valueRevision,
      };
      bytes += Buffer.byteLength(this.ready(c), 'utf8');
      if (bytes > 1024 * 1024)
        throw new InterlockError(
          'Captured variable values exceed 1 MiB. Reduce the selected variables.',
        );
      return c;
    });
  }
  capture(definition: WorkflowDefinition, inherited?: VariableCapture[]) {
    const ids = variableReferences(definition);
    if (!inherited) return this.captureIds(ids);
    return ids.map((id) => {
      const captured = inherited.find((c) => c.referenceId === id);
      if (!captured)
        throw new InterlockError(
          `Variable capture ${id} is missing. Start a new run after provisioning it.`,
        );
      this.ready(captured);
      return captured;
    });
  }
  resolve(run: Pick<Run, 'variableCaptures'>, ids: string[]) {
    const values = new Map<string, string>();
    const secrets: string[] = [];
    for (const id of new Set(ids)) {
      const captured = run.variableCaptures?.find((c) => c.referenceId === id);
      if (!captured)
        throw new InterlockError(
          `Variable capture ${id} is missing. Start a new run.`,
        );
      const value = this.ready(captured);
      values.set(id, value);
      if (captured.kind === 'secret') secrets.push(value);
    }
    return {
      value: (id: string) => {
        if (!values.has(id))
          throw new InterlockError(
            'Variable was not selected for this operation',
          );
        return values.get(id)!;
      },
      secrets,
    };
  }
}
