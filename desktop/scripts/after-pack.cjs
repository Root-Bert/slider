// Copies the stage (scripts/stage.mjs) into the packaged app as it is: electron-builder's
// extraResources leave out node_modules, which the API needs. macOS: Slider.app/Contents/Resources,
// Linux: resources/ next to the binary.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const mac = context.electronPlatformName === 'darwin';
  const resources = mac
    ? path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        'Contents',
        'Resources',
      )
    : path.join(context.appOutDir, 'resources');
  const stage = path.join(context.packager.projectDir, 'build');
  for (const dir of ['app', 'bin']) {
    execFileSync('rm', ['-rf', path.join(resources, dir)]);
    // ditto keeps macOS metadata; the stage has no links left, so plain cp -R does on Linux.
    if (mac) execFileSync('ditto', [path.join(stage, dir), path.join(resources, dir)]);
    else execFileSync('cp', ['-R', path.join(stage, dir), path.join(resources, dir)]);
  }
};
