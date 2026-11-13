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
  cli: ['client', 'core'],
};

// Single files allowed more than their package; the package rules exclude them.
const allowedFiles = {
  // The packaged executable's composition root starts the server and MCP server.
  'packages/cli/src/bin.ts': ['client', 'core', 'mcp', 'server'],
  // The HTTP app mounts the MCP server at /mcp.
  'packages/server/src/app.ts': ['core', 'mcp', 'runtime', 'storage'],
};

const escape = (path) => path.replace(/[.]/g, '\\.');
const directionRule = (name, from, allowed) => {
  const own = from.path.match(/^\^packages\/([^/]+)\//)[1];
  allowed = [own, ...allowed];
  return {
    name,
    comment: `${from.path} may import only ${allowed
      .map((other) => `packages/${other}`)
      .join(', ')}.`,
    severity: 'error',
    from,
    to: {
      // Undeclared workspace imports stay unresolved, so match the name too.
      path: ['^packages/[^/]+/', '^@interlock/'],
      pathNot: [
        `^packages/(${allowed.join('|')})/`,
        `^@interlock/(${allowed.join('|')})(/|$)`,
      ],
    },
  };
};
const packageDirection = [
  ...Object.entries(allowedPackages).map(([name, allowed]) =>
    directionRule(
      `package-direction-${name}`,
      {
        path: `^packages/${name}/`,
        pathNot: Object.keys(allowedFiles).map((file) => `^${escape(file)}$`),
      },
      allowed,
    ),
  ),
  ...Object.entries(allowedFiles).map(([file, allowed]) =>
    directionRule(
      `package-direction-${file.split('/')[1]}-${file.split('/').pop()}`,
      { path: `^${escape(file)}$` },
      allowed,
    ),
  ),
];

// Folder edges exempt from the package-cycle rule in this config only, because
// the cycle through them exists only in types. server/src/app.ts mounts the
// MCP server (mcp/src/tools); its createMcpServer takes the client type from
// mcp/src/client.ts through a type-only import, and the client imports the
// server's router type. Folder-scoped rules cannot filter by dependency type,
// so .dependency-cruiser-runtime.mjs runs the same cycle rule, without these
// exemptions, on a graph without type-only imports: a runtime cycle through
// these edges still fails `pnpm lint:deps`. Add no entries. #472.
const typeOnlyCycleEdges = {
  'packages/server/src': ['packages/mcp/src/tools'],
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
export const packageCycles = (exempt) =>
  Object.keys(allowedPackages).flatMap((name) => {
    const exempted = Object.keys(exempt).filter((folder) =>
      folder.startsWith(`packages/${name}/`),
    );
    return [
      cycleRule(
        { path: `^packages/${name}/`, pathNot: exact(exempted) },
        { pathNot: `^packages/${name}/` },
      ),
      ...exempted.map((folder) =>
        cycleRule(
          { path: exact([folder]) },
          { pathNot: [`^packages/${name}/`, ...exact(exempt[folder])] },
        ),
      ),
    ];
  });

/** @type {import('dependency-cruiser').IConfiguration} */
const config = {
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
    ...packageCycles(typeOnlyCycleEdges),
    {
      name: 'client-server-type-only',
      comment:
        'packages/client imports only types from packages/server, plus the dependency-free @interlock/server/transport module.',
      severity: 'error',
      from: { path: '^packages/client/' },
      to: {
        path: ['^packages/server/', '^@interlock/server(/|$)'],
        pathNot: '^packages/server/src/transport\\.ts$',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import must resolve to a file or an installed module.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
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
    // Build output such as packages/ui/dist is not source.
    exclude: { path: '^packages/[^/]+/dist/' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.d.ts'],
    },
  },
};
export default config;
