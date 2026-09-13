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
  onshapeClientId: string;
  onshapeClientSecret: string;
  pollIntervalSec: number;
  idleTimeoutMin: number;
  enabled: boolean;
}

export type OnshapeAuthState = 'signed-out' | 'connecting' | 'connected' | 'error';

export interface OnshapeTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface OnshapeUser {
  id: string;
  name: string;
}
