/**
 * Onshape OAuth token-relay.
 *
 * The desktop app is public (open-source, auto-updating) so it can never
 * hold the real Onshape client secret - anyone could pull it out of the
 * bundle. This worker is the only thing that holds it. The app calls
 * POST /token with the same params it would otherwise send straight to
 * Onshape (minus client_secret), the worker attaches the secret server-side
 * and forwards the request to Onshape's token endpoint, then passes the
 * response straight back through.
 */

const ONSHAPE_TOKEN_URL = 'https://oauth.onshape.com/oauth/token';
const ALLOWED_GRANT_TYPES = new Set(['authorization_code', 'refresh_token']);

export default {
  async fetch(request, env) {
    // Trim defensively: a value pasted into `wrangler secret put` easily
    // picks up a stray newline, and Onshape then rejects the client with a
    // generic "Could not authenticate client".
    const expectedClientId = (env.ONSHAPE_CLIENT_ID ?? '').trim();
    const clientSecret = (env.ONSHAPE_CLIENT_SECRET ?? '').trim();
    if (!expectedClientId || !clientSecret) {
      return json({ error: 'server_error', error_description: 'Relay is missing its Onshape client credentials' }, 500);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    const url = new URL(request.url);
    if (url.pathname !== '/token') {
      return json({ error: 'not_found' }, 404);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid_request', error_description: 'Body must be JSON' }, 400);
    }

    const { grant_type: grantType, client_id: clientId, code, redirect_uri: redirectUri, refresh_token: refreshToken } = body;

    if (!ALLOWED_GRANT_TYPES.has(grantType)) {
      return json({ error: 'unsupported_grant_type' }, 400);
    }

    if (typeof clientId !== 'string' || clientId.trim() !== expectedClientId) {
      return json(
        { error: 'invalid_client', error_description: 'Client id does not match the one this relay is configured for' },
        401
      );
    }

    const params = new URLSearchParams({
      grant_type: grantType,
      client_id: expectedClientId,
      client_secret: clientSecret
    });

    if (grantType === 'authorization_code') {
      if (!code || !redirectUri) {
        return json({ error: 'invalid_request' }, 400);
      }
      params.set('code', code);
      params.set('redirect_uri', redirectUri);
    } else {
      if (!refreshToken) {
        return json({ error: 'invalid_request' }, 400);
      }
      params.set('refresh_token', refreshToken);
    }

    let upstream;
    try {
      upstream = await fetch(ONSHAPE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: params.toString()
      });
    } catch (error) {
      return json({ error: 'temporarily_unavailable', error_description: `Could not reach Onshape: ${error}` }, 502);
    }

    const upstreamBody = await upstream.text();
    return new Response(upstreamBody, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
