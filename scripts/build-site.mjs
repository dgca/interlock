import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../.site-build/', import.meta.url);
const result = spawnSync('pnpm', ['--filter', '@interlock/docs', 'build'], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL('../site/', import.meta.url), output, { recursive: true });
// This file documents the source folder, rather than the published website.
await rm(new URL('README.md', output));
await cp(
  new URL('../website/build/', import.meta.url),
  new URL('docs/', output),
  {
    recursive: true,
  },
);
// GitHub Pages looks for a project-level 404 page, even for nested docs routes.
await cp(
  new URL('../website/build/404.html', import.meta.url),
  new URL('404.html', output),
);
await import('./check-site.mjs');
console.log('Built marketing and documentation into .site-build/');
