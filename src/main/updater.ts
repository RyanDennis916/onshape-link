import { autoUpdater } from 'electron-updater';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Squirrel.Mac (the mechanism electron-updater uses on macOS) refuses to
// apply an update unless both the running app and the new build are code
// signed - it silently no-ops otherwise. Until this app is signed/notarized,
// this only meaningfully auto-updates Windows and Linux installs; macOS
// users will need to redownload from Releases in the meantime.
export function initAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.on('error', (error) => console.error('Auto-update check failed', error));

  void autoUpdater.checkForUpdatesAndNotify();

  const timer = setInterval(() => {
    void autoUpdater.checkForUpdatesAndNotify();
  }, CHECK_INTERVAL_MS);
  timer.unref();
}
