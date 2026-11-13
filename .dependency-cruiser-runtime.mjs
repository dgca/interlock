// Second pass of `pnpm lint:deps`: the package-cycle rule from
// .dependency-cruiser.mjs with no exempt edges, on a graph without type-only
// imports (tsPreCompilationDeps: false). Type-only imports are erased from the
// built code, so this pass fails on any package cycle that exists at runtime,
// including one through the type-only edges the main config exempts.
import config, { packageCycles } from './.dependency-cruiser.mjs';

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: packageCycles({}),
  options: { ...config.options, tsPreCompilationDeps: false },
};
