import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

// Node-only. Keep this out of the browser entry point.
export interface ResolvedPath {
  path: string;
  source: string;
}

export function interlockConfigDir(
  platform = process.platform,
  home = homedir(),
  xdgConfigHome = process.env.XDG_CONFIG_HOME,
) {
  return platform === 'darwin'
    ? join(home, 'Library/Application Support/Interlock')
    : join(xdgConfigHome || join(home, '.config'), 'interlock');
}

export function resolveDataPaths(
  options: {
    database?: ResolvedPath;
    resolveDatabasePath?: boolean;
    defaultDatabase?: ResolvedPath;
    secretKeyFile?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    home?: string;
  } = {},
) {
  const {
    env = process.env,
    platform = process.platform,
    home = homedir(),
  } = options;
  const configured = env.INTERLOCK_DATA_DIR;
  if (configured !== undefined && !isAbsolute(configured))
    throw new Error('INTERLOCK_DATA_DIR must be an absolute path.');
  const dataDir = configured === undefined ? undefined : resolve(configured);
  const selectedDatabase = options.database ??
    (env.INTERLOCK_DB !== undefined
      ? { path: env.INTERLOCK_DB, source: 'INTERLOCK_DB' }
      : undefined) ??
    (dataDir
      ? { path: join(dataDir, 'interlock.db'), source: 'INTERLOCK_DATA_DIR' }
      : undefined) ??
    options.defaultDatabase ?? {
      path: join(home, '.interlock/interlock.db'),
      source: 'home default',
    };
  const database = options.resolveDatabasePath
    ? { ...selectedDatabase, path: resolve(selectedDatabase.path) }
    : selectedDatabase;
  const fileBacked = database.path !== ':memory:';
  const databaseFile = fileBacked ? resolve(database.path) : database.path;
  const databaseDir = dirname(resolve(database.path));
  const xdgConfigHome = env.XDG_CONFIG_HOME;
  const configDir =
    dataDir ?? interlockConfigDir(platform, home, xdgConfigHome ?? '');
  const keysDir = join(configDir, 'keys');
  const keysSource = dataDir
    ? 'INTERLOCK_DATA_DIR'
    : platform !== 'darwin' && xdgConfigHome
      ? 'XDG_CONFIG_HOME'
      : 'platform default';
  const keyFile =
    options.secretKeyFile ??
    (fileBacked ? env.INTERLOCK_SECRET_KEY_FILE : undefined);
  const tokenKeyFile = env.INTERLOCK_SECRET_KEY_FILE;
  const legacyTokenOverride = !dataDir && tokenKeyFile;
  const tokenEnv: Record<string, string> = {};
  if (dataDir) tokenEnv.INTERLOCK_DATA_DIR = dataDir;
  else if (legacyTokenOverride)
    tokenEnv.INTERLOCK_SECRET_KEY_FILE = resolve(tokenKeyFile);
  else if (keysSource === 'XDG_CONFIG_HOME' && xdgConfigHome)
    tokenEnv.XDG_CONFIG_HOME = resolve(xdgConfigHome);

  return {
    dataDir,
    database,
    configFile:
      env.INTERLOCK_CONFIG === undefined
        ? { path: join(configDir, 'config.json'), source: keysSource }
        : { path: env.INTERLOCK_CONFIG, source: 'INTERLOCK_CONFIG' },
    keysDir: { path: keysDir, source: keysSource },
    keyFile:
      keyFile === undefined
        ? undefined
        : {
            path: keyFile,
            source:
              options.secretKeyFile === undefined
                ? 'INTERLOCK_SECRET_KEY_FILE'
                : 'explicit store option',
          },
    token: legacyTokenOverride
      ? {
          path: join(dirname(resolve(tokenKeyFile)), 'api-token'),
          source: 'INTERLOCK_SECRET_KEY_FILE',
        }
      : { path: join(keysDir, 'api-token'), source: keysSource },
    spool: dataDir
      ? { path: join(dataDir, 'script-spool'), source: 'INTERLOCK_DATA_DIR' }
      : {
          path: `${databaseFile}.scripts`,
          source: `database path (${database.source})`,
        },
    workspaces: {
      path: join(dataDir ?? databaseDir, 'workspaces'),
      source: dataDir
        ? 'INTERLOCK_DATA_DIR'
        : `database path (${database.source})`,
    },
    trialRoot: join(dataDir ?? databaseDir, 'evaluation-trials'),
    logRoot: join(dataDir ?? dirname(database.path), 'logs'),
    tokenEnv,
  };
}

export type DataPaths = ReturnType<typeof resolveDataPaths>;
