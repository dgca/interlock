import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, chmod, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['packages/cli/src/bin.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: {
    js: "import { createRequire as interlockCreateRequire } from 'node:module'; const require = interlockCreateRequire(import.meta.url);",
  },
  legalComments: 'linked',
});
await chmod('dist/cli.js', 0o755);
await cp('packages/ui/dist', 'dist/ui', { recursive: true });

// dist/cli.js bundles the Claude Agent SDK's /core entry, which is not MIT
// licensed. Ship its license text unchanged next to the bundle.
const sdkDir = dirname(
  createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk/core'),
);
const sdk = JSON.parse(await readFile(join(sdkDir, 'package.json'), 'utf8'));
const sdkLicense = await readFile(join(sdkDir, 'LICENSE.md'), 'utf8');
await mkdir('dist/licenses', { recursive: true });
await writeFile(
  'dist/licenses/claude-agent-sdk.md',
  `# ${sdk.name} ${sdk.version}\n\n` +
    'dist/cli.js includes code from this package. That code is not covered by ' +
    "Interlock's MIT license. Its license, copied from the package's LICENSE.md:\n\n" +
    `${sdkLicense.trim()}\n`,
);
