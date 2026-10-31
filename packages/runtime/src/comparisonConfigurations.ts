import {
  InterlockError,
  promptIds,
  snapshotPrompt,
  type ComparisonConfiguration,
  type ComparisonSideSelection,
  type ComparisonPin,
  type PromptSnapshot,
  type SavedPrompt,
  type WorkflowComparison,
  selectedUsageReport,
  type UsageAttempt,
} from '@interlock/core';
import type { Store } from '@interlock/storage';
import { definitionHash, fingerprint } from './versionIdentity.js';

export const comparisonSides = ['baseline', 'candidate'] as const;
const pinKey = (p: ComparisonPin) => `${p.workflowId}:${p.version}`;
const promptKey = (p: { id: string; revision: number }) =>
  `${p.id}:${p.revision}`;
export const promptIdentity = ({
  id,
  name,
  revision,
  content,
}: PromptSnapshot) => ({
  id,
  name,
  revision,
  contentHash: fingerprint(content),
});

/** Resolve complete side manifests once; the pool retains each selected body once. */
export function captureConfigurations(
  store: Store,
  workflowId: string,
  versions: Record<'baseline' | 'candidate', number>,
  selections: Partial<
    Record<'baseline' | 'candidate', ComparisonSideSelection>
  > = {},
) {
  const pins = new Map<string, ComparisonPin>();
  const pool = new Map<string, PromptSnapshot>();
  const configurations = {} as Record<
    'baseline' | 'candidate',
    ComparisonConfiguration
  >;
  const blockers: string[] = [];
  for (const side of comparisonSides) {
    const selection = selections[side];
    const dependencies = new Map<string, ComparisonPin>();
    const required = new Set<string>();
    const visit = (id: string, version: number) => {
      const key = `${id}:${version}`;
      if (dependencies.has(key)) return;
      if (!pins.has(key) && pins.size >= 64)
        throw new InterlockError(
          'Comparison exceeds 64 pinned workflow versions',
        );
      const snapshot = store.getVersion(id, version);
      if (!snapshot)
        throw new InterlockError(`Published dependency ${key} is unavailable`);
      const pin = {
        workflowId: id,
        version,
        definitionHash: definitionHash(snapshot.definition),
      };
      dependencies.set(key, pin);
      pins.set(key, pin);
      if (
        snapshot.definition.nodes.some(
          (n) => n.kind === 'exit' && n.continueAsNew,
        )
      )
        blockers.push(`Continue as new is unsupported in comparisons: ${key}`);
      for (const id of promptIds(snapshot.definition)) required.add(id);
      for (const node of snapshot.definition.nodes)
        if (node.kind === 'workflow') {
          if (node.version === null)
            throw new InterlockError(`Unresolved Workflow pin ${node.id}`);
          visit(node.workflowId, node.version);
        }
    };
    visit(workflowId, versions[side]);
    const explicit = selection?.promptRevisions;
    if (
      explicit &&
      (new Set(explicit.map((p) => p.id)).size !== explicit.length ||
        explicit.length !== required.size ||
        explicit.some((p) => !required.has(p.id)))
    ) {
      throw new InterlockError(
        `${side} promptRevisions must select each transitive saved prompt exactly once, with no extra IDs`,
      );
    }
    const prompts = [...required].sort().map((id) => {
      const revision = explicit?.find((p) => p.id === id)?.revision;
      const current = store.get<SavedPrompt>('prompts', id);
      const prompt =
        revision === undefined
          ? current
          : (store.promptRevision(id, revision) ??
            (current?.revision === revision ? current : undefined));
      if (!prompt)
        throw new InterlockError(
          `${side} saved prompt ${id}${revision !== undefined ? ` revision ${revision}` : ''} is unavailable`,
        );
      const captured = snapshotPrompt(prompt);
      pool.set(promptKey(captured), captured);
      return captured;
    });
    const config = {
      promptSource: explicit ? ('revisions' as const) : ('current' as const),
      prompts: prompts.map(({ id, revision }) => ({ id, revision })),
      pins: [...dependencies.values()].sort((a, b) =>
        pinKey(a).localeCompare(pinKey(b)),
      ),
      ...(selection?.executor ? { executor: selection.executor } : {}),
      ...(selection?.environment ? { environment: selection.environment } : {}),
    };
    configurations[side] = {
      ...config,
      id: fingerprint({ ...config, prompts: prompts.map(promptIdentity) }),
    };
  }
  const prompts = [...pool.values()].sort(
    (a, b) => a.id.localeCompare(b.id) || a.revision - b.revision,
  );
  if (
    new Set(prompts.map((p) => p.id)).size > 64 ||
    prompts.length > 128 ||
    Buffer.byteLength(JSON.stringify(prompts)) > 1048576
  )
    throw new InterlockError(
      'Comparison prompt capture exceeds 64 prompt IDs, 128 revisions or 1 MiB',
    );
  return {
    pins: [...pins.values()].sort((a, b) => pinKey(a).localeCompare(pinKey(b))),
    prompts,
    configurations,
    blockers,
  };
}

export function configurationSummary(
  c: Pick<WorkflowComparison, 'configurations' | 'prompts'>,
) {
  if (!c.configurations) return null;
  const sides = Object.fromEntries(
    comparisonSides.map((side) => {
      const config = c.configurations![side];
      return [
        side,
        {
          ...config,
          prompts: config.prompts.map((ref) => {
            const prompt = c.prompts.find(
              (p) => promptKey(p) === promptKey(ref),
            );
            if (!prompt)
              throw new InterlockError(
                `Captured ${side} prompt revision is missing`,
              );
            return promptIdentity(prompt);
          }),
        },
      ];
    }),
  ) as Record<
    'baseline' | 'candidate',
    Omit<ComparisonConfiguration, 'prompts'> & {
      prompts: ReturnType<typeof promptIdentity>[];
    }
  >;
  const baseline = sides.baseline,
    candidate = sides.candidate;
  const ids = [
    ...new Set([...baseline.prompts, ...candidate.prompts].map((p) => p.id)),
  ].sort();
  return {
    ...sides,
    differences: {
      prompts: ids.filter(
        (id) =>
          fingerprint(baseline.prompts.find((p) => p.id === id) ?? null) !==
          fingerprint(candidate.prompts.find((p) => p.id === id) ?? null),
      ),
      pins: fingerprint(baseline.pins) !== fingerprint(candidate.pins),
      executor:
        fingerprint(baseline.executor ?? null) !==
        fingerprint(candidate.executor ?? null),
      environment:
        fingerprint(baseline.environment ?? null) !==
        fingerprint(candidate.environment ?? null),
    },
  };
}

export function promptsForSide(
  c: WorkflowComparison,
  side: 'baseline' | 'candidate',
) {
  const config = c.configurations?.[side];
  if (!config) return c.prompts;
  return config.prompts.map((ref) => {
    const prompt = c.prompts.find((p) => promptKey(p) === promptKey(ref));
    if (!prompt)
      throw new InterlockError(`Captured ${side} prompt revision is missing`);
    return prompt;
  });
}

/** Compare declarations and reported identities independently; neither proves execution. */
export function executorConditions(
  requested: ComparisonConfiguration['executor'],
  attempts: UsageAttempt[],
  pending: boolean,
  full: boolean,
) {
  const assess = (values: Array<Record<string, string | undefined>>) => {
    const counts = { matched: 0, mismatched: 0, unknown: 0 };
    if (requested)
      for (const value of values.length ? values : [{}]) {
        const entries = Object.entries(requested);
        if (entries.some(([k, v]) => value[k] !== undefined && value[k] !== v))
          counts.mismatched++;
        else if (entries.some(([k]) => value[k] === undefined))
          counts.unknown++;
        else counts.matched++;
      }
    return {
      state: !requested
        ? ('not_requested' as const)
        : pending
          ? ('pending' as const)
          : counts.mismatched
            ? ('mismatch' as const)
            : counts.unknown
              ? ('unknown' as const)
              : ('matched' as const),
      ...counts,
    };
  };
  const declarations = attempts.map((a) => a.modelSelection ?? {});
  const reports = attempts.flatMap((a) => {
    const snapshot = selectedUsageReport(a)?.snapshot;
    if (!snapshot) return [{}];
    const models = snapshot.models.map(({ provider, model }) => ({
      provider,
      model,
    }));
    // Non-final reporting cannot establish that all used models are known.
    return snapshot.final ? models : [...models, {}];
  });
  const declared = assess(declarations),
    reported = assess(reports);
  const identities = (values: Array<Record<string, string | undefined>>) => {
    const groups = new Map<
      string,
      { selection: Record<string, string | undefined>; count: number }
    >();
    for (const selection of values) {
      const id = fingerprint(selection),
        group = groups.get(id);
      if (group) group.count++;
      else groups.set(id, { selection, count: 1 });
    }
    return {
      items: [...groups.values()].slice(0, 10),
      total: groups.size,
      truncated: groups.size > 10,
    };
  };
  return {
    state:
      declared.state === 'mismatch' || reported.state === 'mismatch'
        ? ('mismatch' as const)
        : declared.state === 'unknown' || reported.state === 'unknown'
          ? ('unknown' as const)
          : declared.state,
    declared,
    reported,
    ...(full
      ? {
          actual: {
            declarations: identities(declarations),
            reports: identities(reports),
          },
        }
      : {}),
  };
}
