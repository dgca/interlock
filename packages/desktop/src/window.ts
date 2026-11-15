import type { BrowserWindow as BrowserWindowType } from 'electron';

export interface BrowserWindowLike {
  isVisible(): boolean;
  isFocused?(): boolean;
  show(): void;
  hide(): void;
  focus(): void;
  loadURL(url: string): Promise<void>;
  webContents: {
    getURL(): string;
    executeJavaScript(code: string): Promise<unknown>;
  };
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export function shouldConfirmQuit(
  mode: 'owned' | 'attached' | 'stopped',
  activeRuns: number,
): boolean {
  return mode === 'owned' && activeRuns > 0;
}

export interface CreateMainWindowOptions {
  uiUrl: string;
  isQuitting: () => boolean;
  BrowserWindowConstructor?: typeof BrowserWindowType;
  openExternal?: (url: string) => Promise<void> | void;
}

export function createMainWindow(
  options: CreateMainWindowOptions,
): BrowserWindowType {
  const ctor = options.BrowserWindowConstructor;

  if (!ctor) {
    throw new Error('BrowserWindow is not available outside Electron runtime');
  }

  const win = new ctor({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    title: 'Interlock',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', (event) => {
    if (!options.isQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });

  if (typeof win.webContents?.setWindowOpenHandler === 'function') {
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith(new URL(options.uiUrl).origin)) {
        if (options.openExternal) void options.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
  }

  void win.loadURL(options.uiUrl);
  return win;
}

export async function navigateToRun(
  window: BrowserWindowLike,
  engineUrl: string,
  runId: string,
): Promise<void> {
  if (!window.isVisible()) {
    window.show();
  }
  window.focus();

  const targetPath = `/runs/${encodeURIComponent(runId)}`;
  const currentUrl = window.webContents.getURL();

  if (currentUrl.startsWith(engineUrl)) {
    const script = `
      try {
        history.pushState(null, '', ${JSON.stringify(targetPath)});
        window.dispatchEvent(new PopStateEvent('popstate'));
      } catch (e) {
        window.location.href = ${JSON.stringify(new URL(targetPath, engineUrl).href)};
      }
    `;
    try {
      await window.webContents.executeJavaScript(script);
      return;
    } catch {
      // Fall through to loadURL if script execution fails
    }
  }

  const targetUrl = new URL(targetPath, engineUrl).href;
  await window.loadURL(targetUrl);
}
