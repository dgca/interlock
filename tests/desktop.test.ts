import { describe, expect, it, vi } from 'vitest';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fallbackMacPath,
  hydrateProcessEnv,
  parseDelimitedEnv,
  resolveLoginShellEnv,
} from '../packages/desktop/src/shellEnv.js';
import {
  desktopSettingsPath,
  readDesktopSettings,
  resolveDesktopWorkdir,
  writeDesktopSettings,
} from '../packages/desktop/src/settings.js';
import {
  DesktopEngineLifecycle,
  defaultDesktopConnection,
  defaultIsDatabaseLocked,
  defaultProbeHealthyServer,
  type ConnectionConfig,
  type ServerHandle,
} from '../packages/desktop/src/lifecycle.js';
import {
  AttentionNotificationTracker,
  createAttachedSnapshotProvider,
  createOwnedSnapshot,
  getAttentionRequestKey,
  type AttentionRequestItem,
  type AttentionSnapshot,
  type AttentionTarget,
  type FailedRunItem,
  type NotificationItem,
} from '../packages/desktop/src/notifications.js';
import {
  installCliCommandInPath,
  resolveBundledCliWrapper,
} from '../packages/desktop/src/cliInstall.js';
import { createDesktopBuilderConfig } from '../packages/desktop/src/builderConfig.js';
import {
  DesktopUpdater,
  type UpdaterInfo,
  type UpdaterLike,
} from '../packages/desktop/src/updater.js';
import {
  DESKTOP_VERSION,
  buildAppMenuTemplate,
  buildTrayMenuTemplate,
} from '../packages/desktop/src/menu.js';
import { VERSION } from '@interlock/core/version';
import {
  createMainWindow,
  navigateToRun,
  shouldConfirmQuit,
} from '../packages/desktop/src/window.js';

describe('shellEnv', () => {
  it('parses null-delimited environment output and handles equals in values', () => {
    const raw =
      'noise\n__INTERLOCK_ENV_START__FOO=bar\0MULTI=a=b=c\0EMPTY=\0__INTERLOCK_ENV_END__tail';
    const parsed = parseDelimitedEnv(raw);
    expect(parsed).toEqual({
      FOO: 'bar',
      MULTI: 'a=b=c',
      EMPTY: '',
    });
  });

  it('falls back to newline delimiters and handles missing markers', () => {
    const rawNewline =
      '__INTERLOCK_ENV_START__\nA=1\nB=2\n__INTERLOCK_ENV_END__';
    expect(parseDelimitedEnv(rawNewline)).toEqual({ A: '1', B: '2' });
    expect(parseDelimitedEnv('No markers here')).toEqual({});
  });

  it('ensures standard macOS directories exist in PATH without duplicates', () => {
    const home = '/Users/testuser';
    const current = '/usr/bin:/bin:/opt/homebrew/bin:/usr/bin';
    const result = fallbackMacPath(current, home);
    const parts = result.split(':');

    expect(parts).toContain('/opt/homebrew/bin');
    expect(parts).toContain('/opt/homebrew/sbin');
    expect(parts).toContain('/usr/local/bin');
    expect(parts).toContain(`${home}/.local/bin`);
    expect(parts.filter((p) => p === '/opt/homebrew/bin')).toHaveLength(1);
    expect(parts.filter((p) => p === '/usr/bin')).toHaveLength(1);
  });

  it('resolves login shell env on darwin, preserves INTERLOCK_* and falls back on error', () => {
    const runShell = vi
      .fn()
      .mockReturnValue(
        '__INTERLOCK_ENV_START__PATH=/usr/bin\0SHELL_VAR=yes\0INTERLOCK_DB=/from/shell\0__INTERLOCK_ENV_END__',
      );

    const resolved = resolveLoginShellEnv({
      platform: 'darwin',
      env: {
        PATH: '/bin',
        INTERLOCK_PORT: '9999',
        INTERLOCK_DB: '/explicit/db',
      },
      home: '/Users/testuser',
      runShell,
    });

    expect(runShell).toHaveBeenCalledTimes(1);
    expect(resolved.SHELL_VAR).toBe('yes');
    expect(resolved.INTERLOCK_PORT).toBe('9999');
    expect(resolved.INTERLOCK_DB).toBe('/explicit/db');
    expect(resolved.PATH).toContain('/opt/homebrew/bin');

    const nonDarwin = resolveLoginShellEnv({
      platform: 'linux',
      env: { CUSTOM: 'linux_value' },
    });
    expect(nonDarwin.CUSTOM).toBe('linux_value');

    const failingRun = vi.fn().mockImplementation(() => {
      throw new Error('timeout');
    });
    const fallback = resolveLoginShellEnv({
      platform: 'darwin',
      env: { PATH: '/usr/bin', INTERLOCK_VAR: 'stay' },
      home: '/Users/testuser',
      runShell: failingRun,
    });
    expect(fallback.INTERLOCK_VAR).toBe('stay');
    expect(fallback.PATH).toContain('/opt/homebrew/bin');
  });

  it('hydrates process.env with resolved login shell variables', () => {
    const originalFoo = process.env.INTERLOCK_TEST_HYDRATE;
    try {
      hydrateProcessEnv({
        platform: 'darwin',
        env: { PATH: '/bin' },
        runShell: () =>
          '__INTERLOCK_ENV_START__INTERLOCK_TEST_HYDRATE=hydrated\0__INTERLOCK_ENV_END__',
      });
      expect(process.env.INTERLOCK_TEST_HYDRATE).toBe('hydrated');
    } finally {
      if (originalFoo === undefined) {
        delete process.env.INTERLOCK_TEST_HYDRATE;
      } else {
        process.env.INTERLOCK_TEST_HYDRATE = originalFoo;
      }
    }
  });
});

describe('settings & workdir', () => {
  it('reads and writes desktop settings file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'desktop-settings-test-'));
    try {
      expect(readDesktopSettings(tempDir)).toEqual({});
      const written = writeDesktopSettings(
        { workdir: '/test/workdir' },
        tempDir,
      );
      expect(written.workdir).toBe('/test/workdir');
      expect(readDesktopSettings(tempDir)).toEqual({
        workdir: '/test/workdir',
      });
      expect(desktopSettingsPath(tempDir)).toBe(
        join(tempDir, 'desktop-settings.json'),
      );

      writeFileSync(join(tempDir, 'desktop-settings.json'), '{ invalid json');
      expect(readDesktopSettings(tempDir)).toEqual({});
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves desktop workdir in precedence order without defaulting to /', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'desktop-workdir-test-'));
    const envDir = join(tempDir, 'env-dir');
    const settingsDir = join(tempDir, 'settings-dir');
    const homeDir = join(tempDir, 'home-dir');

    mkdirSync(envDir, { recursive: true });
    mkdirSync(settingsDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });

    try {
      writeDesktopSettings({ workdir: settingsDir }, tempDir);

      const withEnv = resolveDesktopWorkdir({
        envWorkdir: envDir,
        configDir: tempDir,
        home: homeDir,
        cwd: '/',
      });
      expect(withEnv).toBe(envDir);

      const withSettings = resolveDesktopWorkdir({
        envWorkdir: '/non/existent/path',
        configDir: tempDir,
        home: homeDir,
        cwd: '/',
      });
      expect(withSettings).toBe(settingsDir);

      const withHome = resolveDesktopWorkdir({
        envWorkdir: '/non/existent',
        configDir: join(tempDir, 'empty-config'),
        home: homeDir,
        cwd: '/',
      });
      expect(withHome).toBe(homeDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('lifecycle', () => {
  function makeMockServer(activeRuns = 0): ServerHandle {
    return {
      engine: {} as never,
      store: {
        activeRuns: () =>
          Array.from({ length: activeRuns }, (_, i) => ({ id: `run-${i}` })),
      } as never,
      server: { close: vi.fn() },
      connection: defaultDesktopConnection('http://127.0.0.1:4310'),
      stop: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('starts in owned mode when engine is unhealthy', async () => {
    const mockServer = makeMockServer(1);
    const startServerFn = vi.fn().mockResolvedValue(mockServer);

    const lifecycle = new DesktopEngineLifecycle({
      port: 4310,
      database: ':memory:',
      workdir: '/tmp',
      ui: '/tmp/ui',
      probeHealth: vi.fn().mockResolvedValue(false),
      startServer: startServerFn,
    });

    const state = await lifecycle.start();
    expect(state.mode).toBe('owned');
    expect(startServerFn).toHaveBeenCalledTimes(1);
    expect(lifecycle.activeRunCount()).toBe(1);

    await lifecycle.stop();
    expect(mockServer.stop).toHaveBeenCalledTimes(1);
  });

  it('starts in attached mode when engine is healthy and does not stop external server', async () => {
    const startServerFn = vi.fn();
    const lifecycle = new DesktopEngineLifecycle({
      port: 4310,
      database: ':memory:',
      workdir: '/tmp',
      ui: '/tmp/ui',
      probeHealth: vi.fn().mockResolvedValue(true),
      readToken: () => 'test-token',
      startServer: startServerFn,
    });

    const state = await lifecycle.start();
    expect(state.mode).toBe('attached');
    expect(state.uiUrl).toContain('token=test-token');
    expect(startServerFn).not.toHaveBeenCalled();
    expect(lifecycle.activeRunCount()).toBe(0);

    await lifecycle.stop();
    expect(startServerFn).not.toHaveBeenCalled();
  });

  it('takes over from attached to owned mode when external server stops', async () => {
    let healthy = true;
    const mockServer = makeMockServer(0);
    const startServerFn = vi.fn().mockResolvedValue(mockServer);
    const stateChanges: string[] = [];

    const lifecycle = new DesktopEngineLifecycle({
      port: 4310,
      database: ':memory:',
      workdir: '/tmp',
      ui: '/tmp/ui',
      probeHealth: vi.fn().mockImplementation(() => Promise.resolve(healthy)),
      isLocked: vi.fn().mockReturnValue(false),
      startServer: startServerFn,
      onStateChange: (s) => stateChanges.push(s.mode),
    });

    const initial = await lifecycle.start();
    expect(initial.mode).toBe('attached');

    healthy = false;
    await lifecycle.poll();

    expect(lifecycle.getMode()).toBe('owned');
    expect(startServerFn).toHaveBeenCalledTimes(1);
    expect(stateChanges).toContain('owned');

    await lifecycle.stop();
  });

  it('restarts owned server on workdir update when idle, or defers when runs active', async () => {
    const server1 = makeMockServer(2);
    const server2 = makeMockServer(0);
    const startServerFn = vi
      .fn()
      .mockResolvedValueOnce(server1)
      .mockResolvedValueOnce(server2);

    const lifecycle = new DesktopEngineLifecycle({
      port: 4310,
      database: ':memory:',
      workdir: '/initial',
      ui: '/tmp/ui',
      probeHealth: vi.fn().mockResolvedValue(false),
      startServer: startServerFn,
    });

    await lifecycle.start();
    const deferredRes = await lifecycle.updateWorkdir('/deferred-dir');
    expect(deferredRes).toEqual({ restarted: false, deferred: true });
    expect(lifecycle.getPendingWorkdir()).toBe('/deferred-dir');

    server1.store.activeRuns = () => [];
    await lifecycle.poll();

    expect(lifecycle.getWorkdir()).toBe('/deferred-dir');
    expect(lifecycle.getPendingWorkdir()).toBeUndefined();
    expect(server1.stop).toHaveBeenCalled();
    expect(startServerFn).toHaveBeenCalledTimes(2);

    await lifecycle.stop();
  });

  it('evaluates shouldConfirmQuit correctly for owned vs attached modes', () => {
    expect(shouldConfirmQuit('owned', 3)).toBe(true);
    expect(shouldConfirmQuit('owned', 0)).toBe(false);
    expect(shouldConfirmQuit('attached', 3)).toBe(false);
    expect(shouldConfirmQuit('stopped', 3)).toBe(false);
  });

  it('default probe and lock helpers work correctly', async () => {
    expect(defaultIsDatabaseLocked(':memory:')).toBe(false);
    const healthy = await defaultProbeHealthyServer(
      'http://127.0.0.1:99999',
      50,
    );
    expect(healthy).toBe(false);
    const conn: ConnectionConfig = defaultDesktopConnection(
      'http://127.0.0.1:4310',
    );
    expect(conn.engineUrl).toBe('http://127.0.0.1:4310');
    expect(conn.command).toBe('interlock');
    expect(conn.args).toEqual(['mcp']);
    expect(conn.fallback?.args).toEqual(['mcp']);
  });
});

describe('notifications & dock badge', () => {
  it('sets initial baseline on first evaluation without firing notifications', async () => {
    const setDockBadge = vi.fn();
    const notify = vi.fn();

    const snapshot: AttentionSnapshot = {
      attentionRequests: [
        {
          target: { kind: 'permission', runId: 'run-1', executionId: 'exec-1' },
          reason: 'Need approval',
        },
      ],
      failedRuns: [{ id: 'run-fail-1', error: 'boom' }],
    };

    const tracker = new AttentionNotificationTracker({
      snapshotProvider: () => snapshot,
      setDockBadge,
      isWindowFocused: () => false,
      notify,
    });

    await tracker.evaluate();
    expect(setDockBadge).toHaveBeenCalledWith('1');
    expect(notify).not.toHaveBeenCalled();
    expect(tracker.isInitialized()).toBe(true);
  });

  it('emits notifications for new attention items or failed runs when window is unfocused', async () => {
    const notify = vi.fn();
    const setDockBadge = vi.fn();
    let focused = false;

    const snapshot: AttentionSnapshot = {
      attentionRequests: [],
      failedRuns: [],
    };

    const tracker = new AttentionNotificationTracker({
      snapshotProvider: () => snapshot,
      setDockBadge,
      isWindowFocused: () => focused,
      notify,
    });

    await tracker.evaluate();
    expect(setDockBadge).toHaveBeenCalledWith('');

    snapshot.attentionRequests.push({
      target: { kind: 'permission', runId: 'run-2', executionId: 'exec-2' },
      reason: 'Approval needed',
    });
    snapshot.failedRuns.push({ id: 'run-3', error: 'Process exited 1' });

    await tracker.evaluate();
    expect(setDockBadge).toHaveBeenCalledWith('1');
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-2', kind: 'attention' }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-3', kind: 'failed' }),
    );

    focused = true;
    snapshot.failedRuns.push({ id: 'run-4', error: 'Process exited 2' });
    await tracker.evaluate();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('invokes onNavigateToRun when notification click is handled', () => {
    const onNavigateToRun = vi.fn();
    const tracker = new AttentionNotificationTracker({
      snapshotProvider: () => ({ attentionRequests: [], failedRuns: [] }),
      setDockBadge: vi.fn(),
      isWindowFocused: () => false,
      notify: vi.fn(),
      onNavigateToRun,
    });

    tracker.handleClick('run-navigate-123');
    expect(onNavigateToRun).toHaveBeenCalledWith('run-navigate-123');
  });

  it('generates attention request keys and supports attached provider', async () => {
    const target: AttentionTarget = {
      kind: 'permission',
      runId: 'run-k',
      executionId: 'exec-k',
      requestId: 'req-k',
    };
    const reqItem: AttentionRequestItem = { target };
    expect(getAttentionRequestKey(reqItem)).toBe(
      'permission:run-k:exec-k:req-k',
    );

    const notifItem: NotificationItem = {
      title: 'T',
      body: 'B',
      runId: 'run-k',
      kind: 'attention',
    };
    expect(notifItem.kind).toBe('attention');

    const failedItem: FailedRunItem = { id: 'fail-x', error: 'err' };
    expect(failedItem.id).toBe('fail-x');

    const provider = createAttachedSnapshotProvider('http://127.0.0.1:99999');
    const snapshot = await provider();
    expect(snapshot.failedRuns).toEqual([]);

    const ownedSnap = createOwnedSnapshot(
      {
        requests: {
          current: () => [
            {
              cardId: 'card-1',
              target: {
                kind: 'permission',
                runId: 'run-1',
                executionId: 'exec-1',
              },
              label: 'Allow bash',
              since: '2026-01-01T00:00:00Z',
            },
          ],
        },
      } as never,
      {
        runs: () => [
          {
            id: 'run-fail-1',
            status: 'failed',
            title: 'My Run',
            error: 'Failed step',
          },
        ],
      } as never,
    );
    expect(ownedSnap.attentionRequests[0].label).toBe('Allow bash');
    expect(ownedSnap.failedRuns[0].id).toBe('run-fail-1');
  });
});

describe('window & navigation', () => {
  it('creates main window with prevention of quit on close', () => {
    let isQuitting = false;
    const listeners: Record<
      string,
      ((event?: { preventDefault: () => void }) => void)[]
    > = {};
    const winMock = {
      show: vi.fn(),
      hide: vi.fn(),
      once: (event: string, fn: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      on: (event: string, fn: (e?: { preventDefault: () => void }) => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      loadURL: vi.fn().mockResolvedValue(undefined),
    };

    const ctor = vi.fn().mockImplementation(() => winMock);

    const win = createMainWindow({
      uiUrl: 'http://127.0.0.1:4310',
      isQuitting: () => isQuitting,
      BrowserWindowConstructor: ctor as never,
    });

    expect(win).toBe(winMock);
    expect(winMock.loadURL).toHaveBeenCalledWith('http://127.0.0.1:4310');

    const preventDefault = vi.fn();
    listeners.close?.[0]({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(winMock.hide).toHaveBeenCalled();

    isQuitting = true;
    const preventDefault2 = vi.fn();
    listeners.close?.[0]({ preventDefault: preventDefault2 });
    expect(preventDefault2).not.toHaveBeenCalled();
  });

  it('navigates to run using SPA history pushState when on matching origin', async () => {
    const executedScripts: string[] = [];
    const winMock = {
      isVisible: () => true,
      show: vi.fn(),
      hide: vi.fn(),
      focus: vi.fn(),
      loadURL: vi.fn().mockResolvedValue(undefined),
      webContents: {
        getURL: () => 'http://127.0.0.1:4310/',
        executeJavaScript: vi.fn().mockImplementation((script: string) => {
          executedScripts.push(script);
          return Promise.resolve();
        }),
      },
      on: vi.fn(),
    };

    await navigateToRun(winMock, 'http://127.0.0.1:4310', 'test-run-id');
    expect(winMock.focus).toHaveBeenCalled();
    expect(executedScripts).toHaveLength(1);
    expect(executedScripts[0]).toContain('/runs/test-run-id');
    expect(winMock.loadURL).not.toHaveBeenCalled();

    const winOther = {
      ...winMock,
      webContents: {
        ...winMock.webContents,
        getURL: () => 'about:blank',
      },
    };
    await navigateToRun(winOther, 'http://127.0.0.1:4310', 'run-external');
    expect(winOther.loadURL).toHaveBeenCalledWith(
      'http://127.0.0.1:4310/runs/run-external',
    );
  });
});

describe('cliInstall & bin wrapper', () => {
  it('has executable bin/interlock shell wrapper', () => {
    const binPath = resolveBundledCliWrapper({ isPackaged: false });
    const stat = statSync(binPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o111).not.toBe(0);
  });

  it('configures electron-builder with appId and mac targets', () => {
    const electronBuilderConfig = createDesktopBuilderConfig();
    expect(electronBuilderConfig.appId).toBe('com.typeof.interlock');
    expect(electronBuilderConfig.productName).toBe('Interlock');
    expect(electronBuilderConfig.buildVersion).toBe(VERSION);
    expect(electronBuilderConfig.mac.target).toEqual([
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ]);
  });

  it('installs symlink in target directory and supports administrator fallback', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'cli-install-test-'));
    const sourcePath = join(tempDir, 'source-interlock');
    const targetPath = join(tempDir, 'bin', 'interlock');
    writeFileSync(sourcePath, '#!/bin/sh\n');

    try {
      const res = installCliCommandInPath({ sourcePath, targetPath });
      expect(res.installedPath).toBe(targetPath);
      expect(statSync(targetPath).isFile()).toBe(true);

      const readOnlyDir = join(tempDir, 'readonly');
      mkdirSync(readOnlyDir, { recursive: true });
      chmodSync(readOnlyDir, 0o555);

      const execAdmin = vi.fn();
      const errorRes = installCliCommandInPath({
        sourcePath,
        targetPath: join(readOnlyDir, 'sub', 'interlock'),
        execAdmin,
      });
      expect(execAdmin).toHaveBeenCalled();
      expect(errorRes.installedPath).toBe(
        join(readOnlyDir, 'sub', 'interlock'),
      );
      chmodSync(readOnlyDir, 0o755);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('updater', () => {
  interface MockUpdater extends UpdaterLike {
    trigger: (e: string, ...args: unknown[]) => void;
  }

  function makeMockUpdater(): MockUpdater {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
    return {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn(),
      on: (event: string, fn: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      trigger: (event: string, ...args: unknown[]) => {
        for (const l of listeners[event] || []) l(...args);
      },
    };
  }

  it('defers update restart when runs are active, and applies when runs finish', async () => {
    const mock = makeMockUpdater();
    let activeRuns = 2;
    const beforeRestart = vi.fn();
    const statusHistory: string[] = [];

    const updater = new DesktopUpdater({
      updater: mock,
      getActiveRunCount: () => activeRuns,
      beforeRestart,
      onStatusChange: (s) => statusHistory.push(s.state),
    });

    expect(mock.autoDownload).toBe(true);
    expect(mock.autoInstallOnAppQuit).toBe(true);

    mock.trigger('checking-for-update');
    expect(updater.getStatus().state).toBe('checking');

    const info: UpdaterInfo = { version: '1.2.0' };
    mock.trigger('update-available', info);
    expect(updater.getStatus().state).toBe('available');
    expect(updater.getStatus().version).toBe('1.2.0');

    mock.trigger('update-downloaded', { version: '1.2.0' });
    expect(updater.getStatus().state).toBe('downloaded');

    const firstAttempt = await updater.requestRestartToApply();
    expect(firstAttempt).toEqual({ applied: false, deferred: true });
    expect(updater.getStatus().restartDeferred).toBe(true);
    expect(mock.quitAndInstall).not.toHaveBeenCalled();

    activeRuns = 0;
    const secondAttempt = await updater.onRunsChanged();
    expect(secondAttempt).toEqual({ applied: true, deferred: false });
    expect(beforeRestart).toHaveBeenCalledTimes(1);
    expect(mock.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe('menus', () => {
  it('builds tray and app menu templates displaying engine status and attention count', () => {
    const trayMenu = buildTrayMenuTemplate({
      mode: 'owned',
      port: 4310,
      workdir: '/Users/test/workspace',
      attentionCount: 3,
      activeRunCount: 1,
      updaterStatus: { state: 'downloaded', version: '1.0.1' },
      onOpenWindow: vi.fn(),
      onChangeWorkdir: vi.fn(),
      onInstallCli: vi.fn(),
      onCheckUpdates: vi.fn(),
      onApplyUpdate: vi.fn(),
      onQuit: vi.fn(),
    });

    const labels = trayMenu.map((item) => item.label);
    expect(labels).toContain('Interlock Engine: Owned (:4310)');
    expect(labels).toContain('Runs Needing Attention: 3');
    expect(labels).toContain('Working Directory: /Users/test/workspace');
    expect(labels).toContain('Update Ready — Waiting for Active Runs…');

    const appMenu = buildAppMenuTemplate({
      mode: 'attached',
      port: 4310,
      workdir: '/Users/test/workspace',
      updaterStatus: { state: 'idle' },
      onOpenWindow: vi.fn(),
      onChangeWorkdir: vi.fn(),
      onInstallCli: vi.fn(),
      onCheckUpdates: vi.fn(),
      onApplyUpdate: vi.fn(),
      onQuit: vi.fn(),
    });

    expect(DESKTOP_VERSION).toBe(VERSION);
    expect(appMenu.find((item) => item.label === 'Interlock')).toBeDefined();
    expect(appMenu.find((item) => item.label === 'Edit')).toBeDefined();
  });
});
