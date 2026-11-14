/** Inspections larger than this are compacted unless the caller asks for `full`. */
const runInspectionLimitBytes = 65536;
/** Fields up to this size stay inline in a compacted inspection. */
const inlineBytes = 1024;
/** Most recent list items kept per list when dropping fields is not enough. */
const listSizes = [100, 50, 20, 10, 5, 1];
/** Identity, status, routing, progress, timestamps and run references always stay. */
const kept =
  /^(id|status|stage|waiting|actor|kind|port|nodeId|label|cursor|version|workflowName|attempt|executions)$|(Id|Ids|At)$/;
/** Fields `get_run_result` can read for a run or one of its executions. */
const resultFields = new Set(['input', 'output', 'result']);

type Fields = Record<string, unknown>;
type Omitted = Record<
  string,
  { bytes?: number; count?: number; via: 'get_run_result' | 'full' }
>;
const bytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value) ?? '');

/** Copies `item` without large fields, truncating long errors, and records what is missing. */
function omit(item: object, readable: boolean, fields?: readonly string[]) {
  const copy = { ...item } as Fields;
  const omitted: Omitted = {};
  for (const field of fields ?? Object.keys(copy)) {
    const value = copy[field];
    if (value === undefined || kept.test(field)) continue;
    const size = bytes(value);
    if (size <= inlineBytes) continue;
    if (field === 'error' && typeof value === 'string') {
      copy.error = `${value.slice(0, inlineBytes)}… [truncated from ${size} bytes; full:true]`;
      continue;
    }
    omitted[field] = {
      bytes: size,
      via: readable && resultFields.has(field) ? 'get_run_result' : 'full',
    };
    delete copy[field];
  }
  return Object.keys(omitted).length ? { ...copy, omitted } : copy;
}

const compactRun = (run: object) => {
  const copy = omit(run, true);
  if (Array.isArray(copy.executions))
    copy.executions = copy.executions.map((execution: object) =>
      omit(execution, true),
    );
  return copy;
};

/** Keeps the last `size` items of `field`, recording how many were left out. */
function trim(item: Fields, field: string, size: number): Fields {
  const list = item[field];
  if (!Array.isArray(list) || list.length <= size) return item;
  const omitted = (item.omitted ?? {}) as Omitted;
  return {
    ...item,
    [field]: list.slice(list.length - size),
    omitted: {
      ...omitted,
      [field]: { count: list.length - size, via: 'full' },
    },
  };
}

function trimLists(view: Fields, size: number) {
  let bounded = view;
  for (const field of [
    'events',
    'descendants',
    'children',
    'work',
    'descendantWork',
  ])
    bounded = trim(bounded, field, size);
  const run = (item: Fields) => trim(item, 'executions', size);
  return {
    ...bounded,
    run: run(bounded.run as Fields),
    descendants: (bounded.descendants as Fields[]).map(run),
  };
}

/**
 * Returns `view` unchanged when its JSON fits the limit. Otherwise drops the
 * definition and large fields, truncates long errors and lists `children` as
 * references; if that is still over the limit, keeps only the most recent list
 * items. `omitted` says what is missing and how to read it.
 */
export function boundRunInspection<
  T extends {
    run: object;
    descendants: object[];
    children: { id: string; status: string }[];
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
  const compacted = {
    limitBytes: runInspectionLimitBytes,
    fullBytes,
    read: 'omitted lists missing fields and items: read input, output or result with get_run_result {id: owning run, executionId?, field}; anything else with full:true (CLI --full).',
  };
  const base: Fields = {
    ...omit(view, false, ['definition']),
    run: compactRun(view.run),
    descendants: view.descendants.map(compactRun),
    children: view.children.map(({ id, status }) => ({ id, status })),
    work: view.work.map((work) => omit(work, false)),
    descendantWork: view.descendantWork.map((work) => omit(work, false)),
    compacted,
  };
  let bounded = base;
  for (const size of listSizes) {
    if (bytes(bounded) <= runInspectionLimitBytes) break;
    bounded = trimLists(base, size);
  }
  // Never answer with more than the full response.
  return (bytes(bounded) < fullBytes ? bounded : view) as T & {
    compacted?: typeof compacted;
  };
}
