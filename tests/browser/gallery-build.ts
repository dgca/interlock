import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    galleryUi: string;
  }
}

/** Builds the development-only gallery separately from the packaged UI. */
export default async function setup(project: TestProject) {
  const outDir = await mkdtemp(join(tmpdir(), 'interlock-gallery-'));
  execFileSync(
    'pnpm',
    [
      '--filter',
      '@interlock/ui',
      'exec',
      'vite',
      'build',
      '--mode',
      'gallery',
      '--outDir',
      outDir,
      '--emptyOutDir',
      '--logLevel',
      'error',
    ],
    { stdio: 'inherit' },
  );
  project.provide('galleryUi', outDir);
  return () => rm(outDir, { recursive: true, force: true });
}
