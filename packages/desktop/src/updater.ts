export type UpdaterState =
  'idle' | 'checking' | 'available' | 'downloaded' | 'error';

export interface UpdaterStatus {
  state: UpdaterState;
  version?: string;
  restartDeferred?: boolean;
  error?: string;
}

export interface RestartResult {
  applied: boolean;
  deferred: boolean;
}

export interface UpdaterInfo {
  version?: string;
}

export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => unknown;
}

export interface DesktopUpdaterOptions {
  updater?: UpdaterLike;
  getActiveRunCount: () => number;
  beforeRestart?: () => Promise<void> | void;
  onStatusChange?: (status: UpdaterStatus) => void;
}

export class DesktopUpdater {
  private state: UpdaterState = 'idle';
  private version?: string;
  private restartDeferred = false;
  private error?: string;
  private readonly updater?: UpdaterLike;

  constructor(private readonly options: DesktopUpdaterOptions) {
    if (options.updater) {
      this.updater = options.updater;
      this.attachUpdater(options.updater);
    }
  }

  attachUpdater(updater: UpdaterLike): void {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;

    updater.on('checking-for-update', () => {
      this.state = 'checking';
      this.error = undefined;
      this.emitStatus();
    });

    updater.on('update-available', (infoUnknown: unknown) => {
      this.state = 'available';
      const info = infoUnknown as UpdaterInfo | undefined;
      if (info?.version) this.version = info.version;
      this.emitStatus();
    });

    updater.on('update-not-available', () => {
      this.state = 'idle';
      this.emitStatus();
    });

    updater.on('update-downloaded', (infoUnknown: unknown) => {
      this.state = 'downloaded';
      const info = infoUnknown as UpdaterInfo | undefined;
      if (info?.version) this.version = info.version;
      this.emitStatus();
    });

    updater.on('error', (errUnknown: unknown) => {
      this.state = 'error';
      if (errUnknown instanceof Error) {
        this.error = errUnknown.message;
      } else if (typeof errUnknown === 'string') {
        this.error = errUnknown;
      } else {
        this.error = 'Unknown update error';
      }
      this.emitStatus();
    });
  }

  getStatus(): UpdaterStatus {
    return {
      state: this.state,
      version: this.version,
      restartDeferred: this.restartDeferred,
      error: this.error,
    };
  }

  async checkForUpdates(): Promise<void> {
    if (!this.updater) return;
    this.state = 'checking';
    this.error = undefined;
    this.emitStatus();
    try {
      await this.updater.checkForUpdates();
    } catch (err: unknown) {
      this.state = 'error';
      if (err instanceof Error) {
        this.error = err.message;
      } else if (typeof err === 'string') {
        this.error = err;
      } else {
        this.error = 'Update check failed';
      }
      this.emitStatus();
    }
  }

  async requestRestartToApply(): Promise<RestartResult> {
    if (this.state !== 'downloaded') {
      return { applied: false, deferred: false };
    }

    if (this.options.getActiveRunCount() > 0) {
      this.restartDeferred = true;
      this.emitStatus();
      return { applied: false, deferred: true };
    }

    this.restartDeferred = false;
    this.emitStatus();
    await this.options.beforeRestart?.();
    this.updater?.quitAndInstall(false, true);
    return { applied: true, deferred: false };
  }

  async onRunsChanged(): Promise<RestartResult | undefined> {
    if (
      this.restartDeferred &&
      this.state === 'downloaded' &&
      this.options.getActiveRunCount() === 0
    ) {
      return this.requestRestartToApply();
    }
    return undefined;
  }

  private emitStatus(): void {
    this.options.onStatusChange?.(this.getStatus());
  }
}
