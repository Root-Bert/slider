// LibreOffice draws the slides and renders every edit. The app doesn't carry it (≈ 600 MB):
// an installed LibreOffice is used as it is, else it is loaded once into the app's data folder –
// one pinned, tested version from The Document Foundation, checked against its SHA-256.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { net } from 'electron';

const run = promisify(execFile);

const VERSION = '26.8.2';
/**
 * Per Mac architecture: folder and file on download.documentfoundation.org, its size (for the
 * progress when a mirror sends none) and its SHA-256, both from there.
 */
const BUILDS = {
  arm64: {
    folder: 'aarch64',
    file: `LibreOffice_${VERSION}_MacOS_aarch64.dmg`,
    bytes: 299_236_406,
    sha256: '9f24fe83ab1ed5c95eb3df580119f32932f713e577feeac02bf619fb00749b55',
  },
  x64: {
    folder: 'x86_64',
    file: `LibreOffice_${VERSION}_MacOS_x86-64.dmg`,
    bytes: 309_690_507,
    sha256: '0af062779cc17f6f852918b2424c745f7dd2d20d51d7fb8a0925eb92ec0417a7',
  },
};
/** Linux: no download, the distribution's package is the way. */
export const LINUX_HINT =
  'Installiere LibreOffice über die Paketverwaltung deines Systems, zum Beispiel mit „sudo apt install libreoffice“, und starte Slider dann neu.';
/** Roughly what the download weighs, for the question before it. */
export const DOWNLOAD_MB = 300;

const SOFFICE = path.join('Contents', 'MacOS', 'soffice');

/**
 * Where Slider keeps the LibreOffice it loaded: a plain folder, never `*.app` – macOS checks a
 * copied app bundle before its first start and holds `soffice` at launch, since the Python
 * framework's seal is broken in LibreOffice's own build; a plain folder starts at once.
 */
const loadedFolder = (userData) => path.join(userData, 'libreoffice');

/**
 * `soffice` to use: the one loaded earlier, else an installed LibreOffice; `null`: none.
 * `installed: false` (tests) looks at the loaded one only.
 */
export function findLibreOffice(userData, { installed = true } = {}) {
  if (process.platform === 'linux') {
    if (!installed) return null;
    // The distribution's package (apt, dnf, pacman), TDF's own packages under /opt, or a snap.
    const opt = existsSync('/opt')
      ? readdirSync('/opt')
          .filter((name) => name.startsWith('libreoffice'))
          .sort()
          .reverse()
          .map((name) => path.join('/opt', name, 'program/soffice'))
      : [];
    const candidates = [
      '/usr/bin/soffice',
      '/usr/lib/libreoffice/program/soffice',
      '/usr/lib64/libreoffice/program/soffice',
      ...opt,
      '/snap/bin/libreoffice',
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }
  const loaded = path.join(loadedFolder(userData), SOFFICE);
  if (!installed) return existsSync(loaded) ? loaded : null;
  const candidates = [
    loaded,
    path.join('/Applications/LibreOffice.app', SOFFICE),
    path.join(os.homedir(), 'Applications/LibreOffice.app', SOFFICE),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Loads, checks and sets up LibreOffice; resolves to its `soffice`. `onProgress(phase, share)`:
 * `download` with the share loaded (0…1), then `setup` (`share` null).
 */
export async function installLibreOffice(userData, onProgress) {
  if (process.platform !== 'darwin') throw new Error(LINUX_HINT);
  const build = BUILDS[process.arch];
  if (!build) throw new Error(`Für diesen Mac (${process.arch}) gibt es kein LibreOffice.`);
  const work = path.join(userData, 'libreoffice-setup');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const dmg = path.join(work, build.file);
  const mount = path.join(work, 'volume');
  const staged = path.join(work, 'libreoffice');
  let mounted = false;
  try {
    const url = `https://download.documentfoundation.org/libreoffice/stable/${VERSION}/mac/${build.folder}/${build.file}`;
    const digest = await download(url, dmg, build.bytes, (share) => onProgress('download', share));
    if (digest !== build.sha256) {
      throw new Error('Die geladene Datei ist beschädigt (Prüfsumme stimmt nicht).');
    }
    onProgress('setup', null);
    mkdirSync(mount);
    await run('hdiutil', [
      'attach',
      dmg,
      '-nobrowse',
      '-readonly',
      '-noautoopen',
      '-mountpoint',
      mount,
    ]);
    mounted = true;
    await run('ditto', [path.join(mount, 'LibreOffice.app'), staged]);
    await run('hdiutil', ['detach', mount, '-force']);
    mounted = false;
    await run('xattr', ['-dr', 'com.apple.quarantine', staged]).catch(() => {});
    slim(staged);
    // It has to start before it counts as set up.
    await run(path.join(staged, SOFFICE), ['--version'], { timeout: 60_000 });
    rmSync(loadedFolder(userData), { recursive: true, force: true });
    renameSync(staged, loadedFolder(userData));
    return path.join(loadedFolder(userData), SOFFICE);
  } finally {
    if (mounted) await run('hdiutil', ['detach', mount, '-force']).catch(() => {});
    rmSync(work, { recursive: true, force: true });
  }
}

/** Streams `url` into `file`; resolves to its SHA-256 (hex). */
async function download(url, file, expectedBytes, onShare) {
  onShare(0);
  const response = await net.fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download fehlgeschlagen (HTTP ${response.status}).`);
  }
  const total = Number(response.headers.get('content-length')) || expectedBytes;
  const hash = createHash('sha256');
  let loaded = 0;
  let shown = 0;
  // A write that fails (disk full) or waits for the disk ends or holds the download with it.
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (chunks) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        loaded += chunk.byteLength;
        const share = Math.min(loaded / total, 1);
        const percent = Math.floor(share * 100);
        if (percent !== shown) {
          shown = percent;
          onShare(share);
        }
        yield chunk;
      }
    },
    createWriteStream(file),
  );
  return hash.digest('hex');
}

/**
 * What a headless converter never uses: help, dictionaries and extensions (Slider checks
 * spelling itself), the gallery, Java, the wizards and every icon theme but the default one.
 */
function slim(office) {
  const resources = path.join(office, 'Contents', 'Resources');
  for (const unused of ['help', 'extensions', 'gallery', 'java', 'wizards']) {
    rmSync(path.join(resources, unused), { recursive: true, force: true });
  }
  for (const theme of readdirSync(path.join(resources, 'config'))) {
    if (/^images_.*\.zip$/.test(theme) && theme !== 'images_colibre.zip') {
      rmSync(path.join(resources, 'config', theme));
    }
  }
}
