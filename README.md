# Onshape Link

A simple link to Discord for Onshape users. Shows what document/tab you have
open in Onshape as your Discord Rich Presence. NLTTL :3.

## Installing (end users, use Discord Desktop)

1. fetch the installer for your OS from the [Releases page](https://github.com/RyanDennis916/onshape-link/releases) (`.dmg` (macOS), `.exe` (Windows), or `.AppImage`/`.deb` (Linux).)
2. install and launch it. It runs from the tray/menu bar so don't expect a dock icon.
3. if Discord desktop is running, presence just shows up.
4. Onshape: a small window opens on first launch - click **Connect to Onshape**, log in in your browser. 
5. to pull up the pop-up again: cmd/ctrl-shift-o.


> **macOS note:** builds aren't approved/signed yet, so it will call the app "damaged" or from an "unidentified developer" on first open. Right-click the app → **Open**, or run `xattr -cr "/Applications/Onshape Link.app"` once.
> **Auto-update:** works out of the box on Windows/Linux. macOS auto-update requires a signed build, so until this is signed, you macOS users have to update by re-downloading from Releases. Pretty annoying.

## Development

```
npm install
npm run build && npm start
```

Copy `.env.example` to `.env` to point the dev build at a test Discord app / Onshape OAuth app / local relay instead of production ones.

### Known limitations

- I have no code signing for this app on either Windows or macOS.
- Onshape has no reliable way to know which of several simultaneously open tabs has focus; presence is inferred from your most recently opened document (see [src/main/onshape/client.ts](src/main/onshape/client.ts)).
