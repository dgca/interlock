/** Inspections larger than this omit large fields unless the caller asks for `full`. */
const runInspectionLimitBytes = 65536;
/** Fields up to this size stay inline in a compacted inspection. */
const inlineBytes = 1024;

type Fields = Record<string, unknown>;
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value) ?? '');

/** Copies `item` without fields over the inline size, recording their sizes. */
function omit<T extends object>(item: T, fields?: readonly string[]): T {
  const copy = { ...item } as Fields;
  const omittedBytes: Record<string, number> = {};
  for (const field of fields ?? Object.keys(copy)) {
    if (copy[field] === undefined || field === 'executions') continue;
    const size = bytes(copy[field]);
    if (size <= inlineBytes) continue;
    omittedBytes[field] = size;
    delete copy[field];
  }
  return (
    Object.keys(omittedBytes).length ? { ...copy, omittedBytes } : copy
  ) as T;
}

const compactRun = <T extends object>(run: T): T => {
  const copy = omit(run) as Fields;
  if (Array.isArray(copy.executions))
    copy.executions = copy.executions.map((execution: object) =>
      omit(execution),
    );
  return copy as T;
};
const compactWork = <T extends object>(work: T) => omit(work);

/**
 * Returns `view` unchanged when its JSON fits the limit. Otherwise returns a copy
 * whose definition and whose run, execution and work fields over 1 KiB are
 * omitted, plus `compacted` with both sizes and how to read the omitted data.
 */
export function boundRunInspection<
  T extends {
    run: object;
    descendants: object[];
    children: object[];
    work: object[];
    descendantWork: object[];
  },
>(
  view: T,
  full = false,
): T & {
  compacted?: { limitBytes: number; fullBytes: number; read: string };
} {
  if (full) return view;
  const fullBytes = bytes(view);
  if (fullBytes <= runInspectionLimitBytes) return view;
  return {
    ...omit(view, ['definition']),
    run: compactRun(view.run),
    descendants: view.descendants.map(compactRun),
    children: view.children.map(compactRun),
    work: view.work.map(compactWork),
    descendantWork: view.descendantWork.map(compactWork),
    compacted: {
      limitBytes: runInspectionLimitBytes,
      fullBytes,
      read: 'omittedBytes lists removed field sizes. Read a step payload with get_run_result or runs.result {id: owning run, executionId, field}, or request full:true (CLI --full).',
    },
  };
}
