import '@interlock/server/sqliteWarning';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from 'electron';
import { VERSION } from '@interlock/core/version';
import { readApiToken } from '@interlock/core/apiToken';
import { hydrateProcessEnv } from './shellEnv.js';
import {
  readDesktopSettings,
  resolveDesktopWorkdir,
  writeDesktopSettings,
} from './settings.js';
import { DesktopEngineLifecycle } from './lifecycle.js';
import {
  AttentionNotificationTracker,
  createAttachedSnapshotProvider,
  createOwnedSnapshot,
} from './notifications.js';
import { installCliCommandInPath } from './cliInstall.js';
import { DesktopUpdater, type UpdaterLike } from './updater.js';
import {
  buildAppMenuTemplate,
  buildTrayMenuTemplate,
  TRAY_ICON_1X_DATA_URL,
  TRAY_ICON_2X_DATA_URL,
  type MenuContextOptions,
} from './menu.js';
import {
  createMainWindow,
  navigateToRun,
  shouldConfirmQuit,
} from './window.js';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let lifecycle: DesktopEngineLifecycle;
let notificationTracker: AttentionNotificationTracker;
let updater: DesktopUpdater;
let unsubscribeEngine: (() => void) | undefined;
let isQuitting = false;
let lastAttentionCount = 0;

function bindOwnedEngineSubscription(): void {
  unsubscribeEngine?.();
  unsubscribeEngine = undefined;
  const ownedEngine = lifecycle?.getOwnedEngine();
  if (ownedEngine) {
    unsubscribeEngine = ownedEngine.subscribe(() => {
      void notificationTracker?.evaluate();
      void updater?.onRunsChanged();
    });
  }
}

function resolveUiPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'dist', 'ui');
  }
  const devUi = resolve(import.meta.dirname, '../../ui/dist');
  if (existsSync(devUi)) return devUi;
  return resolve(import.meta.dirname, '../../../dist/ui');
}

function updateMenus(): void {
  const menuContext: MenuContextOptions = {
    mode: lifecycle.getMode() === 'owned' ? 'owned' : 'attached',
    port: lifecycle.getPort(),
    workdir: lifecycle.getWorkdir(),
    attentionCount: lastAttentionCount,
    activeRunCount: lifecycle.activeRunCount(),
    updaterStatus: updater.getStatus(),
    onOpenWindow: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    onChangeWorkdir: () => {
      void handleChangeWorkdir();
    },
    onInstallCli: () => {
      handleInstallCli();
    },
    onCheckUpdates: () => {
      void updater.checkForUpdates();
    },
    onApplyUpdate: () => {
      void updater.requestRestartToApply();
    },
    onQuit: () => {
      app.quit();
    },
  };

  const appMenu = Menu.buildFromTemplate(
    buildAppMenuTemplate(
      menuContext,
    ) as unknown as Electron.MenuItemConstructorOptions[],
  );
  Menu.setApplicationMenu(appMenu);

  if (tray) {
    const trayMenu = Menu.buildFromTemplate(
      buildTrayMenuTemplate(
        menuContext,
      ) as unknown as Electron.MenuItemConstructorOptions[],
    );
    tray.setContextMenu(trayMenu);
  }
}

async function handleChangeWorkdir(): Promise<void> {
  const dialogOptions = {
    title: 'Select Default Working Directory',
    defaultPath: lifecycle.getWorkdir(),
    properties: ['openDirectory', 'createDirectory'] as Array<
      'openDirectory' | 'createDirectory'
    >,
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || result.filePaths.length === 0) return;
  const newWorkdir = result.filePaths[0];

  const currentSettings = readDesktopSettings();
  writeDesktopSettings({ ...currentSettings, workdir: newWorkdir });

  const updateResult = await lifecycle.updateWorkdir(newWorkdir);
  if (updateResult.restarted) {
    bindOwnedEngineSubscription();
  }
  if (updateResult.deferred && mainWindow) {
    dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      title: 'Working Directory Change Deferred',
      message:
        'The new working directory will take effect once active workflow runs finish.',
    });
  }
  updateMenus();
}

function handleInstallCli(): void {
  try {
    const res = installCliCommandInPath();
    if (mainWindow) {
      dialog.showMessageBoxSync(mainWindow, {
        type: 'info',
        title: 'CLI Installed',
        message: `Successfully installed Interlock CLI command to ${res.installedPath}`,
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (mainWindow) {
      dialog.showMessageBoxSync(mainWindow, {
        type: 'error',
        title: 'Installation Failed',
        message: `Could not install Interlock CLI: ${msg}`,
      });
    }
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('before-quit', (event) => {
  if (isQuitting) return;

  const activeRuns = lifecycle.activeRunCount();
  if (shouldConfirmQuit(lifecycle.getMode(), activeRuns)) {
    event.preventDefault();
    const boxOptions = {
      type: 'warning' as const,
      buttons: ['Quit Anyway', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Active Runs in Progress',
      message: `There are ${activeRuns} active workflow runs. Quitting now will terminate them. Are you sure you want to quit?`,
    };
    const choice = mainWindow
      ? dialog.showMessageBoxSync(mainWindow, boxOptions)
      : dialog.showMessageBoxSync(boxOptions);
    if (choice === 0) {
      isQuitting = true;
      void (async () => {
        await lifecycle.stop();
        app.quit();
      })();
    }
    return;
  }

  isQuitting = true;
  void lifecycle.stop();
});

void app.whenReady().then(async () => {
  hydrateProcessEnv();
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    const devIconPath = resolve(import.meta.dirname, '../build/icon.png');
    if (existsSync(devIconPath)) {
      app.dock.setIcon(devIconPath);
    }
  }
  if (typeof app.setAboutPanelOptions === 'function') {
    app.setAboutPanelOptions({
      applicationName: 'Interlock',
      applicationVersion: VERSION,
    });
  }

  const workdir = resolveDesktopWorkdir();
  const port = Number(process.env.INTERLOCK_PORT ?? 4310);
  const database =
    process.env.INTERLOCK_DB ?? join(homedir(), '.interlock/interlock.db');
  const ui = resolveUiPath();

  lifecycle = new DesktopEngineLifecycle({
    port,
    database,
    workdir,
    ui,
    onStateChange: (newState) => {
      bindOwnedEngineSubscription();
      if (mainWindow) {
        void mainWindow.loadURL(newState.uiUrl);
      }
      updateMenus();
    },
    onError: (err) => {
      console.error('Lifecycle error:', err);
    },
  });

  const state = await lifecycle.start();
  const attachedSnapshotProvider = createAttachedSnapshotProvider(
    lifecycle.getEngineUrl(),
    readApiToken(),
  );

  mainWindow = createMainWindow({
    uiUrl: state.uiUrl,
    isQuitting: () => isQuitting,
    BrowserWindowConstructor: BrowserWindow,
    openExternal: (url) => shell.openExternal(url),
  });

  const icon = nativeImage.createFromDataURL(TRAY_ICON_1X_DATA_URL);
  if (typeof icon.addRepresentation === 'function') {
    icon.addRepresentation({
      scaleFactor: 2.0,
      width: 36,
      height: 36,
      dataURL: TRAY_ICON_2X_DATA_URL,
    });
  }
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Interlock');
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  notificationTracker = new AttentionNotificationTracker({
    snapshotProvider: () => {
      if (lifecycle.getMode() === 'attached') {
        return attachedSnapshotProvider();
      }
      return createOwnedSnapshot(
        lifecycle.getOwnedEngine(),
        lifecycle.getOwnedStore(),
      );
    },
    setDockBadge: (badge) => {
      if (process.platform === 'darwin' && app.dock) {
        app.dock.setBadge(badge);
      }
      lastAttentionCount = badge ? Number(badge) || 0 : 0;
      void updater?.onRunsChanged();
      updateMenus();
    },
    isWindowFocused: () => {
      return mainWindow
        ? mainWindow.isVisible() && mainWindow.isFocused()
        : false;
    },
    notify: ({ title, body, runId }) => {
      if (Notification.isSupported()) {
        const notif = new Notification({ title, body });
        notif.on('click', () => {
          if (mainWindow) {
            void navigateToRun(mainWindow, lifecycle.getEngineUrl(), runId);
          }
        });
        notif.show();
      }
    },
    onNavigateToRun: (runId) => {
      if (mainWindow) {
        void navigateToRun(mainWindow, lifecycle.getEngineUrl(), runId);
      }
    },
  });
  bindOwnedEngineSubscription();
  notificationTracker.start();

  try {
    const { autoUpdater } = await import('electron-updater');
    updater = new DesktopUpdater({
      updater: autoUpdater as unknown as UpdaterLike,
      getActiveRunCount: () => lifecycle.activeRunCount(),
      beforeRestart: async () => {
        await lifecycle.stop();
      },
      onStatusChange: () => {
        updateMenus();
      },
    });
  } catch {
    updater = new DesktopUpdater({
      getActiveRunCount: () => lifecycle.activeRunCount(),
      beforeRestart: async () => {
        await lifecycle.stop();
      },
      onStatusChange: () => {
        updateMenus();
      },
    });
  }

  updateMenus();
});
