import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from 'playwright';

/**
 * Existing serious and critical violations: for each `<screen>@<width>` key,
 * the number of affected elements per axe rule. Counts are used instead of
 * selectors because selectors contain hashed CSS module class names. A count
 * that rises fails, and so does one that falls, so the baseline only shrinks.
 */
const baseline: Record<string, Record<string, number>> = JSON.parse(
  readFileSync(
    new URL('./accessibility-baseline.json', import.meta.url),
    'utf8',
  ),
);
const file = 'tests/browser/accessibility-baseline.json';
const blocking = new Set(['serious', 'critical']);
const visited = new Set<string>();

/** Runs axe and fails unless serious and critical violations match the baseline exactly. */
export async function expectAccessible(
  page: Page,
  screen: string,
  { include }: { include?: string } = {},
) {
  visited.add(screen);
  let builder = new AxeBuilder({ page });
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const found = violations.filter((v) => blocking.has(v.impact ?? ''));
  const allowed = baseline[screen] ?? {};
  const problems: string[] = [];
  for (const v of found) {
    const expected = allowed[v.id] ?? 0;
    if (v.nodes.length > expected)
      problems.push(
        `${v.impact} ${v.id}: ${v.nodes.length} elements, baseline allows ${expected}. ${v.help} (${v.helpUrl})\n` +
          v.nodes
            .slice(0, 5)
            .map((node) => `    ${node.target.join(' ')}`)
            .join('\n'),
      );
  }
  for (const [rule, expected] of Object.entries(allowed)) {
    const actual = found.find((v) => v.id === rule)?.nodes.length ?? 0;
    if (actual < expected)
      problems.push(
        `${rule}: ${actual} elements, baseline records ${expected}. Lower the count in ${file}${actual ? '' : ' or remove the rule'}.`,
      );
  }
  if (problems.length)
    throw new Error(
      `Accessibility check failed for ${screen}:\n${problems.join('\n')}`,
    );
}

/** Call after every check has run so mistyped or orphaned baseline keys fail. */
export function expectBaselineVisited() {
  const unknown = Object.keys(baseline).filter((key) => !visited.has(key));
  if (unknown.length)
    throw new Error(
      `${file} has keys that no accessibility check visited: ${unknown.join(', ')}. Remove or rename them. (Running a subset of tests with -t also reports this.)`,
    );
}
