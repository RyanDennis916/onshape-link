import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppConfig } from '../shared/types';

const PLACEHOLDER_CLIENT_ID = 'YOUR_DISCORD_APPLICATION_ID';
const PLACEHOLDER_ONSHAPE_CLIENT_ID = 'YOUR_ONSHAPE_CLIENT_ID';
const PLACEHOLDER_ONSHAPE_CLIENT_SECRET = 'YOUR_ONSHAPE_CLIENT_SECRET';
const DEFAULT_POLL_INTERVAL_SEC = 15;
const DEFAULT_IDLE_TIMEOUT_MIN = 10;

function parseEnv(contents: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    if (!key) {
      continue;
    }

    let value = line.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));

    if (quoted && value.length >= 2) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

export function loadEnvFile(rootDir: string): void {
  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const parsed = parseEnv(readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(rootDir: string): AppConfig {
  loadEnvFile(rootDir);

  const clientId = (process.env.DISCORD_CLIENT_ID ?? '').trim();
  const onshapeClientId = (process.env.ONSHAPE_CLIENT_ID ?? '').trim();
  const onshapeClientSecret = (process.env.ONSHAPE_CLIENT_SECRET ?? '').trim();

  return {
    discordClientId: clientId === PLACEHOLDER_CLIENT_ID ? '' : clientId,
    onshapeClientId: onshapeClientId === PLACEHOLDER_ONSHAPE_CLIENT_ID ? '' : onshapeClientId,
    onshapeClientSecret:
      onshapeClientSecret === PLACEHOLDER_ONSHAPE_CLIENT_SECRET ? '' : onshapeClientSecret,
    pollIntervalSec: readNumber('POLL_INTERVAL_SEC', DEFAULT_POLL_INTERVAL_SEC),
    idleTimeoutMin: readNumber('IDLE_TIMEOUT_MIN', DEFAULT_IDLE_TIMEOUT_MIN),
    enabled: process.env.PRESENCE_ENABLED !== 'false'
  };
}
