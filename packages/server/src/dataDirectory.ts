import { accessSync, constants, mkdirSync } from 'node:fs';
import type { DataPaths } from '@interlock/core/dataPaths';

/** Create the configured data directory, or fail before anything else is written. */
export function prepareDataDirectory(paths: DataPaths) {
  const directory = paths.dataDir;
  if (directory === undefined) return;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    accessSync(directory, constants.W_OK | constants.X_OK);
  } catch (error) {
    throw new Error(
      `Cannot use INTERLOCK_DATA_DIR ${directory}. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
