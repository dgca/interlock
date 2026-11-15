import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Engine } from '@interlock/runtime';
import type { Store } from '@interlock/storage';
import { readApiToken } from '@interlock/core/apiToken';
import * as serverStart from '@interlock/server/start';
import { resolveBundledCliWrapper } from './cliInstall.js';

export interface ConnectionConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  engineUrl: string;
  development: boolean;
  fallback?: { command: string; args: string[] };
  token?: string;
  requireToken?: boolean;
}

export function defaultDesktopConnection(
  engineUrl: string,
  fallbackCommand = resolveBundledCliWrapper(),
): ConnectionConfig {
  return {
    command: 'interlock',
    args: ['mcp'],
    development: false,
    engineUrl,
    env: {
      INTERLOCK_URL: engineUrl,
    },
    fallback: {
      command: fallbackCommand,
      args: ['mcp'],
    },
  };
}

export interface ServerHandle {
  engine: Engine;
  store: Store;
  server: { close: (callback?: (err?: Error) => void) => void };
  connection: ConnectionConfig;
  stop: () => Promise<void>;
}

export type StartServerFunction = (options: {
  database: string;
  workdir: string;
  ui: string;
  port: number;
  connection: ConnectionConfig;
  allowedRoots?: string[];
  syncDir?: string;
  hostname?: string;
  handleSignals?: boolean;
}) => Promise<ServerHandle>;

export type EngineMode = 'owned' | 'attached' | 'stopped';

export interface LifecycleState {
  mode: 'owned' | 'attached';
  uiUrl: string;
  engineUrl: string;
}

export interface DesktopLifecycleOptions {
  port?: number;
  database?: string;
  workdir: string;
  ui: string;
  connection?: ConnectionConfig;
  monitorIntervalMs?: number;
  probeHealth?: (engineUrl: string, timeoutMs?: number) => Promise<boolean>;
  isLocked?: (database: string) => boolean;
  startServer?: StartServerFunction;
  readToken?: (path?: string) => string | undefined;
  onStateChange?: (state: LifecycleState) => void;
  onError?: (error: Error) => void;
}

export async function defaultProbeHealthyServer(
  engineUrl: string,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const res = await fetch(`${engineUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function defaultIsDatabaseLocked(database: string): boolean {
  if (database === ':memory:') return false;
  const path = `${database}.lock`;
  try {
    const lock = new DatabaseSync(path);
    try {
      lock.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE');
      lock.exec('ROLLBACK');
    } finally {
      lock.close();
    }
    return false;
  } catch (error) {
    if (/locked|busy/i.test(error instanceof Error ? error.message : '')) {
      return true;
    }
    return false;
  }
}

export class DesktopEngineLifecycle {
  private mode: EngineMode = 'stopped';
  private port: number;
  private database: string;
  private engineUrl: string;
  private uiUrl = '';
  private ownedServer?: ServerHandle;
  private monitorTimer?: NodeJS.Timeout;
  private isStopping = false;
  private isTakingOver = false;
  private pendingWorkdir?: string;

  private probeHealth: (
    engineUrl: string,
    timeoutMs?: number,
  ) => Promise<boolean>;
  private isLocked: (database: string) => boolean;
  private startServerFn: StartServerFunction;
  private readTokenFn: (path?: string) => string | undefined;

  constructor(private readonly options: DesktopLifecycleOptions) {
    this.port = options.port ?? Number(process.env.INTERLOCK_PORT ?? 4310);
    this.database =
      options.database ??
      process.env.INTERLOCK_DB ??
      join(homedir(), '.interlock/interlock.db');
    this.engineUrl = `http://127.0.0.1:${this.port}`;

    const serverModule = serverStart as Record<string, unknown>;

    this.probeHealth =
      options.probeHealth ??
      (typeof serverModule.probeHealthyServer === 'function'
        ? (serverModule.probeHealthyServer as (
            url: string,
            ms?: number,
          ) => Promise<boolean>)
        : defaultProbeHealthyServer);

    this.isLocked =
      options.isLocked ??
      (typeof serverModule.isDatabaseLocked === 'function'
        ? (serverModule.isDatabaseLocked as (db: string) => boolean)
        : defaultIsDatabaseLocked);

    this.startServerFn =
      options.startServer ?? (serverModule.startServer as StartServerFunction);

    this.readTokenFn = options.readToken ?? readApiToken;
  }

  getMode(): EngineMode {
    return this.mode;
  }

  getEngineUrl(): string {
    return this.engineUrl;
  }

  getUiUrl(): string {
    return this.uiUrl;
  }

  getPort(): number {
    return this.port;
  }

  getDatabase(): string {
    return this.database;
  }

  getWorkdir(): string {
    return this.options.workdir;
  }

  getPendingWorkdir(): string | undefined {
    return this.pendingWorkdir;
  }

  getOwnedEngine(): Engine | undefined {
    return this.ownedServer?.engine;
  }

  getOwnedStore(): Store | undefined {
    return this.ownedServer?.store;
  }

  async start(): Promise<LifecycleState> {
    this.isStopping = false;
    const isHealthy = await this.probeHealth(this.engineUrl, 1500);

    if (isHealthy) {
      this.mode = 'attached';
      const token = this.readTokenFn();
      this.uiUrl = token
        ? `${this.engineUrl}/?token=${encodeURIComponent(token)}`
        : this.engineUrl;
      this.startMonitoring();
      return {
        mode: 'attached',
        uiUrl: this.uiUrl,
        engineUrl: this.engineUrl,
      };
    }

    const conn: ConnectionConfig =
      this.options.connection ?? defaultDesktopConnection(this.engineUrl);

    this.ownedServer = await this.startServerFn({
      port: this.port,
      database: this.database,
      workdir: this.options.workdir,
      ui: this.options.ui,
      connection: conn,
      handleSignals: false,
    });

    this.mode = 'owned';
    const activeConn = this.ownedServer.connection;
    this.uiUrl =
      activeConn.requireToken && activeConn.token
        ? `${this.engineUrl}/?token=${encodeURIComponent(activeConn.token)}`
        : this.engineUrl;

    this.startMonitoring();
    return {
      mode: 'owned',
      uiUrl: this.uiUrl,
      engineUrl: this.engineUrl,
    };
  }

  activeRunCount(): number {
    if (this.mode === 'owned' && this.ownedServer) {
      return this.ownedServer.store.activeRuns().length;
    }
    return 0;
  }

  async updateWorkdir(
    newWorkdir: string,
  ): Promise<{ restarted: boolean; deferred: boolean }> {
    this.options.workdir = newWorkdir;

    if (this.mode === 'owned' && this.ownedServer) {
      if (this.activeRunCount() === 0) {
        await this.ownedServer.stop();
        const conn: ConnectionConfig =
          this.options.connection ?? defaultDesktopConnection(this.engineUrl);
        this.ownedServer = await this.startServerFn({
          port: this.port,
          database: this.database,
          workdir: this.options.workdir,
          ui: this.options.ui,
          connection: conn,
          handleSignals: false,
        });
        const activeConn = this.ownedServer.connection;
        this.uiUrl =
          activeConn.requireToken && activeConn.token
            ? `${this.engineUrl}/?token=${encodeURIComponent(activeConn.token)}`
            : this.engineUrl;
        this.pendingWorkdir = undefined;
        return { restarted: true, deferred: false };
      }
      this.pendingWorkdir = newWorkdir;
      return { restarted: false, deferred: true };
    }

    return { restarted: false, deferred: false };
  }

  async poll(): Promise<void> {
    await this.checkHealth();
  }

  private startMonitoring(): void {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    const intervalMs = this.options.monitorIntervalMs ?? 1500;
    this.monitorTimer = setInterval(() => {
      void this.checkHealth();
    }, intervalMs);
    this.monitorTimer.unref();
  }

  private async checkHealth(): Promise<void> {
    if (this.isStopping) return;

    if (this.mode === 'attached') {
      if (this.isTakingOver) return;
      const isHealthy = await this.probeHealth(this.engineUrl, 1000);
      if (!isHealthy) {
        await this.handleAttachedServerStopped();
      }
    } else if (this.mode === 'owned') {
      if (this.pendingWorkdir && this.activeRunCount() === 0) {
        const nextWorkdir = this.pendingWorkdir;
        this.pendingWorkdir = undefined;
        await this.updateWorkdir(nextWorkdir);
      }
    }
  }

  private async handleAttachedServerStopped(): Promise<void> {
    if (this.isStopping || this.mode !== 'attached') return;
    this.isTakingOver = true;

    for (let i = 0; i < 25; i++) {
      if (this.isStopping) return;
      if (!this.isLocked(this.database)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.isStopping) return;

    try {
      const conn: ConnectionConfig =
        this.options.connection ?? defaultDesktopConnection(this.engineUrl);
      this.ownedServer = await this.startServerFn({
        port: this.port,
        database: this.database,
        workdir: this.options.workdir,
        ui: this.options.ui,
        connection: conn,
        handleSignals: false,
      });
      this.mode = 'owned';
      const activeConn = this.ownedServer.connection;
      this.uiUrl =
        activeConn.requireToken && activeConn.token
          ? `${this.engineUrl}/?token=${encodeURIComponent(activeConn.token)}`
          : this.engineUrl;

      this.options.onStateChange?.({
        mode: 'owned',
        uiUrl: this.uiUrl,
        engineUrl: this.engineUrl,
      });
    } catch (err) {
      this.options.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      this.isTakingOver = false;
    }
  }

  async stop(): Promise<void> {
    this.isStopping = true;
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = undefined;
    }

    if (this.mode === 'owned' && this.ownedServer) {
      await this.ownedServer.stop();
      this.ownedServer = undefined;
    }

    this.mode = 'stopped';
  }
}
