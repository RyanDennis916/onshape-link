import { contextBridge, ipcRenderer } from 'electron';
import { DiscordConnectionState, OnshapeAuthState, OnshapeUser } from '../shared/types';

export interface OnboardingState {
  discordState: DiscordConnectionState;
  onshapeState: OnshapeAuthState;
  onshapeUser: OnshapeUser | null;
}

contextBridge.exposeInMainWorld('onshapeLink', {
  connect: (): Promise<void> => ipcRenderer.invoke('onshape:connect'),
  getState: (): Promise<OnboardingState> => ipcRenderer.invoke('onshape:get-state'),
  onStateChange: (callback: (state: OnboardingState) => void): void => {
    ipcRenderer.on('onshape:state', (_event, state: OnboardingState) => callback(state));
  }
});
