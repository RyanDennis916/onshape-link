import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SETTINGS_FILE_NAME = 'settings.json';

interface StoredSettings {
  presenceEnabled: boolean;
}

// Packaged builds ship with no .env, so PRESENCE_ENABLED from config.ts only
// ever supplies the first-run default - this is what actually persists a
// user's "Pause Presence Updates" choice across restarts.
export class SettingsStore {
  private readonly filePath: string;

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, SETTINGS_FILE_NAME);
  }

  public loadPresenceEnabled(defaultValue: boolean): boolean {
    if (!existsSync(this.filePath)) {
      return defaultValue;
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoredSettings>;
      return typeof parsed.presenceEnabled === 'boolean' ? parsed.presenceEnabled : defaultValue;
    } catch (error) {
      console.error('Failed to read stored settings', error);
      return defaultValue;
    }
  }

  public savePresenceEnabled(enabled: boolean): void {
    try {
      writeFileSync(this.filePath, JSON.stringify({ presenceEnabled: enabled } satisfies StoredSettings));
    } catch (error) {
      console.error('Failed to save settings', error);
    }
  }
}
