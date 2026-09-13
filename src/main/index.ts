import { app, BrowserWindow, globalShortcut, ipcMain, Tray } from 'electron';
import { join } from 'node:path';
import { loadConfig } from './config';
import { OnshapeAuth } from './auth/oauth';
import { OnshapeTokenStore } from './auth/tokenStore';
import { DiscordRpcClient } from './discord/rpc';
import { OnshapeClient } from './onshape/client';
import { OnshapePoller } from './onshape/poller';
import { buildMenu, createTrayIcon, statusLine } from './tray/menu';
import { DiscordConnectionState, OnshapeAuthState, OnshapeUser, PresenceState } from '../shared/types';

const rootDir = app.getAppPath();
const config = loadConfig(rootDir);

let tray: Tray | null = null;
let onboardingWindow: BrowserWindow | null = null;
let paused = !config.enabled;
let onshapeState: OnshapeAuthState = 'signed-out';
let onshapeUser: OnshapeUser | null = null;

const presence: PresenceState = {
  status: 'not-connected',
  details: 'Onshape Link',
  state: 'Waiting for Onshape...',
  elementType: 'unknown'
};

const client = new DiscordRpcClient({
  clientId: config.discordClientId,
  onStateChange: (state) => {
    presence.status = state === 'connected' ? 'connected' : 'not-connected';
    refreshTray();
    broadcastOnshapeState();

    if (state === 'connected') {
      void client.setPresence(presence);
    }
  }
});

const tokenStore = new OnshapeTokenStore(app.getPath('userData'));
const onshapeAuth = new OnshapeAuth({
  clientId: config.onshapeClientId,
  clientSecret: config.onshapeClientSecret,
  tokenStore,
  onStateChange: (state, user) => {
    onshapeState = state;
    onshapeUser = user;
    refreshTray();
    broadcastOnshapeState();

    if (state === 'connected' && onboardingWindow) {
      setTimeout(() => onboardingWindow?.close(), 1500);
    }

    if (state !== 'connected') {
      presence.status = 'not-connected';
      presence.details = 'Onshape Link';
      presence.state = 'Waiting for Onshape...';
      presence.elementType = 'unknown';
      presence.documentUrl = undefined;
      void client.setPresence(presence);
    }
  }
});

const onshapeClient = new OnshapeClient(() => onshapeAuth.getAccessToken());
const onshapePoller = new OnshapePoller({
  client: onshapeClient,
  pollIntervalSec: config.pollIntervalSec,
  idleTimeoutMin: config.idleTimeoutMin,
  isSignedIn: () => onshapeState === 'connected',
  onPresence: (newPresence) => {
    presence.status = newPresence.status;
    presence.details = newPresence.details;
    presence.state = newPresence.state;
    presence.elementType = newPresence.elementType;
    presence.documentUrl = newPresence.documentUrl;
    presence.startedAt = newPresence.startedAt;
    refreshTray();
    void client.setPresence(presence);
  }
});

function refreshTray(): void {
  if (!tray) {
    return;
  }

  const view = {
    connection: client.getState() as DiscordConnectionState,
    presence,
    paused,
    onshape: onshapeState,
    onshapeUserName: onshapeUser?.name ?? null
  };

  tray.setToolTip(`Onshape Link - ${statusLine(view)}`);
  tray.setContextMenu(
    buildMenu(view, {
      onReconnect: () => {
        client.reconnectNow();
        refreshTray();
      },
      onTogglePause: () => {
        paused = !paused;
        void client.setPaused(paused).then(refreshTray);
      },
      onOpenOnboarding: () => {
        openOnboardingWindow();
      },
      onDisconnectOnshape: () => {
        onshapeAuth.logout();
        refreshTray();
        broadcastOnshapeState();
      }
    })
  );
}

function broadcastOnshapeState(): void {
  onboardingWindow?.webContents.send('onshape:state', {
    discordState: client.getState() as DiscordConnectionState,
    onshapeState,
    onshapeUser
  });
}

function openOnboardingWindow(): void {
  if (onboardingWindow) {
    onboardingWindow.show();
    onboardingWindow.focus();
    return;
  }

  onboardingWindow = new BrowserWindow({
    width: 340,
    height: 360,
    resizable: false,
    minimizable: false,
    fullscreenable: false,
    title: 'Onshape Link',
    webPreferences: {
      preload: join(app.getAppPath(), 'dist', 'onboarding', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  onboardingWindow.setMenuBarVisibility(false);
  void onboardingWindow.loadFile(join(rootDir, 'src', 'onboarding', 'index.html'));

  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });
}

ipcMain.handle('onshape:connect', () => {
  return onshapeAuth.login().catch((error) => {
    console.error('Onboarding connect failed', error);
  });
});

ipcMain.handle('onshape:get-state', () => ({
  discordState: client.getState() as DiscordConnectionState,
  onshapeState,
  onshapeUser
}));

async function bootstrap(): Promise<void> {
  await app.whenReady();

  app.dock?.hide();

  tray = new Tray(createTrayIcon(rootDir));
  tray.on('double-click', () => openOnboardingWindow());
  refreshTray();

  globalShortcut.register('CommandOrControl+Shift+O', () => {
    openOnboardingWindow();
  });

  if (!config.discordClientId) {
    console.error('DISCORD_CLIENT_ID is not set. Copy .env.example to .env and fill it in.');
  } else {
    if (paused) {
      await client.setPaused(true);
    }

    await client.setPresence(presence);
    client.start();
  }

  if (!config.onshapeClientId || !config.onshapeClientSecret) {
    console.error('ONSHAPE_CLIENT_ID / ONSHAPE_CLIENT_SECRET are not set. Copy .env.example to .env and fill them in.');
  } else {
    await onshapeAuth.restoreSession();
  }

  if (onshapeState !== 'connected') {
    openOnboardingWindow();
  }

  onshapePoller.start();
}

void bootstrap();

app.on('activate', () => {
  openOnboardingWindow();
});

app.on('before-quit', () => {
  client.stop();
  onshapePoller.stop();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  return;
});
