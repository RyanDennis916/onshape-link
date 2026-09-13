export type PresenceStatus = 'not-connected' | 'connected' | 'idle';

export type DiscordConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'unavailable'
  | 'unconfigured';

export type ElementType = 'part-studio' | 'assembly' | 'drawing' | 'unknown';

export interface PresenceState {
  status: PresenceStatus;
  details: string;
  state: string;
  elementType?: ElementType;
  startedAt?: number;
  documentUrl?: string;
  largeImageText?: string;
  smallImageText?: string;
}

export interface AppConfig {
  discordClientId: string;
  pollIntervalSec: number;
  idleTimeoutMin: number;
  enabled: boolean;
}
