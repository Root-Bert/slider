// Updates from the GitHub releases of Root-Bert/slider (package.json → build.publish): looked for
// at start and every 6 h, loaded in the background, installed on „Neu starten“ or the next quit.
// Only the packaged app; macOS installs only signed updates, so an unsigned build just logs the
// refusal to logs/updates.log and keeps running.
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const EVERY = 6 * 60 * 60 * 1000;

let started = false;
let asked = false;

/** @param {{ logDir: string, window: () => import('electron').BaseWindow | null }} options */
export function startUpdates({ logDir, window }) {
  if (!app.isPackaged || started) return;
  started = true;
  const out = createWriteStream(path.join(logDir, 'updates.log'), { flags: 'a' });
  const line =
    (level) =>
    (...parts) =>
      out.write(`${new Date().toISOString()} ${level} ${parts.join(' ')}\n`);
  autoUpdater.logger = {
    info: line('info'),
    warn: line('warn'),
    error: line('error'),
    debug: () => {},
  };
  // Set here, not only through the app-update.yml electron-builder writes: `--dir` builds have none.
  autoUpdater.setFeedURL({ provider: 'github', owner: 'Root-Bert', repo: 'slider' });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', async ({ version }) => {
    if (asked) return;
    asked = true;
    const parent = window();
    const options = {
      type: 'info',
      message: `Slider ${version} ist bereit`,
      detail: 'Neu starten und die neue Version nutzen? Sonst kommt sie beim nächsten Beenden.',
      buttons: ['Neu starten', 'Später'],
      defaultId: 0,
      cancelId: 1,
    };
    const { response } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    if (response === 0) autoUpdater.quitAndInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {}); // logged by the logger
  check();
  setInterval(check, EVERY).unref();
}

/** Hilfe → Nach Updates suchen: says what it found, the download then runs as usual. */
export async function checkFromMenu(parent) {
  const show = (message, detail) =>
    parent
      ? dialog.showMessageBox(parent, { type: 'info', message, detail })
      : dialog.showMessageBox({ type: 'info', message, detail });
  if (!app.isPackaged) {
    await show('Updates gibt es nur in der installierten App', 'Aus dem Repo gestartet.');
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version;
    if (result?.isUpdateAvailable && latest) {
      await show(`Slider ${latest} wird geladen`, 'Ist sie da, fragt Slider nach dem Neustart.');
    } else {
      await show('Slider ist aktuell', `Version ${app.getVersion()}`);
    }
  } catch (error) {
    await show('Nach Updates suchen hat nicht geklappt', error.message);
  }
}
