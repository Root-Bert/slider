// Unpackaged, the Dock names the app after Electron's bundle folder ("Electron.app") – the
// Info.plist alone is not enough. So the repo start runs a clone of it named Slider.app
// (`node_modules/.slider-dev`, an APFS clone: no extra space), made again when Electron changes.
// The executable inside stays "Electron", so `app.isPackaged` stays false. The packaged app gets
// its name from electron-builder. Starts the app with the arguments given (`.`).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const electron = createRequire(import.meta.url)('electron');

function sliderApp() {
  const dist = fileURLToPath(new URL('../node_modules/electron/dist/', import.meta.url));
  const source = `${dist}Electron.app`;
  const dir = fileURLToPath(new URL('../node_modules/.slider-dev/', import.meta.url));
  const app = `${dir}Slider.app`;
  const version = readFileSync(`${dist}version`, 'utf8').trim();
  const stamp = `${dir}version`;
  if (!existsSync(app) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== version) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('cp', ['-cR', source, app]);
    const plist = `${app}/Contents/Info.plist`;
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('plutil', ['-replace', key, '-string', 'Slider', plist]);
    }
    // LaunchServices learns the name when the bundle is registered.
    const lsregister =
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    if (existsSync(lsregister)) execFileSync(lsregister, ['-f', app]);
    writeFileSync(stamp, version);
  }
  return `${app}/Contents/MacOS/Electron`;
}

const binary = process.platform === 'darwin' ? sliderApp() : electron;
const child = spawn(binary, process.argv.slice(2), { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
