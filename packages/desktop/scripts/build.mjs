import { build } from 'esbuild';
import { chmod, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const desktopRoot = resolve(import.meta.dirname, '..');
const distDir = resolve(desktopRoot, 'dist');
const binInterlock = resolve(desktopRoot, 'bin/interlock');

await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [resolve(desktopRoot, 'src/main.ts')],
  outfile: resolve(distDir, 'main.js'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['electron'],
  banner: {
    js: "import { createRequire as interlockCreateRequire } from 'node:module'; const require = interlockCreateRequire(import.meta.url);",
  },
});

try {
  await chmod(binInterlock, 0o755);
} catch {
  // Ignore chmod error if already executable or unavailable
}
