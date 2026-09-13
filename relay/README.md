# Onshape token relay

Holds the real Onshape OAuth client secret so the desktop app never has to.
The app only ever calls this worker's `/token` endpoint; the worker attaches
the secret and forwards to Onshape.

## Deploy (Cloudflare Workers, free tier)

```
cd relay
npx wrangler login
npx wrangler secret put ONSHAPE_CLIENT_ID
npx wrangler secret put ONSHAPE_CLIENT_SECRET
npx wrangler deploy
```

`wrangler deploy` prints the worker's URL (e.g.
`https://onshape-link-token-relay.<your-subdomain>.workers.dev`). That's the
value that goes into `TOKEN_RELAY_URL` in the main app's config
(`src/main/config.ts`'s `PUBLIC_DEFAULTS`, or `.env` for local dev).

## Local dev

```
cd relay
npx wrangler dev
```

Runs the worker on `http://localhost:8787`, matching the default in
`.env.example`.

## Rotating the secret

If the secret is ever compromised, generate a new one in the Onshape
Developer Portal for this OAuth application and re-run
`wrangler secret put ONSHAPE_CLIENT_SECRET`. No app update or user action is
needed - existing users keep working as soon as the worker redeploys.
