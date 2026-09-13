import { Client } from '@xhayper/discord-rpc';
import { DiscordConnectionState, PresenceState } from '../../shared/types';
import { isSamePresence, toActivity } from './presenceMapper';

const BACKOFF_SCHEDULE_MS = [5_000, 30_000, 60_000];

export interface DiscordRpcOptions {
  clientId: string;
  onStateChange?: (state: DiscordConnectionState) => void;
}

export class DiscordRpcClient {
  private client: Client | null = null;
  private state: DiscordConnectionState = 'disconnected';
  private retryIndex = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private running = false;
  private connecting = false;
  private paused = false;
  private pendingPresence: PresenceState | null = null;
  private activePresence: PresenceState | null = null;
  private presenceStartedAt = Date.now();
  private readonly clientId: string;
  private readonly onStateChange?: (state: DiscordConnectionState) => void;

  constructor(options: DiscordRpcOptions) {
    this.clientId = options.clientId;
    this.onStateChange = options.onStateChange;
  }

  public getState(): DiscordConnectionState {
    return this.state;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public start(): void {
    if (!this.clientId) {
      this.setState('unconfigured');
      return;
    }

    this.running = true;
    void this.connect();
  }

  public stop(): void {
    this.running = false;
    this.clearRetry();
    void this.destroyClient();
    this.setState('disconnected');
  }

  public reconnectNow(): void {
    if (!this.clientId) {
      this.setState('unconfigured');
      return;
    }

    this.clearRetry();
    this.retryIndex = 0;
    this.running = true;
    void this.destroyClient().then(() => this.connect());
  }

  public async setPresence(presence: PresenceState): Promise<void> {
    if (!isSamePresence(this.activePresence, presence)) {
      this.presenceStartedAt = presence.startedAt ?? Date.now();
    }

    this.pendingPresence = presence;

    if (this.paused) {
      return;
    }

    await this.pushPresence();
  }

  public async setPaused(paused: boolean): Promise<void> {
    if (this.paused === paused) {
      return;
    }

    this.paused = paused;

    if (paused) {
      await this.clearPresence();
      return;
    }

    await this.pushPresence();
  }

  public async clearPresence(): Promise<void> {
    this.activePresence = null;

    if (!this.client || this.state !== 'connected' || !this.client.user) {
      return;
    }

    try {
      await this.client.user.clearActivity();
    } catch (error) {
      console.error('Failed to clear Discord presence', error);
    }
  }

  private async pushPresence(): Promise<void> {
    const presence = this.pendingPresence;
    if (!presence || !this.client || this.state !== 'connected' || !this.client.user) {
      return;
    }

    try {
      await this.client.user.setActivity(toActivity(presence, this.presenceStartedAt));
      this.activePresence = presence;
    } catch (error) {
      console.error('Failed to set Discord presence', error);
    }
  }

  private async connect(): Promise<void> {
    if (!this.running || this.connecting || this.state === 'connected') {
      return;
    }

    this.connecting = true;
    this.setState('connecting');

    const client = new Client({ clientId: this.clientId });
    this.client = client;

    client.on('disconnected', () => {
      if (this.client !== client) {
        return;
      }

      this.activePresence = null;
      this.setState('disconnected');
      this.scheduleRetry();
    });

    client.on('error', (error) => {
      console.error('Discord RPC error', error);
    });

    try {
      await client.login();

      if (this.client !== client) {
        await client.destroy().catch(() => undefined);
        return;
      }

      this.retryIndex = 0;
      this.setState('connected');
      await this.pushPresence();
    } catch (error) {
      if (this.client === client) {
        this.client = null;
        this.setState('unavailable');
      }

      await client.destroy().catch(() => undefined);
      console.error('Discord RPC connect failed', error);
      this.scheduleRetry();
    } finally {
      this.connecting = false;
    }
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer) {
      return;
    }

    const delay = BACKOFF_SCHEDULE_MS[Math.min(this.retryIndex, BACKOFF_SCHEDULE_MS.length - 1)];
    this.retryIndex += 1;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);

    if (typeof this.retryTimer.unref === 'function') {
      this.retryTimer.unref();
    }
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private async destroyClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.activePresence = null;

    if (!client) {
      return;
    }

    client.removeAllListeners();
    await client.destroy().catch(() => undefined);
  }

  private setState(state: DiscordConnectionState): void {
    if (this.state === state) {
      return;
    }

    this.state = state;
    this.onStateChange?.(state);
  }
}
