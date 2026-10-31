import { readPath, type Json } from './index.js';
import { structuralEqual } from './jsonEquality.js';
export function matchRouting(
  routing: {
    path: string;
    cases: Array<{ port: string; equals: Json }>;
    default?: string;
  },
  result: Json,
): string | undefined {
  const value = readPath(result, routing.path);
  return (
    routing.cases.find((entry) => structuralEqual(value, entry.equals))?.port ??
    routing.default
  );
}
