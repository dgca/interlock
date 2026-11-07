import { spawn } from 'node:child_process';
import type {
  DesktopNotification,
  DesktopNotificationSender,
} from '@interlock/core';

export class DesktopNotifier {
  private enabled: boolean;
  private customSender?: DesktopNotificationSender;

  constructor(
    options: {
      enabled?: boolean;
      sender?: DesktopNotificationSender;
    } = {},
  ) {
    this.enabled =
      options.enabled ??
      ['1', 'true', 'yes'].includes(
        (process.env.INTERLOCK_DESKTOP_NOTIFICATIONS ?? '').toLowerCase(),
      );
    this.customSender = options.sender;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  notify(notification: DesktopNotification): void {
    if (!this.enabled) return;
    if (this.customSender) {
      try {
        const res = this.customSender(notification);
        if (res instanceof Promise) {
          res.catch(() => {});
        }
      } catch {
        // Notification errors are isolated and non-fatal
      }
      return;
    }

    try {
      if (process.platform === 'darwin') {
        const script = `display notification ${JSON.stringify(notification.message)} with title ${JSON.stringify(notification.title)}`;
        const child = spawn('osascript', ['-e', script], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      } else if (process.platform === 'linux') {
        const child = spawn(
          'notify-send',
          [notification.title, notification.message],
          {
            detached: true,
            stdio: 'ignore',
          },
        );
        child.unref();
      } else if (process.platform === 'win32') {
        const script = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $textNodes = $template.GetElementsByTagName('text'); $textNodes.Item(0).AppendChild($template.CreateTextNode(${JSON.stringify(notification.title)})) > $null; $textNodes.Item(1).AppendChild($template.CreateTextNode(${JSON.stringify(notification.message)})) > $null; $toast = [Windows.UI.Notifications.ToastNotification]::new($template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Interlock').Show($toast);`;
        const child = spawn('powershell', ['-NoProfile', '-Command', script], {
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
    } catch {
      // OS notification failure is non-fatal
    }
  }
}
