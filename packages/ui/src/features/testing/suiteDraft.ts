import {
  suiteContentSchema,
  type Json,
  type TestAssertion,
  type TestSuite,
  type WorkflowDefinition,
} from '@interlock/core';

export type CaseDraft = {
  /** Stable React key; never saved. */
  key: string;
  id: string;
  name: string;
  source: 'input' | 'run';
  input: Json;
  sourceRunId: string;
  /** Undefined means the case has no fixtures; simulation then reports missing ones. */
  fixtures?: Json;
  assertions: TestAssertion[];
  /** Stable key per check; never saved. */
  checkKeys: string[];
  /** The run this case's input was copied from, while that input is unchanged. */
  captured?: { runId: string; input: Json };
  qualityGuidance: string;
};
export type SuiteDraft = {
  name: string;
  description: string;
  cases: CaseDraft[];
};
type CaseContent = (typeof suiteContentSchema._input)['cases'][number];

let nextKey = 0;
export const draftKey = () => `draft-${++nextKey}`;
const key = draftKey;

export function emptyCase(existing: CaseDraft[]): CaseDraft {
  let n = existing.length + 1;
  while (existing.some((c) => c.id === `case-${n}`)) n++;
  return {
    key: key(),
    id: `case-${n}`,
    name: `Case ${n}`,
    source: 'input',
    input: {},
    sourceRunId: '',
    assertions: [],
    checkKeys: [],
    qualityGuidance: '',
  };
}

export function emptySuite(): SuiteDraft {
  return { name: '', description: '', cases: [emptyCase([])] };
}

/** Saved cases carry captured input; `captured` keeps the source run while that input is unchanged. */
export function suiteDraft(suite: TestSuite): SuiteDraft {
  return {
    name: suite.name,
    description: suite.description,
    cases: suite.cases.map((c) => ({
      key: key(),
      id: c.id,
      name: c.name,
      source: 'input',
      input: c.input,
      sourceRunId: '',
      ...(c.fixtures ? { fixtures: c.fixtures } : {}),
      assertions: c.assertions,
      checkKeys: c.assertions.map(() => key()),
      ...(c.source
        ? { captured: { runId: c.source.runId, input: c.input } }
        : {}),
      qualityGuidance: c.qualityGuidance,
    })),
  };
}

/** JSON text with sorted object keys, so key order alone is not an edit. */
function canonical(value: Json): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  );
}

/**
 * The saved shape. An unchanged input copied from a run is saved by its
 * source run ID, so the server keeps its provenance. Pass `keepSources:
 * false` to save every input as entered (for a source run that was deleted).
 */
export function suiteContent(draft: SuiteDraft, keepSources = true) {
  return {
    name: draft.name.trim(),
    description: draft.description,
    cases: draft.cases.map((c): CaseContent => {
      const fixtures = c.fixtures as CaseContent['fixtures'];
      return {
        id: c.id.trim(),
        name: c.name.trim(),
        ...(c.source === 'run'
          ? { sourceRunId: c.sourceRunId.trim() }
          : keepSources &&
              c.captured &&
              canonical(c.captured.input) === canonical(c.input)
            ? { sourceRunId: c.captured.runId }
            : { input: c.input }),
        ...(fixtures === undefined ? {} : { fixtures }),
        assertions: c.assertions,
        qualityGuidance: c.qualityGuidance,
      };
    }),
  };
}

export const sameSuiteDraft = (a: SuiteDraft, b: SuiteDraft) =>
  JSON.stringify(suiteContent(a)) === JSON.stringify(suiteContent(b));

type Issue = {
  code: string;
  message: string;
  minimum?: unknown;
  received?: unknown;
};

/** Plain wording for the schema's missing-value messages. */
export function issueText(issue: Issue) {
  if (
    (issue.code === 'too_small' && Number(issue.minimum) === 1) ||
    (issue.code === 'invalid_type' &&
      (issue.received === 'undefined' ||
        /received undefined/.test(issue.message)))
  )
    return 'Required';
  return issue.message;
}

/** Schema problems keyed by field path, such as `cases.0.assertions.1`. */
export function suiteProblems(draft: SuiteDraft) {
  const parsed = suiteContentSchema.safeParse(suiteContent(draft));
  const problems = new Map<string, string>();
  if (parsed.success) return problems;
  for (const issue of parsed.error.issues) {
    // Field messages sit beside the field they name. Fixture problems belong
    // to the case's fixture list, which is edited as one JSON value.
    const path = issue.path
      .slice(0, issue.path[2] === 'fixtures' ? 3 : 5)
      .join('.');
    if (!problems.has(path)) problems.set(path, issueText(issue));
  }
  return problems;
}

/** Root-scope steps and their declared ports, the selectors checks accept. */
export function checkTargets(definition?: WorkflowDefinition) {
  if (!definition) return [];
  return definition.nodes
    .filter((n) => !n.batchId && !n.parallelId && n.kind !== 'entry')
    .map((n) => ({
      id: n.id,
      label: n.label || n.id,
      ports: [
        ...new Set(
          definition.edges
            .filter((e) => e.source === n.id)
            .map((e) => e.port ?? 'default'),
        ),
      ],
    }));
}

export function describeCheck(check: TestAssertion, expectedOmitted = false) {
  const target = check.nodeId
    ? `${check.nodeId}${check.visit > 1 ? ` visit ${check.visit}` : ''}`
    : 'Workflow output';
  if (check.kind === 'route') return `${target} takes route ${check.port}`;
  const path = check.path ? ` ${check.path}` : '';
  if (check.operator === 'exists') return `${target}${path} exists`;
  const operator = { equals: 'equals', gte: 'is at least', lte: 'is at most' }[
    check.operator
  ];
  const expected = expectedOmitted
    ? 'a large value'
    : JSON.stringify(check.expected);
  return `${target}${path} ${operator} ${expected}`;
}
