// Cloud desktop: the account's files as an app of their own, beside Slider. A window on the
// Cloud pages of the server signed in to, and – on a Mac, packaged – that server's files as a
// place in the Finder (`../drive`). Nothing is kept here but the session, sealed in the system's
// keychain (safeStorage); offline, the files are the Finder's.
import { app, Menu, dialog, ipcMain, nativeTheme, safeStorage, session, shell } from 'electron';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTabWindow } from '../tabs.mjs';

/** As `DESKTOP_SCHEMES.cloud` (@slider/shared desktop.ts): `slider-cloud://auth?code=…&state=…`. */
const SCHEME = 'slider-cloud';
const DEFAULT_SERVER = process.env.CLOUD_SERVER || 'https://slider.bertro.dev';
/** How often the Finder is told to ask the server for news. */
const SIGNAL_EVERY_MS = 30_000;

const here = path.dirname(fileURLToPath(import.meta.url));

// Unpackaged the name would be Electron's, and the data folder with it.
// Its first name stays the app's inner one: the data folder and the key that seals the session
// (in the system's keychain) go by it. People read „The Office Cloud“.
app.setName('Cloud');
app.setPath('userData', process.env.CLOUD_USER_DATA || path.join(app.getPath('appData'), 'Cloud'));
const sessionFile = path.join(app.getPath('userData'), 'session.bin');

/** The window with its tabs (`../tabs.mjs`, as Slider's): home is the files, a folder a tab. */
let tabsWindow = null;
let window = null;
/** Home's page: the start screen, then the server's Cloud. */
let page = null;
const theme = () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

/** `{ server, token, account }` while signed in. */
let signedIn = null;
/** The sign-in under way: `{ server, verifier, state }`. */
let pending = null;
/** Links that came before the start read the session. */
let started = false;
const linksWaiting = [];
let signalTimer = null;

// A second start hands its link to the first and goes: it opens no window and touches neither
// the session nor the drive (`app.quit()` alone lets the rest of this file run on).
const first = app.requestSingleInstanceLock();
if (!first) app.quit();
app.on('second-instance', (_event, argv) => {
  for (const arg of argv) {
    if (!arg.startsWith(`${SCHEME}://`)) continue;
    if (started) void takeLink(arg);
    else linksWaiting.push(arg);
  }
  toFront();
});
if (app.isPackaged) app.setAsDefaultProtocolClient(SCHEME);
else app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);

function toFront() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  // A window that is there and not to be seen (never shown, hidden) comes up too.
  if (!window.isVisible()) window.show();
  window.focus();
}

// ── The session ──────────────────────────────────────────────────────────────────────────────

function readSession() {
  try {
    if (!existsSync(sessionFile) || !safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(readFileSync(sessionFile)));
  } catch {
    return null;
  }
}

function keepSession(value) {
  if (!value) {
    rmSync(sessionFile, { force: true });
    return;
  }
  mkdirSync(path.dirname(sessionFile), { recursive: true });
  writeFileSync(sessionFile, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
}

/** The server's session cookie, as it names it itself (apps/api/src/auth/cookies.ts). */
const cookieName = (server) => `${server.startsWith('https://') ? '__Host-' : ''}slider_session`;

async function setCookie({ server, token }) {
  await session.defaultSession.cookies.set({
    url: server,
    name: cookieName(server),
    value: token,
    path: '/',
    secure: server.startsWith('https://'),
    httpOnly: true,
    sameSite: 'lax',
  });
}

/** Origin only, https unless this machine – as Slider's „Anderer Server“. */
function serverOf(text) {
  const raw = String(text ?? '').trim();
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error('Das ist keine Adresse.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('Der Server braucht https.');
  return url.origin;
}

async function startSignIn(serverText) {
  const server = serverOf(serverText || DEFAULT_SERVER);
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Der Schlüsselbund ist nicht verfügbar, Cloud kann die Anmeldung nicht sicher ablegen.',
    );
  }
  const health = await fetch(`${server}/api/health`, { signal: AbortSignal.timeout(8000) })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  if (!health?.ok) throw new Error('Unter dieser Adresse antwortet kein Server.');
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  pending = { server, verifier, state };
  const query = new URLSearchParams({
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state,
    app: 'cloud',
  });
  const url = `${server}/desktop-anmelden?${query}`;
  // Tests follow the link themselves.
  if (process.env.CLOUD_NO_BROWSER) console.info(`CLOUD_SIGN_IN ${url}`);
  else await shell.openExternal(url);
}

async function takeLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return;
  }
  if (url.protocol !== `${SCHEME}:`) return;
  if (url.hostname !== 'auth') return;
  toFront();
  const code = url.searchParams.get('code');
  if (!pending || !code || url.searchParams.get('state') !== pending.state) return;
  const { server, verifier } = pending;
  pending = null;
  try {
    const response = await fetch(`${server}/api/auth/desktop/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, verifier }),
      signal: AbortSignal.timeout(15_000),
    });
    const answer = await response.json();
    if (!response.ok)
      throw new Error(answer?.error?.message ?? 'Die Anmeldung hat nicht geklappt.');
    signedIn = { server, token: answer.token, account: answer.account };
    keepSession(signedIn);
    await enter();
  } catch (error) {
    tellStart(error instanceof Error ? error.message : 'Die Anmeldung hat nicht geklappt.');
  }
}

async function signOut({ ask = true } = {}) {
  if (!signedIn) return;
  if (ask) {
    const { response } = await dialog.showMessageBox(window, {
      type: 'question',
      message: 'Abmelden?',
      detail: 'Cloud meldet sich auf diesem Computer ab. Deine Dateien bleiben auf dem Server.',
      buttons: ['Abmelden', 'Abbrechen'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
  }
  const { server, token } = signedIn;
  signedIn = null;
  keepSession(null);
  clearInterval(signalTimer);
  await drive(['signout']).catch(() => {});
  await fetch(`${server}/api/auth/desktop/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
  await session.defaultSession.cookies.remove(server, cookieName(server)).catch(() => {});
  showStart();
}

// ── The Finder's drive (macOS, packaged: `cloud-drive` lies beside the app's binary) ────────

const driveHelper = path.join(path.dirname(process.execPath), 'cloud-drive');
const hasDrive = process.platform === 'darwin' && existsSync(driveHelper);

function drive(args, input) {
  if (!hasDrive) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const child = execFile(driveHelper, args, { timeout: 20_000 }, (error, stdout, stderr) =>
      error
        ? reject(Object.assign(new Error(stderr.trim() || error.message), { exit: error.code }))
        : resolve(stdout),
    );
    if (input !== undefined) child.stdin.end(`${input}\n`);
  });
}

/** The drive is there: the Finder shows the files. */
let driveThere = false;
/** It is not, because it is off in the System Settings (`cloud-drive set` exits with 2). */
let driveOff = false;

/**
 * The account's place in the Finder: one, with a folder per workspace in it (the drive asks the
 * server which). Every start anew: the drive carries the session, and that may be a new one.
 */
async function syncDrive() {
  if (!hasDrive || !signedIn) return false;
  const { server, token } = signedIn;
  try {
    await drive(['set', server], token);
    await drive(['signal']);
    rmSync(driveToldFile, { force: true });
    driveOff = false;
    driveThere = true;
  } catch (error) {
    driveOff = error?.exit === 2;
    driveThere = false;
    console.error('drive:', error instanceof Error ? error.message : error);
  }
  return driveThere;
}

/** The System Settings' list „Dateianbieter“, this app's switch in it. */
const DRIVE_SETTINGS =
  'x-apple.systempreferences:com.apple.ExtensionsPreferences?extensionPointIdentifier=com.apple.fileprovider-nonui';
/** How often the drive is asked for while the user is at that switch, and for how long. */
const SWITCH_EVERY_MS = 2000;
const SWITCH_FOR_MS = 5 * 60_000;
let switchTimer = null;

/** The account's folder in the Finder, opened. */
async function showInFinder() {
  const folder = (await drive(['path', 'NSFileProviderRootContainerItemIdentifier'])).trim();
  if (folder && isInDrive(folder)) await shell.openPath(folder);
}

/**
 * macOS leaves every new drive off until the user switches it on, and no app may do that for
 * them: this leads to the switch and shows the folder as soon as it is on.
 */
async function askForDrive() {
  if (!window) return;
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    message: 'Deine Dateien auch im Finder?',
    detail:
      'macOS zeigt den Ordner erst, wenn du ihn einschaltest: in den Systemeinstellungen unter „Dateianbieter“ den Schalter bei „The Office Cloud“. Ohne ihn findest du alles in diesem Fenster.',
    buttons: ['Systemeinstellungen öffnen', 'Später'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;
  await shell.openExternal(DRIVE_SETTINGS);
  const until = Date.now() + SWITCH_FOR_MS;
  const look = async () => {
    if (Date.now() > until || !signedIn) return;
    if (await syncDrive()) return void showInFinder().catch(() => {});
    switchTimer = setTimeout(look, SWITCH_EVERY_MS);
  };
  clearTimeout(switchTimer);
  switchTimer = setTimeout(look, SWITCH_EVERY_MS);
}

/**
 * The Finder has no place for the files though this app brings one (off in the System Settings,
 * or the system did not load it): said once, calmly – the window does everything without it.
 * Not again until the drive was there in between; „Im Finder zeigen“ in the menu asks again.
 */
const driveToldFile = path.join(app.getPath('userData'), 'drive-told');
function tellNoDrive({ again = false } = {}) {
  if (!hasDrive || !window || (!again && existsSync(driveToldFile))) return;
  try {
    mkdirSync(path.dirname(driveToldFile), { recursive: true });
    writeFileSync(driveToldFile, '');
  } catch {
    // Then it is said again at the next start.
  }
  if (driveOff) return void askForDrive();
  void dialog.showMessageBox(window, {
    type: 'info',
    message: 'Deine Dateien findest du in diesem Fenster.',
    detail: 'Der Ordner im Finder ist gerade nicht da.',
    buttons: ['OK'],
  });
}

/** The menu's „Im Finder zeigen“: the folder, or the way to it. */
async function finderFromMenu() {
  if (!signedIn) return;
  if (await syncDrive()) await showInFinder().catch(() => {});
  else tellNoDrive({ again: true });
}

// ── The window ───────────────────────────────────────────────────────────────────────────────

function showStart(message) {
  tabsWindow?.reset();
  void page
    ?.loadFile(path.join(here, 'start.html'), { query: { theme: theme() } })
    .then(() => tellStart(message));
}

function tellStart(message) {
  page?.send('cloud:start', {
    server: pending?.server ?? signedIn?.server ?? readSession()?.server ?? DEFAULT_SERVER,
    message: message ?? null,
    waiting: Boolean(pending),
  });
}

/** Signed in: the server's Cloud in the window, its files in the Finder. */
async function enter() {
  await setCookie(signedIn);
  // Beside the page: the drive needs no window, and the window none of the drive.
  const inFinder = syncDrive();
  try {
    await tabsWindow?.start(signedIn.server);
    void inFinder.then((there) => there || tellNoDrive());
  } catch {
    // Only what is true: without the drive the Finder holds nothing to point to.
    const unreachable = 'Der Server ist gerade nicht erreichbar.';
    showStart(
      (await inFinder) ? `${unreachable} Deine Dateien findest du im Finder.` : unreachable,
    );
  }
  clearInterval(signalTimer);
  // A drive that was not there (off, not loaded) is asked for again: switched on in the System
  // Settings, it shows the files without a new start.
  signalTimer = setInterval(
    () => void (driveThere ? drive(['signal']).catch(() => {}) : syncDrive()),
    SIGNAL_EVERY_MS,
  );
}

const isOwn = (url) => {
  try {
    return Boolean(signedIn) && new URL(url).origin === signedIn.server;
  } catch {
    return false;
  }
};

/**
 * A folder has a tab of its own, and so has an area – a folder too, to work in side by side.
 * An area's agents („…/bereich/<id>/agenten“) are its second view: the same tab – taken for
 * another place the tab would close and the home tab load it anew at every switch.
 * A presentation, a document and a PDF have one as well: the window shows the apps in its tabs.
 */
function tabOf(url) {
  const place = url.pathname.match(
    /^\/w\/[^/]+\/dateien\/(?:(ordner)\/([A-Za-z0-9-]{1,100})|(bereich)\/([A-Za-z0-9-]{1,100})(?:\/agenten)?)\/?$/,
  );
  if (place) return `${place[1] ?? place[3]}:${place[2] ?? place[4]}`;
  const made = url.pathname.match(/^\/(d|t|r)\/([A-Za-z0-9_-]{1,100})(?:\/|$)/);
  // Only while its app opens here: one that opens by itself has no tab (none comes back at start).
  if (!made || !opensHere({ d: 'slider', t: 'writer', r: 'reader' }[made[1]])) return null;
  return `${made[1]}:${made[2]}`;
}

/**
 * The apps' pages (`appOfPath` in apps/web/src/lib/apps.ts, without the ones between
 * the apps): shown in this window's tabs (the user's call, 2026-11-19) – home gives them a tab, a
 * tab goes there itself.
 */
const APP_PAGES = {
  slider: /^\/(d\/[^/]+.*|neu|w\/[^/]+(\/(material|agenten)(\/.*)?)?)\/?$/,
  writer: /^\/(w\/[^/]+\/dokumente(\/.*)?|writer|t\/[^/]+.*)\/?$/,
  reader: /^\/(w\/[^/]+\/pdfs(\/.*)?|reader|r\/[^/]+.*)\/?$/,
  sender: /^\/(w\/[^/]+\/nachrichten(\/.*)?|sender)\/?$/,
};
/** Where an app starts, and what it is called in the menus. */
const APPS = {
  slider: { label: 'Slider', start: '/', scheme: 'slider' },
  writer: { label: 'Writer', start: '/writer', scheme: 'slider-writer' },
  reader: { label: 'Reader', start: '/reader', scheme: 'slider-reader' },
  sender: { label: 'Sender', start: '/sender', scheme: 'slider-sender' },
};
/** The app of that name is on this computer: something takes its links (`DESKTOP_SCHEMES`). */
const installed = (name) => {
  try {
    return app.getApplicationNameForProtocol(`${APPS[name].scheme}://`) !== '';
  } catch {
    return false;
  }
};
/** An app's pages open in this window: so said, or there is no app of its own to take them. */
const opensHere = (name) => appsWhere[name] !== 'own' || !installed(name);
/** The apps a new tab can start on: those that open here. */
const appsHere = () => Object.keys(APPS).filter(opensHere);
const appOfPage = (pathname) =>
  Object.keys(APP_PAGES).find((each) => APP_PAGES[each].test(pathname)) ?? null;

/**
 * Where each app's pages open, said in the settings (`cloudDesktop.setApp`, „Apps“ under
 * „Einstellungen“): `tab` – in this window's tabs, as it starts out, the whole app – or `own` –
 * in the app of its own, where that is installed. Kept for this computer.
 */
const appsFile = path.join(app.getPath('userData'), 'apps.json');
const WHERE = new Set(['tab', 'own']);
function readApps() {
  const kept = { slider: 'tab', writer: 'tab', reader: 'tab', sender: 'tab' };
  try {
    const saved = JSON.parse(readFileSync(appsFile, 'utf8'));
    for (const each of Object.keys(kept)) if (WHERE.has(saved?.[each])) kept[each] = saved[each];
  } catch {
    // Never said: every app in the tabs.
  }
  return kept;
}
let appsWhere = readApps();

/** A page of an app that this window shows in its tabs. */
const guest = (url) => {
  const of = appOfPage(url.pathname);
  return of !== null && opensHere(of);
};
/**
 * A page of an app that opens in its own app: handed there as `<scheme>://open?url=…` (Slider's
 * `followLink`, Writer's, Reader's and Sender's `takeLink` – shown there if it is that app's
 * server, else it says so),
 * and this window stays where it was.
 */
function byItself(url) {
  const of = appOfPage(new URL(url).pathname);
  if (of === null || opensHere(of)) return false;
  void shell.openExternal(`${APPS[of].scheme}://open?url=${encodeURIComponent(url)}`);
  return true;
}

function createWindow() {
  tabsWindow = createTabWindow({
    // The tab bar's files lie beside Slider's.
    here: path.dirname(here),
    stateFile: path.join(app.getPath('userData'), 'tabs.json'),
    themeFile: path.join(app.getPath('userData'), 'theme.json'),
    theme: theme(),
    isOwn,
    openExternal: (url) => {
      if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    },
    elsewhere: byItself,
    app: {
      name: 'cloud',
      title: 'Cloud',
      homeTitle: 'Dateien',
      tabTitle: 'Ordner',
      split: true,
      newTab: true,
      // Beside „+“: a tab that starts on the files, or on another app as a whole.
      newTabs: () => [
        { label: 'Dateien', path: '/cloud' },
        ...appsHere().map((each) => ({ label: APPS[each].label, path: APPS[each].start })),
      ],
      start: '/cloud',
      preload: path.join(here, 'start-preload.cjs'),
      tabOf,
      guest,
      // „Berichte | Mein Workspace“ → „Berichte“: what it is, not whose.
      pageTitle: (title) => title.split(' | ')[0] ?? '',
    },
  });
  window = tabsWindow.window;
  page = tabsWindow.home;
  window.on('closed', () => {
    window = null;
    tabsWindow = null;
    page = null;
  });
}

/**
 * A page of the server's at its login: `'ended'` – the session ended there – or `'add'`, the
 * web's „Weiteres Konto hinzufügen“ (`/login?add=1`), where the session lives on.
 */
function atLogin(url) {
  if (!signedIn || !isOwn(url)) return null;
  const { pathname, searchParams } = new URL(url);
  if (pathname !== '/login') return null;
  return searchParams.has('add') ? 'add' : 'ended';
}

// The session ended there: a page stands at the login – back to the start here. It gets there
// by a load, or within the page (a start with a session that ran out: the web app's router
// steps to its login without loading anything).
// One more account is not for this window: the app and its drive are one account's, and a second
// one signed in here would show another's files than the Finder. That step is not taken – the
// page stays, the session with it; never a sign-out.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (atLogin(url) === 'add') event.preventDefault();
  });
  const arrived = (url) => {
    const at = atLogin(url);
    if (at === 'ended') void signOut({ ask: false });
    if (at !== 'add') return;
    // Reached anyway (a link within the page): back to where it came from.
    if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    else void contents.loadURL(`${signedIn.server}/cloud`).catch(() => {});
  };
  contents.on('did-navigate', (_navigation, url) => arrived(url));
  contents.on('did-navigate-in-page', (_navigation, url, isMainFrame) => {
    if (isMainFrame) arrived(url);
  });
});

ipcMain.handle('cloud:sign-in', async (event, server) => {
  if (!fromHere(event)) return;
  try {
    await startSignIn(server);
    tellStart();
  } catch (error) {
    pending = null;
    tellStart(error instanceof Error ? error.message : 'Das hat nicht geklappt.');
  }
});
ipcMain.handle('cloud:ready', (event) => {
  if (fromHere(event)) tellStart();
});

// The server's pages and this computer's files (start-preload.cjs): only with the Finder's drive.
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const fromServer = (event) => Boolean(event.senderFrame) && isOwn(event.senderFrame.url);
/** This app's own pages (start, splash) – no other file on this computer speaks for it. */
const fromHere = (event) => {
  try {
    const file = fileURLToPath(event.senderFrame?.url ?? '');
    return path.dirname(file) === here;
  } catch {
    return false;
  }
};
/** What „Öffnen“ hands to this computer's programs: documents, pictures, media, archives. */
const OPENS = new Set(
  (
    'pdf txt md rtf csv tsv json xml yaml yml log ' +
    'doc docx dot dotx odt ott pages xls xlsx xlsm xlt xltx ods ots numbers ' +
    'ppt pptx pps ppsx pot potx odp otp key odg vsd vsdx epub ' +
    'png jpg jpeg gif webp heic heif tif tiff bmp svg psd ai eps indd sketch fig ' +
    'mp3 m4a wav aac flac ogg aiff mp4 m4v mov avi mkv webm ' +
    'zip tar gz tgz 7z rar ics vcf eml msg ttf otf woff woff2'
  ).split(' '),
);
const isInDrive = (file) => {
  const root = path.join(app.getPath('home'), 'Library', 'CloudStorage') + path.sep;
  return path.resolve(file).startsWith(root);
};
/**
 * „Öffnen“ without a place in the Finder (no drive, a file not there yet): the page downloads
 * the file as a browser would – then it goes to „Downloads“ and opens, without asking where to
 * save. Only that one download, soon after: „Herunterladen“ keeps asking.
 */
let openNext = 0;
const openDownload = () => {
  openNext = Date.now();
  return false;
};
const freeName = (folder, name) => {
  const { name: stem, ext } = path.parse(name);
  for (let count = 1; ; count++) {
    const file = path.join(folder, count === 1 ? name : `${stem} ${count}${ext}`);
    if (!existsSync(file)) return file;
  }
};
app.whenReady().then(() => {
  session.defaultSession.on('will-download', (_event, item) => {
    if (Date.now() - openNext > 15_000) return;
    openNext = 0;
    const file = freeName(app.getPath('downloads'), path.basename(item.getFilename()));
    item.setSavePath(file);
    item.once('done', (_done, state) => {
      if (state !== 'completed') return;
      // As above: only what a program shows or edits opens; the rest is shown where it lies.
      if (OPENS.has(path.extname(file).slice(1).toLowerCase())) void shell.openPath(file);
      else shell.showItemInFolder(file);
    });
  });
});
ipcMain.handle('cloud:open', async (event, workspaceId, nodeId) => {
  if (!fromServer(event) || !ID.test(workspaceId) || !ID.test(nodeId)) return false;
  if (!hasDrive) return openDownload();
  try {
    const file = (await drive(['path', nodeId])).trim();
    // Only what a program shows or edits: a file anyone in an area may have put there must not
    // run on a double click (a Terminal profile, a script, an installer, a link file). The rest
    // answers `false`, and the page downloads it as a browser would.
    if (!file || !isInDrive(file) || !OPENS.has(path.extname(file).slice(1).toLowerCase())) {
      return openDownload();
    }
    // Resolves with what went wrong, empty when the file's program took it.
    return (await shell.openPath(file)) === '' || openDownload();
  } catch {
    return openDownload();
  }
});
// „Apps“ in the settings: where each app opens, for this computer.
const appsNow = () =>
  Object.fromEntries(
    Object.keys(APPS).map((each) => [each, { where: appsWhere[each], installed: installed(each) }]),
  );
ipcMain.handle('cloud:apps', (event) => (fromServer(event) ? appsNow() : null));
ipcMain.handle('cloud:set-app', (event, name, where) => {
  if (!fromServer(event) || !Object.hasOwn(APPS, name) || !WHERE.has(where)) return null;
  appsWhere = { ...appsWhere, [name]: where };
  try {
    writeFileSync(appsFile, JSON.stringify(appsWhere));
  } catch {
    // Holds for this run; asked again after the next start.
  }
  // What stands in a tab and now opens in its own app goes there at once; the menu names the rest.
  if (where === 'own') tabsWindow?.sortOut();
  buildMenu();
  return appsNow();
});
ipcMain.handle('cloud:reveal', async (event, workspaceId, nodeId) => {
  if (!hasDrive || !fromServer(event) || !ID.test(workspaceId) || !ID.test(nodeId)) return false;
  try {
    const file = (await drive(['path', nodeId])).trim();
    if (!file || !isInDrive(file)) return false;
    shell.showItemInFolder(file);
    return true;
  } catch {
    return false;
  }
});
ipcMain.handle('cloud:free', async (event, workspaceId, nodeId) => {
  if (!hasDrive || !fromServer(event) || !ID.test(workspaceId) || !ID.test(nodeId)) return false;
  try {
    await drive(['evict', nodeId]);
    return true;
  } catch {
    // Changed here and not sent yet, or open in a program: the system keeps it.
    return false;
  }
});
ipcMain.handle('cloud:local', async (event, workspaceId) => {
  if (!hasDrive || !fromServer(event) || !ID.test(workspaceId)) return [];
  try {
    return (await drive(['local'])).split('\n').filter(Boolean);
  } catch {
    return [];
  }
});

function buildMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac
        ? [
            {
              label: 'The Office Cloud',
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
              ],
            },
          ]
        : []),
      {
        label: 'Konto',
        submenu: [
          ...(hasDrive
            ? [
                { label: 'Im Finder zeigen', click: () => void finderFromMenu() },
                { type: 'separator' },
              ]
            : []),
          { label: 'Abmelden …', click: () => void signOut() },
          ...(mac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
        ],
      },
      { role: 'editMenu' },
      {
        label: 'Darstellung',
        submenu: [
          { role: 'reload' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        // As Slider's (`../main.mjs`).
        role: 'windowMenu',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          {
            label: 'Neuer Tab',
            accelerator: 'CmdOrCtrl+T',
            click: () => tabsWindow?.openAt('/cloud'),
          },
          ...appsHere().map((each) => ({
            label: `Neuer Tab mit ${APPS[each].label}`,
            click: () => tabsWindow?.openAt(APPS[each].start),
          })),
          {
            label: 'Tab schließen',
            accelerator: 'CmdOrCtrl+W',
            click: () => tabsWindow?.closeActive(),
          },
          { label: 'Nächster Tab', accelerator: 'Ctrl+Tab', click: () => tabsWindow?.step(1) },
          {
            label: 'Vorheriger Tab',
            accelerator: 'Ctrl+Shift+Tab',
            click: () => tabsWindow?.step(-1),
          },
          ...Array.from({ length: 9 }, (_, index) => ({
            label: index === 8 ? 'Letzter Tab' : `Tab ${index + 1}`,
            accelerator: `CmdOrCtrl+${index + 1}`,
            visible: false,
            acceleratorWorksWhenHidden: true,
            click: () => tabsWindow?.selectIndex(index),
          })),
          { type: 'separator' },
          { role: 'front' },
        ],
      },
    ]),
  );
}

/**
 * Installing, for who opened the app where it was downloaded (the disk image, „Downloads“):
 * macOS keeps the Finder's folder only for an app in „Programme“. Asked once; a yes moves the
 * app there and starts it anew (true: this start ends here).
 */
const staysFile = path.join(app.getPath('userData'), 'stays');
async function moveToApplications() {
  if (process.platform !== 'darwin' || !app.isPackaged || app.isInApplicationsFolder()) {
    return false;
  }
  if (existsSync(staysFile)) return false;
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: 'The Office Cloud in „Programme“ legen?',
    detail: 'Dort bleibt die App, und macOS zeigt deine Dateien im Finder.',
    buttons: ['In „Programme“ legen', 'Nicht jetzt'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    try {
      // An older one lying there is replaced; one running there comes to the front instead.
      if (app.moveToApplicationsFolder()) return true;
    } catch (error) {
      dialog.showErrorBox(
        'Die App ließ sich nicht in „Programme“ legen.',
        error instanceof Error ? error.message : String(error),
      );
    }
    return false;
  }
  try {
    mkdirSync(path.dirname(staysFile), { recursive: true });
    writeFileSync(staysFile, '');
  } catch {
    // Then it is asked again at the next start.
  }
  return false;
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (started) void takeLink(url);
  else linksWaiting.push(url);
});

app.whenReady().then(async () => {
  if (!first) return;
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(path.join(here, 'icon.png'));
  }
  if (await moveToApplications()) return;
  buildMenu();
  createWindow();
  signedIn = readSession();
  if (signedIn) await enter();
  else showStart();
  started = true;
  for (const arg of process.argv.slice(1))
    if (arg.startsWith(`${SCHEME}://`)) linksWaiting.push(arg);
  for (const link of linksWaiting.splice(0)) void takeLink(link);
  app.on('activate', async () => {
    // A click on the Dock with the window there: macOS leaves bringing it up to the app.
    if (window) return toFront();
    createWindow();
    if (signedIn) await enter();
    else showStart();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
