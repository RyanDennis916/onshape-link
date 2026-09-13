import { safeStorage } from 'electron';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OnshapeTokenSet } from '../../shared/types';

const TOKEN_FILE_NAME = 'onshape-tokens.bin';

export class OnshapeTokenStore {
  private readonly filePath: string;

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, TOKEN_FILE_NAME);
  }

  public load(): OnshapeTokenSet | null {
    if (!existsSync(this.filePath) || !safeStorage.isEncryptionAvailable()) {
      return null;
    }

    try {
      const encrypted = readFileSync(this.filePath);
      const decrypted = safeStorage.decryptString(encrypted);
      return JSON.parse(decrypted) as OnshapeTokenSet;
    } catch (error) {
      console.error('Failed to read stored Onshape tokens', error);
      return null;
    }
  }

  public save(tokens: OnshapeTokenSet): void {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('OS-level encryption is unavailable; Onshape tokens will not be persisted.');
      return;
    }

    const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
    writeFileSync(this.filePath, encrypted);
  }

  public clear(): void {
    if (existsSync(this.filePath)) {
      unlinkSync(this.filePath);
    }
  }
}
