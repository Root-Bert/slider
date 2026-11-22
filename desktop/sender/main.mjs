// Sender desktop: the workspace's messages as an app of their own, beside Slider, Cloud and
// Writer. A window on the Sender pages of the server signed in to – one page, no tabs. As a chat
// app does it stays when its window closes (macOS: in the Dock; elsewhere: in the tray), so what
// is written to one still comes as a notification; the Dock shows how much waits.
// Nothing is kept here but the session, sealed in the system's keychain (safeStorage).
import {
  app,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  safeStorage,
  session,
  shell,
} from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTabWindow } from '../tabs.mjs';

/** As `DESKTOP_SCHEMES.sender` (@slider/shared desktop.ts): `slider-sender://auth?code=…&state=…`. */
const SCHEME = 'slider-sender';
const DEFAULT_SERVER = process.env.SENDER_SERVER || 'https://slider.bertro.dev';

const here = path.dirname(fileURLToPath(import.meta.url));

// Unpackaged the name would be Electron's, and the data folder with it. The data folder and the
// key that seals the session (in the system's keychain) go by this name.
app.setName('Sender');
app.setPath(
  'userData',
  process.env.SENDER_USER_DATA || path.join(app.getPath('appData'), 'Sender'),
);
const sessionFile = path.join(app.getPath('userData'), 'session.bin');

/** The window (`../tabs.mjs`, as the family's): its bar, and home – Sender – with no tabs beside. */
let tabsWindow = null;
let window = null;
/** Home's page: the start screen, then the server's Sender. */
let page = null;
const theme = () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

/** `{ server, token, account }` while signed in. */
let signedIn = null;
/** The sign-in under way: `{ server, verifier, state }`. */
let pending = null;
/** Quitting for real (menu, ⌘Q, the tray): the window may close, not just hide. */
let quitting = false;
/** Outside macOS: the icon in the tray, the way back to a hidden window. */
let tray = null;
let badge = 0;
/** Links that came before the start read the session. */
let started = false;
const linksWaiting = [];

// A second start hands its link to the first and goes: it opens no window and does not touch
// the session (`app.quit()` alone lets the rest of this file run on).
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
  window.show();
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
      'Der Schlüsselbund ist nicht verfügbar, Sender kann die Anmeldung nicht sicher ablegen.',
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
    app: 'sender',
  });
  const url = `${server}/desktop-anmelden?${query}`;
  // Tests follow the link themselves.
  if (process.env.SENDER_NO_BROWSER) console.info(`SENDER_SIGN_IN ${url}`);
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
  // `slider-sender://open?url=…`: a page of Sender's (a conversation) from another app. Shown
  // here if it is this account's server; signed in nowhere the start page is the way; a page of
  // another server goes to the browser.
  if (url.hostname === 'open') {
    const page = url.searchParams.get('url');
    if (!page || !/^https?:/i.test(page)) return;
    toFront();
    if (isOwn(page)) return void tabsWindow?.show(page);
    if (signedIn) void shell.openExternal(page);
    return;
  }
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
      detail:
        'Sender meldet sich auf diesem Computer ab. Deine Nachrichten bleiben auf dem Server.',
      buttons: ['Abmelden', 'Abbrechen'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
  }
  const { server, token } = signedIn;
  signedIn = null;
  keepSession(null);
  await fetch(`${server}/api/auth/desktop/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
  await session.defaultSession.cookies.remove(server, cookieName(server)).catch(() => {});
  setBadge(0);
  showStart();
}

// ── The window ───────────────────────────────────────────────────────────────────────────────

function showStart(message) {
  tabsWindow?.reset();
  void page
    ?.loadFile(path.join(here, 'start.html'), { query: { theme: theme() } })
    .then(() => tellStart(message));
}

function tellStart(message) {
  page?.send('sender:start', {
    server: pending?.server ?? signedIn?.server ?? readSession()?.server ?? DEFAULT_SERVER,
    message: message ?? null,
    waiting: Boolean(pending),
  });
}

/** Signed in: the server's Sender in the window. */
async function enter() {
  await setCookie(signedIn);
  try {
    await tabsWindow?.start(signedIn.server);
  } catch {
    showStart('Der Server ist gerade nicht erreichbar.');
  }
}

const isOwn = (url) => {
  try {
    return Boolean(signedIn) && new URL(url).origin === signedIn.server;
  } catch {
    return false;
  }
};

/** Sender's pages: its start, the conversations with what is below them. */
const SENDER_PAGE = /^\/(sender|w\/[^/]+\/nachrichten(\/.*)?)\/?$/;
/**
 * The pages between the apps – `NEUTRAL` in apps/web/src/lib/apps.ts (settings, account, usage,
 * the instance, this sign-in) and the ones before an account (login, sign-up, joining, legal):
 * they keep the app one came from.
 */
const BETWEEN_PAGE =
  /^\/(w\/[^/]+\/einstellungen(\/.*)?|nutzung|instanz|konto|einstellungen|woerterbuch|verbinden|desktop-anmelden|login|registrieren|konto-bestaetigen\/.*|anmelden\/.*|einrichtung|join\/.*|datenschutz|impressum|datenanfrage|daten\/.*)?\/?$/;
/**
 * The app is Sender only: a page of another app reached in it (an agent in Cloud, a file a
 * message names) opens in the browser, where one moves between the apps.
 */
function inBrowser(url) {
  const { pathname } = new URL(url);
  if (SENDER_PAGE.test(pathname) || BETWEEN_PAGE.test(pathname)) return false;
  void shell.openExternal(url);
  return true;
}

/** The page does it (`sender:desktop` in the page: 'kanal' | 'gruppe' | 'direkt'). */
const tellPage = (action) => tabsWindow?.pageAction(action);

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
    elsewhere: inBrowser,
    app: {
      name: 'sender',
      title: 'Sender',
      homeTitle: 'Nachrichten',
      tabTitle: 'Nachrichten',
      start: '/sender',
      preload: path.join(here, 'start-preload.cjs'),
      // One page: nothing has a tab of its own.
      tabOf: () => null,
      pageTitle: (title) => title.replace(/^\(\d+\)\s*/, '').split(' | ')[0] ?? '',
      // No buttons in the bar; the menu's „Neue Gruppe“ and the like arrive as `sender:desktop`.
      bar: {
        channel: 'tabs:docBar',
        event: 'sender:desktop',
        actions: [],
        offer: () => null,
        allows: () => false,
      },
    },
  });
  window = tabsWindow.window;
  page = tabsWindow.home;
  // Closed, it hides: the page stays, its live stream with it, so notifications still come.
  // First in line, so the window's tabs (`../tabs.mjs`) see it was called off.
  window.prependListener('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (window.isFullScreen()) {
      window.once('leave-full-screen', () => window?.hide());
      window.setFullScreen(false);
    } else window.hide();
  });
  window.on('closed', () => {
    window = null;
    tabsWindow = null;
    page = null;
  });
}

// ── What waits ───────────────────────────────────────────────────────────────────────────────

/** The count on the icon (`senderDesktop.setBadge` in the page). */
function setBadge(count) {
  badge = Number.isInteger(count) && count > 0 ? Math.min(count, 9999) : 0;
  // macOS's Dock, Linux's launchers that read it (Unity); Windows has no count on the task bar.
  app.setBadgeCount(badge);
  tray?.setToolTip(badge > 0 ? `Sender (${badge} neu)` : 'Sender');
}

/** Outside macOS the tray is the way back to a hidden window, and the way to quit. */
function makeTray() {
  if (process.platform === 'darwin' || tray) return;
  const icon = nativeImage.createFromPath(path.join(here, 'icon.png')).resize({ width: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Sender');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Sender öffnen', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Beenden', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => showWindow());
}

/** Back from hiding – or anew, if it was closed for real. */
async function showWindow() {
  if (window) return toFront();
  createWindow();
  if (signedIn) await enter();
  else showStart();
}

/** Only the server's pages in this window speak for it. */
const fromPage = (event) => {
  const url = event.senderFrame?.url ?? '';
  return isOwn(url) && tabsWindow?.contents().includes(event.sender);
};
ipcMain.on('sender:badge', (event, count) => {
  if (fromPage(event)) setBadge(count);
});
ipcMain.on('sender:show', (event) => {
  if (fromPage(event)) toFront();
});

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
// One more account is not for this window, as in Cloud's: the session kept here is one
// account's. That step is not taken – the page stays, the session with it; never a sign-out.
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
    else void contents.loadURL(`${signedIn.server}/sender`).catch(() => {});
  };
  contents.on('did-navigate', (_navigation, url) => arrived(url));
  contents.on('did-navigate-in-page', (_navigation, url, isMainFrame) => {
    if (isMainFrame) arrived(url);
  });
});

/** This app's own pages (start) – no other file on this computer speaks for it. */
const fromHere = (event) => {
  try {
    const file = fileURLToPath(event.senderFrame?.url ?? '');
    return path.dirname(file) === here;
  } catch {
    return false;
  }
};
ipcMain.handle('sender:sign-in', async (event, server) => {
  if (!fromHere(event)) return;
  try {
    await startSignIn(server);
    tellStart();
  } catch (error) {
    pending = null;
    tellStart(error instanceof Error ? error.message : 'Das hat nicht geklappt.');
  }
});
ipcMain.handle('sender:ready', (event) => {
  if (fromHere(event)) tellStart();
});

function buildMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac
        ? [
            {
              label: 'Sender',
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                {
                  label: 'Beim Anmelden öffnen',
                  type: 'checkbox',
                  checked: app.getLoginItemSettings().openAtLogin,
                  click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
                },
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
        // „Ablage“ as macOS calls it; elsewhere „Datei“, which carries Beenden too.
        label: mac ? 'Ablage' : 'Datei',
        submenu: [
          // One person or a few – one form (an area is its one chat). Not ⌘K: the page's search.
          {
            label: 'Neue Gruppe …',
            accelerator: 'CmdOrCtrl+N',
            click: () => tellFront('gruppe'),
          },
          { type: 'separator' },
          ...(mac
            ? []
            : [
                {
                  label: 'Beim Anmelden öffnen',
                  type: 'checkbox',
                  checked: app.getLoginItemSettings().openAtLogin,
                  click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
                },
                { type: 'separator' },
              ]),
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
          { label: 'Fenster schließen', accelerator: 'CmdOrCtrl+W', click: () => window?.close() },
          { label: 'Sender', accelerator: 'CmdOrCtrl+0', click: () => void showWindow() },
          { type: 'separator' },
          { role: 'front' },
        ],
      },
    ]),
  );
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (started) void takeLink(url);
  else linksWaiting.push(url);
});

/** A menu item for the page: the window comes first, then the page does it. */
function tellFront(action) {
  void showWindow().then(() => tellPage(action));
}

app.on('before-quit', () => {
  quitting = true;
});

app.whenReady().then(async () => {
  if (!first) return;
  makeTray();
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(path.join(here, 'icon.png'));
  }
  buildMenu();
  createWindow();
  signedIn = readSession();
  if (signedIn) await enter();
  else showStart();
  started = true;
  for (const arg of process.argv.slice(1))
    if (arg.startsWith(`${SCHEME}://`)) linksWaiting.push(arg);
  for (const link of linksWaiting.splice(0)) void takeLink(link);
  // The Dock's icon: the hidden window comes back.
  app.on('activate', () => void showWindow());
});

// The window only hides; closed for real it was by quitting.
app.on('window-all-closed', () => {});
