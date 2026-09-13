# Onshape Link

A simple link to Discord for Onshape users. Shows what document/tab you have
open in Onshape as your Discord Rich Presence.

## Installing (end users)

1. Grab the installer for your OS from the [Releases page](https://github.com/RyanDennis916/onshape-link/releases) - `.dmg` (macOS), `.exe` (Windows), or `.AppImage`/`.deb` (Linux).
2. Install and launch it. It runs from the tray/menu bar; no dock icon.
3. Discord: nothing to do - if Discord desktop is running, presence just shows up.
4. Onshape: a small window opens on first launch - click **Connect to Onshape**, log in in your browser, done.

No API keys, no `.env` file, no developer account needed - both integrations are pre-configured in the app.

> **macOS note:** builds aren't code-signed/notarized yet, so Gatekeeper will call the app "damaged" or from an "unidentified developer" on first open. Right-click the app → **Open**, or run `xattr -cr "/Applications/Onshape Link.app"` once.
> **Auto-update:** works out of the box on Windows/Linux. macOS auto-update requires a signed build, so until this is signed, macOS users update by re-downloading from Releases.

## Development

```
npm install
npm run build && npm start
```

Copy `.env.example` to `.env` to point the dev build at a test Discord app / Onshape OAuth app / local relay instead of the baked-in production ones.

## Maintainer setup (one-time, before the first release)

The whole point of packaging is that end users never register their own Discord or Onshape apps - you register one of each, and the app ships with those baked in.

1. **Discord**: create an Application in the [Discord Developer Portal](https://discord.com/developers/applications), copy its Application ID.
2. **Onshape OAuth app**: register one in the Onshape Developer Portal, with redirect URIs `http://localhost:51823/oauth/callback` and `http://localhost:51824/oauth/callback`. Copy the client ID and secret.
3. **Deploy the token relay** (see [relay/README.md](relay/README.md)) with that Onshape client ID/secret - this is the only place the secret ever lives. Note the deployed worker URL.
4. Fill in `PUBLIC_DEFAULTS` in [src/main/config.ts](src/main/config.ts) with the Discord client ID, Onshape client ID, and relay URL. These three values are not secret and are safe to commit.
5. Tag a release (`git tag v0.1.0 && git push --tags`) - [.github/workflows/release.yml](.github/workflows/release.yml) builds installers for macOS/Windows/Linux and publishes them to GitHub Releases via `electron-builder`.

### Known limitations

- Builds are unsigned (see notes above) - a real distribution launch should budget for an Apple Developer account and a Windows code-signing certificate.
- Onshape has no reliable way to know which of several simultaneously open tabs has focus; presence is inferred from your most recently opened document (see [src/main/onshape/client.ts](src/main/onshape/client.ts)).
