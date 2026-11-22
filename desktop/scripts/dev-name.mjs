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

/**
 * `--cloud` first: the clone is Cloud.app (`cloud/main.mjs`), with an id of its own so its
 * links (`slider-cloud://`) do not land in Slider's clone. `--writer`: Writer.app
 * (`writer/main.mjs`, `slider-writer://`) likewise, `--reader` Reader.app (`reader/main.mjs`,
 * `slider-reader://`), `--sender` Sender.app (`sender/main.mjs`, `slider-sender://`).
 */
const OTHER = {
  '--cloud': { name: 'Cloud', id: 'dev.bertro.cloud.dev', folder: '../cloud/' },
  '--writer': { name: 'Writer', id: 'dev.bertro.writer.dev', folder: '../writer/' },
  '--reader': { name: 'Reader', id: 'dev.bertro.reader.dev', folder: '../reader/' },
  '--sender': { name: 'Sender', id: 'dev.bertro.sender.dev', folder: '../sender/' },
};
const other = OTHER[process.argv[2]] ?? null;
const NAME = other?.name ?? 'Slider';
/** Where the app's `main.mjs` and `icon.png` lie. */
const FOLDER = other?.folder ?? '../';
const args = process.argv.slice(other ? 3 : 2);

/** Made anew when Electron changes – or how the clone is made (`+app`). */
const stampOf = (version) => `${version}+app`;

function sliderApp() {
  const dist = fileURLToPath(new URL('../node_modules/electron/dist/', import.meta.url));
  const source = `${dist}Electron.app`;
  const dir = fileURLToPath(
    new URL(`../node_modules/.${NAME.toLowerCase()}-dev/`, import.meta.url),
  );
  const app = `${dir}${NAME}.app`;
  const version = readFileSync(`${dist}version`, 'utf8').trim();
  const stamp = `${dir}version`;
  if (!existsSync(app) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== stampOf(version)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('cp', ['-cR', source, app]);
    const plist = `${app}/Contents/Info.plist`;
    for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
      execFileSync('plutil', ['-replace', key, '-string', NAME, plist]);
    }
    if (other) {
      execFileSync('plutil', ['-replace', 'CFBundleIdentifier', '-string', other.id, plist]);
    }
    // The bundle's own icon too: Mission Control and the app switcher show that one, not the
    // Dock icon the app sets while running.
    const iconset = `${dir}${NAME}.iconset`;
    mkdirSync(iconset, { recursive: true });
    const icon = fileURLToPath(new URL(`${FOLDER}icon.png`, import.meta.url));
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        const px = String(size * scale);
        execFileSync('sips', ['-z', px, px, icon, '--out', `${iconset}/${name}`], {
          stdio: 'ignore',
        });
      }
    }
    execFileSync('iconutil', [
      '-c',
      'icns',
      iconset,
      '-o',
      `${app}/Contents/Resources/electron.icns`,
    ]);
    rmSync(iconset, { recursive: true, force: true });
    // Started by the system – a `slider://` link from the other app, a click in the Dock – the
    // clone gets no path and would show Electron's own page: an app inside it leads to the repo's.
    const inside = `${app}/Contents/Resources/app`;
    const main = fileURLToPath(new URL(`${FOLDER}main.mjs`, import.meta.url));
    mkdirSync(inside, { recursive: true });
    writeFileSync(`${inside}/package.json`, JSON.stringify({ name: NAME, main: 'main.mjs' }));
    writeFileSync(
      `${inside}/main.mjs`,
      `const main = ${JSON.stringify(main)};
// The repo's main reads its own path from the arguments (how it registers its links).
if (!process.argv[1] || process.argv[1].startsWith('-')) process.argv.splice(1, 0, main);
await import(${JSON.stringify(new URL(`${FOLDER}main.mjs`, import.meta.url).href)});
`,
    );
    // LaunchServices learns the name when the bundle is registered.
    const lsregister =
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    if (existsSync(lsregister)) execFileSync(lsregister, ['-f', app]);
    writeFileSync(stamp, stampOf(version));
  }
  return `${app}/Contents/MacOS/Electron`;
}

const binary = process.platform === 'darwin' ? sliderApp() : electron;
// `--make`: the clone only (so the other app's links find it), nothing started.
if (args[0] === '--make') process.exit(0);
const child = spawn(binary, args, { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
