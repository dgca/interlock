import { readPath, type Json } from './index.js';
import { structuralEqual } from './jsonEquality.js';
export function matchRouting(
  routing: {
    path: string;
    cases: Array<{ port: string; equals: Json }>;
    default?: string;
  },
  result: Json,
  executionLookup?: (nodeId: string, path: string) => Json | undefined,
): string | undefined {
  let value: Json;
  const normalized = routing.path.replace(/^\$\./, '');
  if (
    normalized.startsWith('execution.') &&
    executionLookup &&
    (result === null ||
      typeof result !== 'object' ||
      !Object.hasOwn(result, 'execution'))
  ) {
    const parts = normalized.split('.');
    const targetNodeId = parts[1];
    const propPath = parts.slice(2).join('.');
    value = executionLookup(targetNodeId, propPath) ?? null;
  } else {
    value = readPath(result, routing.path);
  }
  return (
    routing.cases.find((entry) => structuralEqual(value, entry.equals))?.port ??
    routing.default
  );
}
