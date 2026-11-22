// Writer desktop: the account's documents as an app of their own, beside Slider and Cloud. A
// window on the Writer pages of the server signed in to – home is the list, a document a tab.
// Nothing is kept here but the session, sealed in the system's keychain (safeStorage).
import {
  app,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  safeStorage,
  session,
  shell,
  webContents,
} from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTED_SERVER, movedSession } from '../hosted.mjs';
import { createTabWindow } from '../tabs.mjs';

/** As `DESKTOP_SCHEMES.writer` (@slider/shared desktop.ts): `slider-writer://auth?code=…&state=…`. */
const SCHEME = 'slider-writer';
const DEFAULT_SERVER = process.env.WRITER_SERVER || HOSTED_SERVER;

const here = path.dirname(fileURLToPath(import.meta.url));

// Unpackaged the name would be Electron's, and the data folder with it. The data folder and the
// key that seals the session (in the system's keychain) go by this name.
app.setName('Writer');
app.setPath(
  'userData',
  process.env.WRITER_USER_DATA || path.join(app.getPath('appData'), 'Writer'),
);
const sessionFile = path.join(app.getPath('userData'), 'session.bin');

/** The window with its tabs (`../tabs.mjs`, as Slider's): home is the documents, a document a tab. */
let tabsWindow = null;
let window = null;
/** Home's page: the start screen, then the server's Writer. */
let page = null;
const theme = () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

/** `{ server, token, account }` while signed in. */
let signedIn = null;
/** The sign-in under way: `{ server, verifier, state }`. */
let pending = null;
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
  window.focus();
}

// ── The session ──────────────────────────────────────────────────────────────────────────────

function readSession() {
  try {
    if (!existsSync(sessionFile) || !safeStorage.isEncryptionAvailable()) return null;
    // Kept for the hosted Slider's old address: its new one (`../hosted.mjs`).
    return movedSession(
      JSON.parse(safeStorage.decryptString(readFileSync(sessionFile))),
      keepSession,
    );
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
      'Der Schlüsselbund ist nicht verfügbar, Writer kann die Anmeldung nicht sicher ablegen.',
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
    app: 'writer',
  });
  const url = `${server}/desktop-anmelden?${query}`;
  // Tests follow the link themselves.
  if (process.env.WRITER_NO_BROWSER) console.info(`WRITER_SIGN_IN ${url}`);
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
  // `slider-writer://open?url=…`: a page of Writer's from Cloud's app (a document opened from
  // the files, where the person has Writer's pages open here – „Apps“ in the settings). Shown
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
      detail: 'Writer meldet sich auf diesem Computer ab. Deine Dokumente bleiben auf dem Server.',
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
  page?.send('writer:start', {
    server: pending?.server ?? signedIn?.server ?? readSession()?.server ?? DEFAULT_SERVER,
    message: message ?? null,
    waiting: Boolean(pending),
  });
}

/** Signed in: the server's Writer in the window. */
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

/** A document has a tab of its own (`/t/:documentId`). */
function tabOf(url) {
  return url.pathname.match(/^\/t\/([A-Za-z0-9_-]{1,100})(?:\/|$)/)?.[1] ?? null;
}

/** Writer's pages: its start, the list with what is below it, a document. */
const WRITER_PAGE = /^\/(writer|w\/[^/]+\/dokumente(\/.*)?|t\/[A-Za-z0-9_-]+(\/.*)?)\/?$/;
/**
 * The pages between the apps – `NEUTRAL` in apps/web/src/lib/apps.ts (settings, account, usage,
 * the instance, this sign-in) and the ones before an account (login, sign-up, joining, legal):
 * they keep the app one came from.
 */
const BETWEEN_PAGE =
  /^\/(w\/[^/]+\/einstellungen(\/.*)?|nutzung|instanz|konto|einstellungen|woerterbuch|verbinden|desktop-anmelden|login|registrieren|konto-bestaetigen\/.*|anmelden\/.*|einrichtung|join\/.*|datenschutz|impressum|datenanfrage|daten\/.*)?\/?$/;
/**
 * The app is Writer only: a page of Slider's or Cloud's reached in it opens in the browser,
 * where one moves between the apps.
 */
function inBrowser(url) {
  const { pathname } = new URL(url);
  if (WRITER_PAGE.test(pathname) || BETWEEN_PAGE.test(pathname)) return false;
  void shell.openExternal(url);
  return true;
}

/** The page in front – home or a document – does it (`writer:desktop` in the page). */
const tellPage = (action) => tabsWindow?.pageAction(action);

/** A document's tab in front: its own zoom, not the window's (`onFront`). */
let documentInFront = false;

/**
 * „Darstellung“'s zoom: a document zooms its sheets, as ⌘+ / ⌘− / ⌘0 do in the browser (the menu
 * may take the keys before the page); every other page the window's zoom, as the roles did.
 */
function zoom(action) {
  if (documentInFront && tellPage(action)) return;
  const contents = webContents.getFocusedWebContents();
  if (!contents) return;
  const level = contents.getZoomLevel();
  contents.setZoomLevel(action === 'zoomReset' ? 0 : level + (action === 'zoomIn' ? 0.5 : -0.5));
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
    elsewhere: inBrowser,
    app: {
      name: 'writer',
      title: 'Writer',
      homeTitle: 'Dokumente',
      tabTitle: 'Dokument',
      start: '/writer',
      preload: path.join(here, 'start-preload.cjs'),
      tabOf,
      // „Angebot | Mein Workspace“ → „Angebot“: what it is, not whose.
      pageTitle: (title) => title.split(' | ')[0] ?? '',
      // The document's buttons in the bar (`writerDesktop.docBar` ↔ `writer:desktop`).
      bar: {
        channel: 'tabs:docBar',
        event: 'writer:desktop',
        actions: ['print', 'export', 'close'],
        offer: (offer) => ({
          export: offer.export === true,
          exportOpen: offer.exportOpen === true,
        }),
        allows: (action, bar) => action !== 'export' || bar.export,
      },
      // „Exportieren …“ and „Drucken …“ are a document's: only with its tab in front.
      onFront: ({ kind }) => {
        const menu = Menu.getApplicationMenu();
        for (const id of ['export', 'print']) {
          const item = menu?.getMenuItemById(id);
          if (item) item.enabled = kind === 'deck';
        }
        documentInFront = kind === 'deck';
      },
    },
  });
  window = tabsWindow.window;
  page = tabsWindow.home;
  window.on('closed', () => {
    window = null;
    tabsWindow = null;
    page = null;
    documentInFront = false;
    for (const id of ['export', 'print']) {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      if (item) item.enabled = false;
    }
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
    else void contents.loadURL(`${signedIn.server}/writer`).catch(() => {});
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
ipcMain.handle('writer:sign-in', async (event, server) => {
  if (!fromHere(event)) return;
  try {
    await startSignIn(server);
    tellStart();
  } catch (error) {
    pending = null;
    tellStart(error instanceof Error ? error.message : 'Das hat nicht geklappt.');
  }
});
ipcMain.handle('writer:ready', (event) => {
  if (fromHere(event)) tellStart();
});

function buildMenu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac
        ? [
            {
              label: 'Writer',
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
        // „Ablage“ as macOS calls it; elsewhere „Datei“, which carries Beenden too.
        label: mac ? 'Ablage' : 'Datei',
        submenu: [
          { label: 'Neues Dokument', accelerator: 'CmdOrCtrl+N', click: () => tellPage('new') },
          { label: 'Öffnen …', accelerator: 'CmdOrCtrl+O', click: () => tellPage('open') },
          { type: 'separator' },
          {
            id: 'export',
            label: 'Exportieren …',
            accelerator: 'CmdOrCtrl+Shift+E',
            enabled: false,
            click: () => tellPage('export'),
          },
          {
            id: 'print',
            label: 'Drucken …',
            accelerator: 'CmdOrCtrl+P',
            enabled: false,
            click: () => tellPage('print'),
          },
          { type: 'separator' },
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
          { label: 'Originalgröße', accelerator: 'CmdOrCtrl+0', click: () => zoom('zoomReset') },
          { label: 'Vergrößern', accelerator: 'CmdOrCtrl+Plus', click: () => zoom('zoomIn') },
          // ⌘= as ⌘+ (no shift on most keyboards), as the role had it.
          {
            label: 'Vergrößern',
            accelerator: 'CmdOrCtrl+=',
            visible: false,
            acceleratorWorksWhenHidden: true,
            click: () => zoom('zoomIn'),
          },
          { label: 'Verkleinern', accelerator: 'CmdOrCtrl+-', click: () => zoom('zoomOut') },
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
    if (window) return;
    createWindow();
    if (signedIn) await enter();
    else showStart();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
