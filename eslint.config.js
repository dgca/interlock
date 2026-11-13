// ESLint flat config for `pnpm lint`.
//
// Layout:
//   1. Type-aware base rules for every TypeScript source file.
//   2. File-size budgets (`max-lines`) read from eslint-size-budgets.json.
//   3. Scoped rule blocks: add one entry to `scopedRuleBlocks` per area with
//      its own conventions (for example `packages/ui/src/**`).
//
// Existing violations of rules in (1) and (3) are recorded in
// eslint-suppressions.json, ESLint's bulk-suppressions file. It lists every
// suppressed file and rule with a count, so a new violation of a baselined
// rule in a baselined file still fails. Remove entries by fixing the code
// and running `pnpm lint --prune-suppressions`.
import { readFileSync } from 'node:fs';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const sourceFiles = ['packages/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'];

const sizeBudgets = JSON.parse(
  readFileSync(new URL('./eslint-size-budgets.json', import.meta.url), 'utf8'),
);

for (const [file, ceiling] of Object.entries(sizeBudgets.ceilings)) {
  if (!Number.isInteger(ceiling) || ceiling <= sizeBudgets.maxLines) {
    throw new Error(
      `eslint-size-budgets.json: ceiling for ${file} must be an integer above maxLines (${sizeBudgets.maxLines}); delete the entry once the file is within budget.`,
    );
  }
}

const sizeBudgetBlocks = [
  {
    name: 'interlock/size-budget',
    files: sourceFiles,
    rules: { 'max-lines': ['error', { max: sizeBudgets.maxLines }] },
  },
  ...Object.entries(sizeBudgets.ceilings).map(([file, ceiling]) => ({
    name: `interlock/size-ceiling/${file}`,
    files: [file],
    rules: { 'max-lines': ['error', { max: ceiling }] },
  })),
];

// Extension point: append `{ name, files, rules }` blocks for area-specific
// rules. Record their existing violations with
// `pnpm lint --suppress-rule <rule>` so they join eslint-suppressions.json.
const scopedRuleBlocks = [];

export default tseslint.config(
  {
    name: 'interlock/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '.interlock/**',
      '.tasks/**',
      '.site-build/**',
      'website/**',
      'coverage/**',
    ],
  },
  {
    name: 'interlock/typescript',
    files: sourceFiles,
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  ...sizeBudgetBlocks,
  ...scopedRuleBlocks,
);
