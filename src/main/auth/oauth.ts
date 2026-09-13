import { shell } from 'electron';
import { createServer, Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { OnshapeAuthState, OnshapeTokenSet, OnshapeUser } from '../../shared/types';
import { OnshapeTokenStore } from './tokenStore';

const AUTHORIZE_URL = 'https://oauth.onshape.com/oauth/authorize';
const SESSION_URL = 'https://cad.onshape.com/api/users/session';
const REDIRECT_PORTS = [51823, 51824];
const REDIRECT_PATH = '/oauth/callback';
const REFRESH_MARGIN_MS = 60_000;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

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
  private loginInFlight: Promise<void> | null = null;

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
      this.tokens = null;
      this.tokenStore.clear();
      this.setState('error');
    }
  }

  public login(): Promise<void> {
    if (!this.loginInFlight) {
      this.loginInFlight = this.runLoginFlow().finally(() => {
        this.loginInFlight = null;
      });
    }

    return this.loginInFlight;
  }

  public logout(): void {
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
      this.tokens = null;
      this.tokenStore.clear();
      this.setState('error');
      return null;
    }
  }

  private async runLoginFlow(): Promise<void> {
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
      this.tokens = await this.exchangeCode(code, redirectUri);
      this.tokenStore.save(this.tokens);
      this.user = await this.fetchCurrentUser();
      this.setState('connected');
    } catch (error) {
      console.error('Onshape login failed', error);
      this.setState('error');
      throw error;
    }
  }

  private listenForCallback(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
      const tryPort = (index: number): void => {
        if (index >= REDIRECT_PORTS.length) {
          reject(new Error('No configured redirect port is available'));
          return;
        }

        const port = REDIRECT_PORTS[index];
        const server = createServer();

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
        // the OS - Windows commonly picks ::1 first. Binding only IPv4 (as
        // this used to) left the server deaf to that request, so the
        // browser's callback just hung instead of completing.
        server.listen(port);
      };

      tryPort(0);
    });
  }

  private waitForCode(server: Server, expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('Timed out waiting for Onshape OAuth callback'));
      }, CALLBACK_TIMEOUT_MS);

      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname !== REDIRECT_PATH) {
          res.writeHead(404).end();
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>You can close this window and return to onshape-link.</body></html>');
        clearTimeout(timeout);
        server.close();

        const authError = url.searchParams.get('error');
        if (authError) {
          reject(new Error(`Onshape authorization failed: ${authError}`));
          return;
        }

        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        if (!code || returnedState !== expectedState) {
          reject(new Error('Invalid Onshape OAuth callback'));
          return;
        }

        resolve(code);
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

    this.tokens = await this.requestToken({
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken
    });
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
      throw new Error(`Onshape token request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + payload.expires_in * 1000
    };
  }

  private async fetchCurrentUser(): Promise<OnshapeUser> {
    if (!this.tokens) {
      throw new Error('Not signed in to Onshape');
    }

    const response = await fetch(SESSION_URL, {
      headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Onshape session request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { id: string; name: string };
    return { id: payload.id, name: payload.name };
  }

  private setState(state: OnshapeAuthState): void {
    this.state = state;
    this.onStateChange?.(state, this.user);
  }
}
