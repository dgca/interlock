import { VERSION } from '@interlock/core/version';

export const DESKTOP_VERSION = VERSION;

export const TRAY_ICON_1X_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAABTElEQVR4nKzUL0gEQRTH8Te6qEXEIGhSMRwGwzUP/IeWE0Gw2U0WzRcsVpMWwWy4YBGDJv+BIIJgFjWo4RAPBIOKh/p97Bzu7c3clPvBB3bfPOZ23ywXSZwezGFA3PnBNY7x4WowaEUZXRLOAeZdCxHG7SY32PdsoH3LmEE7vlwNGXu9jR3xZwiL6MdterFFmpQosN6JrOMJRtGBOzyHnmgDbzhDPrVWxAmecN5oI60vSXyqFyil1i/tD7xLfFjDvo0G0Y09jOEota5Dn0LB3ud0RhV7YxKN1dlVEjXjqFWvI32iU3tTsNdFqU3e1mfxiAdxRDe6xxb6MCnxiSTTa+v6Ea6JJ9VXWMU6RvCZ6tH5TEg84O/QRpqy/L9mJlEvSf2p1aVpX7bx1Nvwihfsij/6DU0jZxo0bWJFwtF/jawJNOnwF8Q/gisc4vcPAAD//wV1wbIAAAAGSURBVAMAYJs7VCy2sakAAAAASUVORK5CYII=';

export const TRAY_ICON_2X_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAACNElEQVR4nOyYO2tUQRTH/9kEn6CCIBY+okh8IhY2gmJEG7+ApYWFiIpoo2CjbbARVDAgiPoFbPJqQpIiSRHIqwgJSSCQpEi1KfKCvP4nM0MmQ8jeM3cCW+wPfrv3zN65nJmdPXfuFlBm1ATxefqK1tET0LNKp2gX/YMIqrzjJ/Q3PYI0dNDHdFnTqdq+X6Bt9CjSUUtP0iZNJzdDDfS91z5NJ6DnEL2N7YGuwwwy8yy5NXTTa5uHGd0a4pCBNdjjAr1B+7J2dgmd8trGcyQjjATxaSgooMyoJFSKskuoBvFIyThLz9nrFOnAHuffws7qL+eP0UUkSOgB/UUvem2dtH6PPl/p/aBN6tR3+pEuxCZUT9uRBlkyb+h1+sg1aPmH9DykT+VAO0O19IwXy0x9gbk1FEv0fYuda0h2FI1eLF/nX21Cl4P4J21FNsIF30Hf0Ss2viov2oQOBPES8rEYXrts69CK13YY+Qj7r0CBS2iY3rHH1+hzmKLlyFr0ZD/0MvhsEBEJ/bdJOBqD82KKntBN56DAraEW2oy0bNAXUOIvatnk/7AXysskzIwNQ4n/s5d7yWv6AaZoHfc+y1r03GOQ7MmjBrZbHZLE+qFjAImobNBKUUmoFNqb62wQ1yEeebq95MUziEhoCObedNDG8oQq9Uv1h4JFth3HvLhXXqqg5zP9hLRInZM/PIrV0NND78HsHlMgeyLZvm7VspgZcjyjd7H9GKRFZmWUfoOp7Mib0L6wCQAA///4bKiUAAAABklEQVQDAKX7XPjQLnYeAAAAAElFTkSuQmCC';

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
