export type PresenceStatus = 'not-connected' | 'connected' | 'idle';

export interface PresenceState {
  status: PresenceStatus;
  details: string;
  state: string;
  largeImageText?: string;
  smallImageText?: string;
}
