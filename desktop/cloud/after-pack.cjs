// macOS: puts the Finder's drive into the app when it was built (`drive/build.sh` with
// DRIVE_BUNDLE_ID=dev.bertro.cloud into `build/drive`): the extension into Contents/PlugIns, its
// helper beside the app's binary. The extension comes signed with entitlements of its own; without them the app is a window on the server only.
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // CLOUD_DRIVE_DIR: a drive built somewhere else (`cloud/pack.sh` with CLOUD_OUT).
  const drive =
    process.env.CLOUD_DRIVE_DIR || path.join(context.packager.projectDir, 'build', 'drive');
  const appex = path.join(drive, 'CloudDrive.appex');
  if (!existsSync(appex)) return;
  const contents = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
  );
  mkdirSync(path.join(contents, 'PlugIns'), { recursive: true });
  execFileSync('ditto', [appex, path.join(contents, 'PlugIns', 'CloudDrive.appex')]);
  execFileSync('ditto', [
    path.join(drive, 'cloud-drive'),
    path.join(contents, 'MacOS', 'cloud-drive'),
  ]);
};
