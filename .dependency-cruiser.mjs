// Package boundary rules for `pnpm lint:deps`. See "Preserve these boundaries"
// in AGENTS.md. Known module-level violations live in
// .dependency-cruiser-known-violations.json; known package cycles are below.

// Workspace packages each package may import. Anything else is upward or sideways.
const allowedPackages = {
  core: [],
  storage: ['core'],
  runtime: ['core', 'storage'],
  server: ['core', 'runtime', 'storage'],
  // The client imports the server's router type and shared transport module.
  client: ['server'],
  mcp: ['client', 'core'],
  ui: ['client', 'core'],
  // The CLI is the packaged executable's composition root.
  cli: ['client', 'core', 'mcp', 'server'],
};

const packageDirection = Object.entries(allowedPackages).map(
  ([name, allowed]) => ({
    name: `package-direction-${name}`,
    comment: `packages/${name} may import only ${
      allowed.length
        ? allowed.map((other) => `packages/${other}`).join(', ')
        : 'no other workspace package'
    }.`,
    severity: 'error',
    from: { path: `^packages/${name}/` },
    to: {
      // Undeclared workspace imports stay unresolved, so match the name too.
      path: ['^packages/[^/]+/', '^@interlock/'],
      pathNot: [
        `^packages/(${[name, ...allowed].join('|')})/`,
        `^@interlock/(${[name, ...allowed].join('|')})(/|$)`,
      ],
    },
  }),
);

// Baseline for the folder-scoped cycle rule. dependency-cruiser applies
// --ignore-known only to module-level violations, so known package cycles are
// listed here as exact folder edges instead. Remove an entry once fixed.
const knownPackageCycleEdges = {
  // server -> mcp -> client -> server: server/src/app.ts mounts the MCP server
  // (createMcpServer), which calls the server through @interlock/client. #418.
  'packages/server/src': ['packages/mcp/src'],
  'packages/mcp/src': ['packages/client/src'],
  'packages/client/src': ['packages/server/src'],
};

// A cross-package folder dependency inside a folder cycle is a cycle between
// packages. Folder scope also catches package cycles with no module cycle.
const cycleRule = (from, to) => ({
  name: 'no-package-cycle',
  comment: 'Workspace packages must not import each other in a cycle.',
  severity: 'error',
  scope: 'folder',
  from,
  to: { circular: true, path: '^packages/', ...to },
});
const exact = (folders) => folders.map((folder) => `^${folder}$`);
const packageCycles = Object.keys(allowedPackages).flatMap((name) => {
  const known = Object.keys(knownPackageCycleEdges).filter((folder) =>
    folder.startsWith(`packages/${name}/`),
  );
  return [
    cycleRule(
      { path: `^packages/${name}/`, pathNot: exact(known) },
      { pathNot: `^packages/${name}/` },
    ),
    ...known.map((folder) =>
      cycleRule(
        { path: exact([folder]) },
        {
          pathNot: [
            `^packages/${name}/`,
            ...exact(knownPackageCycleEdges[folder]),
          ],
        },
      ),
    ),
  ];
});

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    ...packageDirection,
    {
      name: 'no-cross-package-relative-import',
      comment:
        'Import another workspace package through its @interlock/* name and declared exports, not a relative path.',
      severity: 'error',
      from: { path: '^packages/([^/]+)/' },
      to: {
        path: '^packages/',
        pathNot: '^packages/$1/',
        dependencyTypes: ['local'],
      },
    },
    ...packageCycles,
    {
      name: 'design-system-independent',
      comment:
        'packages/ui/src/design-system must not import features, routes, API clients, or Interlock domain code.',
      severity: 'error',
      from: { path: '^packages/ui/src/design-system/' },
      to: {
        pathNot: '^packages/ui/src/design-system/',
        path: ['^packages/', 'node_modules/(@trpc|@tanstack)/'],
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.d.ts'],
    },
  },
};
