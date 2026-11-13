import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from 'playwright';

/**
 * Existing serious and critical violations, by rule and screen. A screen key is
 * `<screen>@<width>`. Fix a violation, then remove its rule here; the check
 * fails when a listed rule no longer occurs so the baseline only shrinks.
 */
const baseline: Record<string, string[]> = JSON.parse(
  readFileSync(
    new URL('./accessibility-baseline.json', import.meta.url),
    'utf8',
  ),
);

const blocking = new Set(['serious', 'critical']);

/** Runs axe and fails on serious or critical violations outside the baseline. */
export async function expectAccessible(
  page: Page,
  screen: string,
  { include }: { include?: string } = {},
) {
  let builder = new AxeBuilder({ page });
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  const found = violations.filter((v) => blocking.has(v.impact ?? ''));
  const allowed = new Set(baseline[screen] ?? []);
  const unexpected = found.filter((v) => !allowed.has(v.id));
  const resolved = [...allowed].filter(
    (rule) => !found.some((v) => v.id === rule),
  );
  const problems = [
    ...unexpected.map(
      (v) =>
        `${v.impact} ${v.id}: ${v.help} (${v.helpUrl})\n` +
        v.nodes
          .slice(0, 5)
          .map((node) => `    ${node.target.join(' ')}`)
          .join('\n'),
    ),
    ...resolved.map(
      (rule) =>
        `${rule} no longer occurs on ${screen}; remove it from tests/browser/accessibility-baseline.json`,
    ),
  ];
  if (problems.length)
    throw new Error(
      `Accessibility check failed for ${screen}:\n${problems.join('\n')}`,
    );
}
