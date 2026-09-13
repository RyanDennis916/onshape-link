import { Menu, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DiscordConnectionState, PresenceState } from '../../shared/types';

export interface TrayView {
  connection: DiscordConnectionState;
  presence: PresenceState;
  paused: boolean;
}

export interface TrayCallbacks {
  onReconnect: () => void;
  onTogglePause: () => void;
}

const STATUS_LABELS: Record<DiscordConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting to Discord...',
  disconnected: 'Discord not running',
  unavailable: 'Discord not detected',
  unconfigured: 'No Discord application id set'
};

export function createTrayIcon(rootDir: string): Electron.NativeImage {
  const iconPath = join(rootDir, 'build', 'trayTemplate.png');

  if (!existsSync(iconPath)) {
    return nativeImage.createEmpty();
  }

  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);
  return icon;
}

export function statusLine(view: TrayView): string {
  if (view.connection !== 'connected') {
    return STATUS_LABELS[view.connection];
  }

  if (view.paused) {
    return 'Connected - presence paused';
  }

  return `Connected - showing: ${view.presence.details}`;
}

export function buildMenu(view: TrayView, callbacks: TrayCallbacks): Electron.Menu {
  const connected = view.connection === 'connected';

  return Menu.buildFromTemplate([
    { label: statusLine(view), enabled: false },
    { type: 'separator' },
    { label: `Document: ${view.presence.details || 'Not connected'}`, enabled: false },
    { label: `Tab: ${view.presence.state || 'Waiting...'}`, enabled: false },
    { type: 'separator' },
    {
      label: view.paused ? 'Resume Presence Updates' : 'Pause Presence Updates',
      enabled: connected,
      click: callbacks.onTogglePause
    },
    { label: 'Reconnect Discord', click: callbacks.onReconnect },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' }
  ]);
}
