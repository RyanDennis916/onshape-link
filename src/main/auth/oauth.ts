import { shell } from 'electron';
import { createServer, Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { OnshapeAuthState, OnshapeTokenSet, OnshapeUser } from '../../shared/types';
import { OnshapeTokenStore } from './tokenStore';

const AUTHORIZE_URL = 'https://oauth.onshape.com/oauth/authorize';
// Onshape's documented "user profile" endpoint for OAuth apps. (GET
// /users/session is not it - that one never returned a usable profile, so
// every otherwise-successful login ended in "Connection error".)
const SESSION_URL = 'https://cad.onshape.com/api/users/sessioninfo';
// Every port here must be registered, exactly as
// http://localhost:<port>/oauth/callback, as a redirect URL on the Onshape
// OAuth app. Onshape refuses to redirect to anything else, which from the
// app's side looks like a login that never comes back.
const REDIRECT_PORTS = [51823, 51824];
const REDIRECT_PATH = '/oauth/callback';
const REFRESH_MARGIN_MS = 60_000;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Raised when the token endpoint answers but refuses the request (as
 * opposed to a network failure), which is the only case where the stored
 * tokens are known to be dead and should be thrown away.
 */
class OnshapeTokenRejectedError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`Onshape token request failed (${status})${detail ? `: ${detail}` : ''}`);
  }
}

class LoginCancelledError extends Error {
  constructor() {
    super('Login attempt was superseded by a newer one');
  }
}

interface PendingCallback {
  server: Server;
  cancel: () => void;
}

export interface OnshapeAuthOptions {
  clientId: string;
  /**
   * Base URL of the token-relay service (see relay/) that holds the real
   * Onshape client secret. The desktop app never sees the secret - it
   * exchanges/refreshes tokens by calling `${tokenRelayUrl}/token`.
   */
  tokenRelayUrl: string;
  tokenStore: OnshapeTokenStore;
  onStateChange?: (state: OnshapeAuthState, user: OnshapeUser | null) => void;
}

export class OnshapeAuth {
  private readonly clientId: string;
  private readonly tokenRelayUrl: string;
  private readonly tokenStore: OnshapeTokenStore;
  private readonly onStateChange?: (state: OnshapeAuthState, user: OnshapeUser | null) => void;
  private tokens: OnshapeTokenSet | null = null;
  private user: OnshapeUser | null = null;
  private state: OnshapeAuthState = 'signed-out';
  private lastError: string | null = null;
  private loginAttempt = 0;
  private pendingCallback: PendingCallback | null = null;

  constructor(options: OnshapeAuthOptions) {
    this.clientId = options.clientId;
    this.tokenRelayUrl = options.tokenRelayUrl.replace(/\/+$/, '');
    this.tokenStore = options.tokenStore;
    this.onStateChange = options.onStateChange;
    this.tokens = this.tokenStore.load();
  }

  public getState(): OnshapeAuthState {
    return this.state;
  }

  public getUser(): OnshapeUser | null {
    return this.user;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public async restoreSession(): Promise<void> {
    if (!this.tokens) {
      this.setState('signed-out');
      return;
    }

    this.setState('connecting');

    try {
      await this.ensureFreshToken();
      this.user = await this.fetchCurrentUser();
      this.setState('connected');
    } catch (error) {
      console.error('Failed to restore Onshape session', error);
      this.dropTokensIfRejected(error);
      this.setState('error', error);
    }
  }

  /**
   * Starts a fresh browser login. Calling this while a previous attempt is
   * still waiting for its callback cancels that attempt (closing its
   * callback server) instead of piling up behind it - otherwise one
   * abandoned browser tab would leave the app stuck on "Connecting..." until
   * the callback timeout, with the redirect port still held.
   */
  public async login(): Promise<void> {
    const attempt = ++this.loginAttempt;
    this.cancelPendingCallback();
    this.setState('connecting');

    try {
      const { server, port } = await this.listenForCallback();
      const redirectUri = `http://localhost:${port}${REDIRECT_PATH}`;
      const state = randomBytes(16).toString('hex');
      const codePromise = this.waitForCode(server, state);

      const authorizeUrl = new URL(AUTHORIZE_URL);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', this.clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('state', state);
      await shell.openExternal(authorizeUrl.toString());

      const code = await codePromise;
      const tokens = await this.exchangeCode(code, redirectUri);
      if (attempt !== this.loginAttempt) {
        return;
      }

      this.tokens = tokens;
      this.tokenStore.save(tokens);
      this.user = await this.fetchCurrentUser();
      if (attempt === this.loginAttempt) {
        this.setState('connected');
      }
    } catch (error) {
      if (error instanceof LoginCancelledError || attempt !== this.loginAttempt) {
        return;
      }

      console.error('Onshape login failed', error);
      this.setState('error', error);
      throw error;
    }
  }

  public logout(): void {
    this.loginAttempt++;
    this.cancelPendingCallback();
    this.tokens = null;
    this.user = null;
    this.tokenStore.clear();
    this.setState('signed-out');
  }

  public async getAccessToken(): Promise<string | null> {
    if (!this.tokens) {
      return null;
    }

    try {
      await this.ensureFreshToken();
      return this.tokens.accessToken;
    } catch (error) {
      console.error('Failed to refresh Onshape token', error);
      // A network blip shouldn't sign the user out; only a refusal from
      // Onshape means the refresh token is actually dead.
      if (this.dropTokensIfRejected(error)) {
        this.setState('error', error);
      }
      return null;
    }
  }

  private dropTokensIfRejected(error: unknown): boolean {
    if (error instanceof OnshapeTokenRejectedError && error.status >= 400 && error.status < 500) {
      this.tokens = null;
      this.user = null;
      this.tokenStore.clear();
      return true;
    }
    return false;
  }

  private cancelPendingCallback(): void {
    this.pendingCallback?.cancel();
    this.pendingCallback = null;
  }

  private listenForCallback(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
      const tryPort = (index: number): void => {
        if (index >= REDIRECT_PORTS.length) {
          reject(
            new Error(
              `Ports ${REDIRECT_PORTS.join(', ')} are all in use - is another copy of Onshape Link running?`
            )
          );
          return;
        }

        const port = REDIRECT_PORTS[index];
        const server = createServer();
        // Browsers hold loopback connections open. Without this, a later
        // login's redirect could be answered over a kept-alive socket by an
        // earlier attempt's (already closed) server and never reach the
        // current one, which just stalls on "Connecting...".
        server.keepAliveTimeout = 0;

        server.once('error', (error: NodeJS.ErrnoException) => {
          server.close();
          if (error.code === 'EADDRINUSE') {
            tryPort(index + 1);
            return;
          }
          reject(error);
        });

        server.once('listening', () => resolve({ server, port }));
        // No host means Node binds the unspecified address, which is
        // dual-stack (IPv4 + IPv6) on every platform we ship to. That
        // matters because Onshape's OAuth app config only accepts
        // "localhost" (not an IP literal) as a redirect host, and
        // "localhost" can resolve to either 127.0.0.1 or ::1 depending on
        // the OS - Windows commonly picks ::1 first.
        server.listen(port);
      };

      tryPort(0);
    });
  }

  private waitForCode(server: Server, expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (error: Error | null, code?: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        server.close();
        server.closeAllConnections();
        if (this.pendingCallback?.server === server) {
          this.pendingCallback = null;
        }
        if (error) {
          reject(error);
        } else {
          resolve(code as string);
        }
      };

      const timeout = setTimeout(
        () => finish(new Error('Timed out waiting for the Onshape login to finish in the browser')),
        CALLBACK_TIMEOUT_MS
      );

      this.pendingCallback = { server, cancel: () => finish(new LoginCancelledError()) };

      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname !== REDIRECT_PATH) {
          res.writeHead(404, { Connection: 'close' }).end();
          return;
        }

        const authError = url.searchParams.get('error');
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');

        // A stale tab from an earlier attempt hitting the callback must not
        // kill the attempt that's actually in progress.
        if (!authError && returnedState !== expectedState) {
          respond(res, 'This sign-in link has expired. Return to Onshape Link and click Connect again.');
          return;
        }

        if (authError) {
          const description = url.searchParams.get('error_description');
          respond(res, 'Onshape sign-in was not completed. You can close this window.');
          finish(new Error(`Onshape authorization failed: ${description || authError}`));
          return;
        }

        if (!code) {
          respond(res, 'Onshape did not return an authorization code. Please try again.');
          finish(new Error('Onshape OAuth callback was missing the authorization code'));
          return;
        }

        respond(res, 'Signed in. You can close this window and return to Onshape Link.');
        finish(null, code);
      });
    });
  }

  private exchangeCode(code: string, redirectUri: string): Promise<OnshapeTokenSet> {
    return this.requestToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    });
  }

  private async ensureFreshToken(): Promise<void> {
    if (!this.tokens) {
      throw new Error('Not signed in to Onshape');
    }

    if (this.tokens.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return;
    }

    const previousRefreshToken = this.tokens.refreshToken;
    const refreshed = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: previousRefreshToken
    });
    this.tokens = { ...refreshed, refreshToken: refreshed.refreshToken || previousRefreshToken };
    this.tokenStore.save(this.tokens);
  }

  private async requestToken(params: Record<string, string>): Promise<OnshapeTokenSet> {
    if (!this.tokenRelayUrl) {
      throw new Error('Token relay is not configured');
    }

    const response = await fetch(`${this.tokenRelayUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, client_id: this.clientId }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new OnshapeTokenRejectedError(response.status, await readErrorDetail(response));
    }

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token) {
      throw new Error('Onshape token response did not include an access token');
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? '',
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000
    };
  }

  private async fetchCurrentUser(): Promise<OnshapeUser> {
    if (!this.tokens) {
      throw new Error('Not signed in to Onshape');
    }

    const response = await fetch(SESSION_URL, {
      headers: { Authorization: `Bearer ${this.tokens.accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Onshape profile request failed (${response.status}): ${await readErrorDetail(response)}`);
    }

    const payload = (await response.json()) as { id: string; name?: string; firstName?: string; email?: string };
    return { id: payload.id, name: payload.name || payload.firstName || payload.email || 'Onshape user' };
  }

  private setState(state: OnshapeAuthState, error?: unknown): void {
    this.state = state;
    this.lastError = state === 'error' ? describeError(error) : null;
    this.onStateChange?.(state, this.user);
  }
}

function respond(res: import('node:http').ServerResponse, message: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
  res.end(`<html><body style="font-family:sans-serif;padding:2em">${message}</body></html>`);
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    try {
      const parsed = JSON.parse(text) as { error?: string; error_description?: string; message?: string };
      return parsed.error_description || parsed.message || parsed.error || text;
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return '';
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'Onshape took too long to respond. Check your connection and try again.';
    }
    return error.message;
  }
  return error ? String(error) : 'Unknown error';
}
