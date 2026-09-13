import { app, Tray } from 'electron';
import { loadConfig } from './config';
import { DiscordRpcClient } from './discord/rpc';
import { buildMenu, createTrayIcon, statusLine } from './tray/menu';
import { DiscordConnectionState, PresenceState } from '../shared/types';

const rootDir = app.getAppPath();
const config = loadConfig(rootDir);

let tray: Tray | null = null;
let paused = !config.enabled;

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

    if (state === 'connected') {
      void client.setPresence(presence);
    }
  }
});

function refreshTray(): void {
  if (!tray) {
    return;
  }

  const view = {
    connection: client.getState() as DiscordConnectionState,
    presence,
    paused
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
      }
    })
  );
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  app.dock?.hide();

  tray = new Tray(createTrayIcon(rootDir));
  refreshTray();

  if (!config.discordClientId) {
    console.error('DISCORD_CLIENT_ID is not set. Copy .env.example to .env and fill it in.');
    return;
  }

  if (paused) {
    await client.setPaused(true);
  }

  await client.setPresence(presence);
  client.start();
}

void bootstrap();

app.on('activate', () => {
  tray?.popUpContextMenu();
});

app.on('before-quit', () => {
  client.stop();
});

app.on('window-all-closed', () => {
  return;
});
