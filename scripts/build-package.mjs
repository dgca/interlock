import { build } from 'esbuild';
import { cp, mkdir, rm, chmod } from 'node:fs/promises';

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
