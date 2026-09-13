import { Client } from '@xhayper/discord-rpc';
import { PresenceState } from '../../shared/types';

export class DiscordRpcClient {
  private client: Client | null = null;
  private connected = false;
  private readonly clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  public async connect(): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    this.client = new Client({ clientId: this.clientId });

    this.client.on('connected', () => {
      this.connected = true;
      console.log('Discord RPC connected');
    });

    this.client.on('disconnected', () => {
      this.connected = false;
      console.log('Discord RPC disconnected');
    });

    this.client.on('error', (error) => {
      console.error('Discord RPC error', error);
    });

    await this.client.login();
  }

  public async setPresence(state: PresenceState): Promise<void> {
    if (!this.client || !this.connected || !this.client.user) {
      return;
    }

    await this.client.user.setActivity({
      details: state.details,
      state: state.state,
      largeImageKey: 'onshape',
      largeImageText: state.largeImageText ?? 'Onshape',
      smallImageKey: state.status === 'idle' ? 'idle' : 'active',
      smallImageText: state.smallImageText ?? 'Onshape',
      startTimestamp: Date.now(),
      buttons: [{ label: 'Open In Onshape', url: 'https://app.onshape.com' }],
    });
  }

  public async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    await this.client.destroy();
    this.client = null;
    this.connected = false;
  }
}
