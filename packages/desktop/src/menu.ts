import { VERSION } from '@interlock/core/version';

export const DESKTOP_VERSION = VERSION;

export interface MenuItemDef {
  label?: string;
  type?: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
  role?: string;
  accelerator?: string;
  enabled?: boolean;
  click?: () => void;
  submenu?: MenuItemDef[];
}

export interface MenuContextOptions {
  mode: 'owned' | 'attached';
  port: number;
  workdir: string;
  attentionCount?: number;
  activeRunCount?: number;
  updaterStatus?: {
    state: string;
    version?: string;
    restartDeferred?: boolean;
  };
  onOpenWindow: () => void;
  onChangeWorkdir: () => void;
  onInstallCli: () => void;
  onCheckUpdates: () => void;
  onApplyUpdate: () => void;
  onQuit: () => void;
}

export function buildTrayMenuTemplate(
  options: MenuContextOptions,
): MenuItemDef[] {
  const engineModeLabel = options.mode === 'owned' ? 'Owned' : 'Attached';
  const items: MenuItemDef[] = [
    {
      label: `Interlock Engine: ${engineModeLabel} (:${options.port})`,
      enabled: false,
    },
  ];

  if (options.attentionCount && options.attentionCount > 0) {
    items.push({
      label: `Runs Needing Attention: ${options.attentionCount}`,
      enabled: false,
    });
  }

  items.push(
    {
      label: `Working Directory: ${options.workdir}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Interlock',
      click: options.onOpenWindow,
    },
    {
      label: 'Change Default Working Directory…',
      click: options.onChangeWorkdir,
    },
    {
      label: "Install 'interlock' Command in PATH…",
      click: options.onInstallCli,
    },
    { type: 'separator' },
    {
      label: 'Check for Updates…',
      click: options.onCheckUpdates,
    },
  );

  if (options.updaterStatus?.state === 'downloaded') {
    const isWaiting = (options.activeRunCount ?? 0) > 0;
    const label = isWaiting
      ? 'Update Ready — Waiting for Active Runs…'
      : 'Update Ready — Restart to Apply';
    items.push({
      label,
      click: options.onApplyUpdate,
    });
  }

  items.push(
    { type: 'separator' },
    {
      label: 'Quit Interlock',
      click: options.onQuit,
    },
  );

  return items;
}

export function buildAppMenuTemplate(
  options: MenuContextOptions,
): MenuItemDef[] {
  const engineModeLabel = options.mode === 'owned' ? 'Owned' : 'Attached';
  const appSubmenu: MenuItemDef[] = [
    { role: 'about' },
    { type: 'separator' },
    {
      label: `Interlock Engine: ${engineModeLabel} (:${options.port})`,
      enabled: false,
    },
    {
      label: `Working Directory: ${options.workdir}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Change Default Working Directory…',
      click: options.onChangeWorkdir,
    },
    {
      label: "Install 'interlock' Command in PATH…",
      click: options.onInstallCli,
    },
    { type: 'separator' },
    {
      label: 'Check for Updates…',
      click: options.onCheckUpdates,
    },
  ];

  if (options.updaterStatus?.state === 'downloaded') {
    const isWaiting = (options.activeRunCount ?? 0) > 0;
    const label = isWaiting
      ? 'Update Ready — Waiting for Active Runs…'
      : 'Update Ready — Restart to Apply';
    appSubmenu.push({
      label,
      click: options.onApplyUpdate,
    });
  }

  appSubmenu.push(
    { type: 'separator' },
    { role: 'services' },
    { type: 'separator' },
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    {
      label: 'Quit Interlock',
      accelerator: 'CmdOrCtrl+Q',
      click: options.onQuit,
    },
  );

  return [
    {
      label: 'Interlock',
      submenu: appSubmenu,
    },
    {
      label: 'File',
      submenu: [{ role: 'close' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
}
