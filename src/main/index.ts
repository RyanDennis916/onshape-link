import { app, Tray, Menu, nativeImage } from 'electron';
import { DiscordRpcClient } from './discord/rpc';
import { PresenceState } from '../shared/types';

const clientId = process.env.DISCORD_CLIENT_ID || 'YOUR_DISCORD_APPLICATION_ID';
const client = new DiscordRpcClient(clientId);
let tray: Tray | null = null;

function buildTrayMenu(state: PresenceState): Electron.Menu {
  return Menu.buildFromTemplate([
    { label: `Status: ${state.status}`, enabled: false },
    { type: 'separator' },
    { label: `Document: ${state.details || 'Not connected'}` },
    { label: `Tab: ${state.state || 'Waiting...'}` },
    { type: 'separator' },
    { label: 'Reconnect Discord', click: async () => { await client.connect(); } },
    { label: 'Quit', role: 'quit' }
  ]);
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const icon = nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const defaultPresence: PresenceState = {
    status: 'not-connected',
    details: 'Onshape Link',
    state: 'Starting...'
  };

  tray.setToolTip('Onshape Link');
  tray.setContextMenu(buildTrayMenu(defaultPresence));

  try {
    await client.connect();
    await client.setPresence(defaultPresence);
    tray.setContextMenu(buildTrayMenu({
      status: 'connected',
      details: 'Onshape Link',
      state: 'Discord connected'
    }));
  } catch (error) {
    console.error('Startup connect failed', error);
    tray.setContextMenu(buildTrayMenu({
      status: 'not-connected',
      details: 'Discord unavailable',
      state: 'Check Discord status'
    }));
  }

  app.on('activate', () => {
    if (tray) {
      tray.popUpContextMenu();
    }
  });
}

bootstrap();

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
