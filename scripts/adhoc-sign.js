// electron-builder afterPack hook: ad-hoc sign the macOS app bundle.
//
// We have no Developer ID certificate yet, so electron-builder's own signing
// is off (mac.identity = null). Left like that, the bundle ships with
// Electron's original signature broken by our renamed/rebranded files, and
// Apple Silicon Macs refuse it as "damaged". An ad-hoc signature ("-") is
// free and makes the bundle internally consistent, so Gatekeeper instead
// shows the normal "unidentified developer" prompt that users can allow via
// System Settings > Privacy & Security > Open Anyway.
//
// Remove this hook once real Developer ID signing + notarization is set up.
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
};
