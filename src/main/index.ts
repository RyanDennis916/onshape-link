import { app, BrowserWindow, globalShortcut, ipcMain, Tray } from 'electron';
import { join } from 'node:path';
import { loadConfig } from './config';
import { OnshapeAuth } from './auth/oauth';
import { OnshapeTokenStore } from './auth/tokenStore';
import { DiscordRpcClient } from './discord/rpc';
import { OnshapeClient } from './onshape/client';
import { OnshapePoller } from './onshape/poller';
import { buildMenu, createTrayIcon, statusLine } from './tray/menu';
import { initAutoUpdater } from './updater';
import { SettingsStore } from './settings';
import { DiscordConnectionState, OnshapeAuthState, OnshapeUser, PresenceState } from '../shared/types';

const rootDir = app.getAppPath();
const config = loadConfig(rootDir);
const settingsStore = new SettingsStore(app.getPath('userData'));

let tray: Tray | null = null;
let onboardingWindow: BrowserWindow | null = null;
let paused = !settingsStore.loadPresenceEnabled(config.enabled);
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
    refreshTray();
    broadcastOnshapeState();

    if (state === 'connected') {
      applyPresence();
    }
  }
});

// Only ever push a real, poller-derived, actively-in-use presence to
// Discord. Everything else - not signed in, or the "idle" status the poller
// reports once a document hasn't been touched in a while, which is the
// closest signal we have to "Onshape isn't actually open anymore" - should
// show no activity at all instead of a stale/placeholder one.
function applyPresence(): void {
  if (onshapeState === 'connected' && presence.status === 'connected') {
    void client.setPresence(presence);
  } else {
    void client.clearPresence();
  }
}

const tokenStore = new OnshapeTokenStore(app.getPath('userData'));
const onshapeAuth = new OnshapeAuth({
  clientId: config.onshapeClientId,
  tokenRelayUrl: config.tokenRelayUrl,
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
      applyPresence();
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
    applyPresence();
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
        settingsStore.savePresenceEnabled(!paused);
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
  void onboardingWindow.loadFile(join(rootDir, 'dist', 'onboarding', 'index.html'));

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

    client.start();
  }

  if (!config.onshapeClientId || !config.tokenRelayUrl) {
    console.error('ONSHAPE_CLIENT_ID / TOKEN_RELAY_URL are not set. Copy .env.example to .env and fill them in.');
  } else {
    await onshapeAuth.restoreSession();
  }

  if (onshapeState !== 'connected') {
    openOnboardingWindow();
  }

  onshapePoller.start();

  if (app.isPackaged) {
    initAutoUpdater();
  }
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
