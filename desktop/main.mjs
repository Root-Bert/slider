// Slider desktop: runs the same API and web app as a server, for one person on this machine.
// The API (Bun, apps/api/src/supervisor.ts) listens on 127.0.0.1 only and keeps its data in the
// folder the family's apps share; the window shows the web app it serves. It is a service of its
// own, started by the first app that needs it and used by every other (service.mjs). Everything
// but the AI's calls works offline. The secret and the data key – which encrypts files, slides and the AI keys at rest –
// live in the macOS keychain (safeStorage), not next to the data.
import { app, Menu, dialog, ipcMain, nativeTheme, safeStorage, session, shell } from 'electron';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOWNLOAD_MB,
  findLibreOffice,
  installLibreOffice,
  LINUX_HINT,
  ownLibreOffice,
} from './libreoffice.mjs';
import { createReachability, flip, moveUrl } from './live.mjs';
import {
  leaveService,
  serviceAnswers,
  servicePaths,
  serviceRuns,
  sharedFolder,
  useService,
} from './service.mjs';
import { createTabWindow } from './tabs.mjs';
import { checkFromMenu, startUpdates } from './updates.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Packaged: Contents/Resources; from the repo (`bun run desktop`): the stage of scripts/stage.mjs. */
const resources = app.isPackaged ? process.resourcesPath : path.join(here, 'build');
const appRoot = path.join(resources, 'app');
const bunBinary = path.join(resources, 'bin', 'bun');

// Tests run on a data folder of their own (the e2e of the desktop app).
if (process.env.SLIDER_USER_DATA) app.setPath('userData', process.env.SLIDER_USER_DATA);
const userData = app.getPath('userData');
/**
 * What the family's apps share – the service's data, LibreOffice, logs, the port: Slider's own
 * data folder, so it is where it has always been.
 */
const service = servicePaths(
  process.env.SLIDER_USER_DATA ? userData : sharedFolder(app.getPath('appData')),
);
const { dataDir, logDir } = service;
const keysFile = path.join(service.root, 'keys.bin');

/** The service answers this app (`useService` went through, and it has not gone for good since). */
let serving = false;
let quitting = false;
let mainWindow = null;
/** The window's tabs (tabs.mjs). */
let tabsWindow = null;
let origin = null;
/** The Slider server signed in to (BER-201): its pages open in the tabs too. */
let cloudOrigin = null;
/** The API's SLIDER_SECRET: proves Electron to it (`/desktop/cloud/session`). */
let apiSecret = null;
/** Online and signed in: the tabs show the server's pages, live (live.mjs). */
let live = false;
/** Local id → the server's, for decks and workspaces on both (`/desktop/cloud/session`). */
let ids = { decks: {}, workspaces: {} };
/** The API answers and the tabs started: links and files are taken from now on, else they wait. */
let ready = false;

/** A second start hands its links and files to the first and goes – it starts nothing. */
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();

app.on('second-instance', (_event, argv, workingDirectory) => {
  // Linux and Windows hand slider:// links and files over as an argument to a second start –
  // relative to where that start was made.
  for (const arg of argv) if (arg.startsWith('slider://')) takeLink(arg);
  takeFiles(filesIn(argv.slice(1), workingDirectory));
  toFront();
});

/** The window to the front, restored if it was minimized. */
function toFront() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

// ── Signing in to a Slider server (BER-201) ──────────────────────────────────────────────────
// „Anmelden“ opens the server's /desktop-anmelden in the browser; it comes back here as
// slider://auth?code=…&state=…, and the local server trades the code for a session.

if (app.isPackaged) app.setAsDefaultProtocolClient('slider');
else app.setAsDefaultProtocolClient('slider', process.execPath, [path.resolve(process.argv[1])]);

/** Links that came before the API was up. */
const linksWaiting = [];

function takeLink(url) {
  if (ready && serving) void followLink(url);
  else linksWaiting.push(url);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  takeLink(url);
});
// On Linux a link that starts Slider comes as an argument.
for (const arg of process.argv.slice(1)) if (arg.startsWith('slider://')) linksWaiting.push(arg);

// ── Files on this computer (BER-201) ─────────────────────────────────────────────────────────
// An ODP opened (Finder, Dock, ⌘O, an argument on Linux) is linked: the API writes every step back
// into it and takes changes made elsewhere in. A PowerPoint or a PDF opens as a copy.

/** What Slider opens from the file system (as package.json's fileAssociations). */
const OPENS = /\.(odp|otp|pptx|ppt|pdf|key)$/i;
const filesIn = (args, cwd = process.cwd()) =>
  args
    .filter((arg) => !arg.startsWith('-') && OPENS.test(arg))
    .map((arg) => path.resolve(cwd, arg))
    .filter((file) => existsSync(file));

/** Files that came before the API was up. */
const filesWaiting = [];

function takeFiles(paths) {
  if (paths.length === 0) return;
  if (ready && serving) void openFiles(paths);
  else filesWaiting.push(...paths);
}

// macOS: a file double-clicked in the Finder or dropped on the Dock icon – also before `ready`.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  takeFiles([filePath]);
});
// Linux: files the app is started with.
filesWaiting.push(...filesIn(process.argv.slice(1)));

/** The local API as Electron: the app's secret proves it (routes that take a path, the session). */
function callApi(route, { method = 'GET', body, timeout } = {}) {
  return fetch(`${origin}/api${route}`, {
    method,
    headers: {
      'x-slider-desktop-secret': apiSecret,
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: timeout ? AbortSignal.timeout(timeout) : undefined,
  });
}

/** POST to the local API; refused: its message as the error. */
async function askApi(route, body, failed = 'Das hat nicht geklappt.') {
  const response = await callApi(route, { method: 'POST', body });
  const answer = await response.json().catch(() => null);
  if (!response.ok) throw new Error(answer?.error?.message ?? failed);
  return answer;
}

async function openFiles(paths) {
  if (paths.length === 0) return;
  // macOS: the app runs on without a window – the files open in a new one.
  if (!tabsWindow) {
    openWindow();
    await startTabs();
  }
  for (const filePath of paths) {
    try {
      const { deckId } = await askApi('/desktop/files/open', { path: filePath });
      app.addRecentDocument(filePath);
      tabsWindow?.openDeck(await pageOfDeck(deckId));
    } catch (error) {
      dialog.showErrorBox(`„${path.basename(filePath)}“ öffnet nicht`, error.message);
    }
  }
  toFront();
}

/**
 * Where a deck of this computer opens: online the server's page – a deck just made here goes up
 * first (a pass) – else, or when it could not go up, here.
 */
async function pageOfDeck(deckId) {
  const here = `${origin}/d/${deckId}`;
  if (!live) return here;
  if (!ids.decks[deckId]) {
    await askApi('/desktop/cloud/sync', {}).catch(() => {});
    await syncCloud();
  }
  return toPageOrigin(here) ?? here;
}

/** „Öffnen …“ (⌘O, and from the page): the system's file dialog. */
async function chooseFiles() {
  if (!mainWindow) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Präsentationen', extensions: ['odp', 'otp', 'pptx', 'ppt', 'pdf', 'key'] }],
  });
  if (!canceled) await openFiles(filePaths);
}

/** „Als Datei sichern …“ (⌘⇧S, and from the page): the presentation is that ODP from then on. */
async function saveAsFile(deckId, title) {
  if (!mainWindow || !deckId) return false;
  const name = `${(title || 'Präsentation').replace(/[/\\:]/g, '-')}.odp`;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), name),
    filters: [{ name: 'ODP-Präsentation', extensions: ['odp'] }],
  });
  if (canceled || !filePath) return false;
  try {
    await askApi(`/desktop/files/${encodeURIComponent(deckId)}/save`, { path: filePath });
    app.addRecentDocument(filePath);
    return true;
  } catch (error) {
    dialog.showErrorBox('Sichern hat nicht geklappt', error.message);
    return false;
  }
}

/** The bridge of Slider's pages (page-preload.cjs): only its own local pages are answered. */
const fromOwnPage = (event) => {
  try {
    const of = new URL(event.senderFrame?.url ?? '').origin;
    return (origin !== null && of === origin) || (cloudOrigin !== null && of === cloudOrigin);
  } catch {
    return false;
  }
};
ipcMain.handle('files:open', async (event) => {
  if (fromOwnPage(event)) await chooseFiles();
});
ipcMain.handle('files:save', async (event, deckId, title) =>
  fromOwnPage(event) && typeof deckId === 'string'
    ? saveAsFile(localDeckOf(event, deckId), String(title ?? ''))
    : false,
);

/** The asking page is the server's: its deck ids are the server's. */
const fromServerPage = (event) =>
  cloudOrigin !== null && new URL(event.senderFrame?.url ?? origin).origin === cloudOrigin;

/** A deck id of the asking page (the server's on its pages) as this computer's. */
function localDeckOf(event, deckId) {
  return fromServerPage(event) ? (flip(ids.decks)[deckId] ?? null) : deckId;
}

/** The local API as Electron (GET). */
async function readApi(route) {
  const response = await callApi(route);
  if (!response.ok) throw new Error('Das hat nicht geklappt.');
  return response.json();
}

/**
 * What this computer adds to a page, by the page's own deck ids: the account's decks brought here
 * (and whether kept after signing out), the decks that are a file here, the platform.
 */
ipcMain.handle('desktop:state', async (event) => {
  if (!fromOwnPage(event) || !origin) return null;
  const [cloud, files] = await Promise.all([
    readApi('/desktop/cloud').catch(() => null),
    readApi('/desktop/files').catch(() => ({})),
  ]);
  const onServer = fromServerPage(event);
  const pageId = (deckId) => (onServer ? ids.decks[deckId] : deckId);
  const kept = {};
  for (const [deckId, { keep }] of Object.entries(cloud?.cloudDecks ?? {})) {
    if (pageId(deckId)) kept[pageId(deckId)] = keep;
  }
  const local = {};
  for (const [deckId, file] of Object.entries(files)) {
    if (pageId(deckId)) {
      local[pageId(deckId)] = { missing: file.missing, changedAt: file.changedAt ?? null };
    }
  }
  return {
    platform: process.platform,
    account: cloud?.account ?? null,
    server: cloud?.server ?? null,
    live,
    kept,
    files: local,
  };
});

ipcMain.handle('desktop:keep', async (event, deckId, keep) => {
  if (!fromOwnPage(event) || typeof deckId !== 'string') return false;
  const id = localDeckOf(event, deckId);
  if (!id) return false;
  const response = await callApi(`/desktop/cloud/decks/${encodeURIComponent(id)}/keep`, {
    method: 'PUT',
    body: { keep: keep === true },
  });
  return response.ok;
});

ipcMain.handle('desktop:reveal', async (event, deckId) => {
  if (!fromOwnPage(event) || typeof deckId !== 'string') return false;
  const id = localDeckOf(event, deckId);
  if (!id) return false;
  return askApi(`/desktop/files/${encodeURIComponent(id)}/reveal`, {}).then(
    ({ path: filePath }) => {
      shell.showItemInFolder(filePath);
      return true;
    },
    () => false,
  );
});

// ── One more account on the server's pages (like Figma): signed in in the browser ─────────────

/** state → the PKCE verifier of a „Weiteres Konto hinzufügen“ under way, and its server. */
const adding = new Map();
const ADDING_TTL_MS = 15 * 60_000;
/** As the server keeps them (apps/api/src/auth/session.ts): the others, and for how long. */
const MAX_OTHER_ACCOUNTS = 4;
const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60;

/**
 * „Weiteres Konto hinzufügen“ on the server's pages: the browser signs in (logins like Google's
 * refuse an app's own window, and the browser knows the person's accounts) and hands a one-time
 * code back through `slider://auth`, as signing the app in does – only that the session goes to
 * the pages' cookies, beside the accounts already there, not to this computer's sync.
 */
ipcMain.handle('desktop:addAccount', (event) => {
  if (!fromOwnPage(event) || !fromServerPage(event)) return false;
  const now = Date.now();
  for (const [state, entry] of adding) if (entry.expires < now) adding.delete(state);
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  adding.set(state, { verifier, server: cloudOrigin, expires: now + ADDING_TTL_MS });
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({ challenge, state, add: '1' });
  openExternal(`${cloudOrigin}/desktop-anmelden?${query.toString()}`);
  return true;
});

/** The browser's code for an account to add: its session becomes the pages', the others wait. */
async function addAccount({ verifier, server }, code) {
  if (server !== cloudOrigin) throw new Error('Die App ist inzwischen woanders angemeldet.');
  const response = await fetch(`${server}/api/auth/desktop/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
    signal: AbortSignal.timeout(15_000),
  });
  const answer = await response.json().catch(() => null);
  if (!response.ok || typeof answer?.token !== 'string') {
    throw new Error(answer?.error?.message ?? 'Das hat nicht geklappt.');
  }
  // In line with reading the session (`syncCloud`): it must not put the app's token over the
  // account just added.
  syncing = syncing.then(async () => {
    const secure = server.startsWith('https://');
    const prefix = secure ? '__Host-' : '';
    const cookies = session.defaultSession.cookies;
    const valueOf = async (name) => (await cookies.get({ url: server, name }))[0]?.value ?? '';
    const others = [
      await valueOf(`${prefix}slider_session`),
      ...(await valueOf(`${prefix}slider_accounts`)).split('.'),
    ]
      .filter((token) => token && token !== answer.token)
      .slice(0, MAX_OTHER_ACCOUNTS);
    const cookie = (name, value) => ({
      url: server,
      name: `${prefix}${name}`,
      value,
      path: '/',
      secure,
      httpOnly: true,
      sameSite: 'lax',
      expirationDate: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S,
    });
    await cookies.set(cookie('slider_session', answer.token));
    if (others.length > 0) await cookies.set(cookie('slider_accounts', others.join('.')));
  });
  await syncing;
  logLive('account added to the pages');
  // Every page anew, as the new account: presentation tabs close, home shows its workspaces.
  for (const contents of [...(tabsWindow?.contents() ?? [])]) void contents.loadURL(server);
}

/** „Abmelden“ on the server's pages: this computer signs out (and ends its session there). */
ipcMain.handle('desktop:signOut', async (event) => {
  if (!fromOwnPage(event) || !origin) return false;
  const server = cloudOrigin;
  const response = await callApi('/desktop/cloud', { method: 'DELETE' });
  // The other accounts signed in on the pages end on the server too, not only in the cookie
  // (`syncCloud` drops that): with the pages' cookies, as their „Abmelden“ in a browser.
  if (response.ok && server) {
    await session.defaultSession
      .fetch(`${server}/api/auth/logout`, {
        method: 'POST',
        headers: { origin: server },
        signal: AbortSignal.timeout(5000),
      })
      .catch(() => {});
  }
  // Signed out: `syncCloud` finds the session gone and the tabs leave the server (`leaveServer`).
  await syncCloud();
  return response.ok;
});

/**
 * Signed out – here, or the server ended the session: the tabs leave the server's pages for this
 * computer's, by the ids they were shown with (`before`, the ids are gone by now). What stays here
 * (made here, kept) moves across; a tab with nothing here closes.
 */
function leaveServer(before) {
  live = false;
  if (!before.server || !tabsWindow) return;
  tabsWindow.moveTo(
    origin,
    (url) =>
      moveUrl(url, {
        from: before.server,
        to: origin,
        decks: flip(before.ids.decks),
        workspaces: flip(before.ids.workspaces),
      }),
    { dropUnknown: true },
  );
}

/** A pass over the files on this computer now: changes come in, the last step goes out. */
async function flushFiles() {
  if (!origin || !serving) return;
  await callApi('/desktop/files/sync', { method: 'POST', body: {}, timeout: 5000 }).catch(() => {});
}

// ── Online: the server's pages; offline: this computer's (live.mjs) ─────────────────────────

/** A page address of this computer as the server's, or back; `null`: nothing to move to. */
function toPageOrigin(url) {
  return live
    ? moveUrl(url, { from: origin, to: cloudOrigin, ...ids })
    : cloudOrigin
      ? moveUrl(url, {
          from: cloudOrigin,
          to: origin,
          decks: flip(ids.decks),
          workspaces: flip(ids.workspaces),
        })
      : url;
}

/** Why the tabs show the server's pages or this computer's: `logs/live.log`. */
function logLive(message) {
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(path.join(logDir, 'live.log'), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // A log that can't be written changes nothing.
  }
}

let lastMiss = null;
const serverAnswers = createReachability(async () => {
  if (!cloudOrigin) return false;
  try {
    const response = await fetch(`${cloudOrigin}/api/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`health ${response.status}`);
    lastMiss = null;
    return true;
  } catch (error) {
    const why = error.cause?.code ?? error.message;
    if (why !== lastMiss) logLive(`${cloudOrigin} does not answer: ${why}`);
    lastMiss = why;
    return false;
  }
});

let following = null;
/** Online or not, the tabs show the right side. Back online: the steps made offline go up first. */
function followConnection() {
  following ??= (async () => {
    const up = cloudOrigin !== null && (await serverAnswers());
    if (up === live || !tabsWindow) return;
    logLive(`${up ? 'online' : 'offline'} (server ${cloudOrigin ?? 'none'})`);
    if (up) {
      await askApi('/desktop/cloud/sync', {}).catch((error) =>
        logLive(`sync before going live failed: ${error.message}`),
      );
      await syncCloud();
      if (!cloudOrigin) return logLive('signed out meanwhile, staying here');
    }
    const leaving = live ? cloudOrigin : origin;
    live = up;
    logLive(`tabs move to ${live ? cloudOrigin : origin}`);
    tabsWindow.moveTo(live ? cloudOrigin : origin, (url) =>
      new URL(url).origin === leaving ? toPageOrigin(url) : url,
    );
  })()
    // Let go of only once it is kept: signed in nowhere the pass ends without waiting for
    // anything – cleared inside it, that was before `following` held it, and it stayed there for
    // good (no pass ever again: signed in then, the tabs never moved to the server).
    .finally(() => {
      following = null;
    });
  return following;
}

/** A page the Cloud app handed over, kept until this app is signed in at its server. */
let pageWaiting = null;

/** Where „Anmelden“ goes: the server signed in to last, at first the configured one. */
async function signInServer() {
  try {
    const response = await callApi('/desktop/cloud', { timeout: 5000 });
    if (!response.ok) return null;
    const { server } = await response.json();
    return server ? new URL(server).origin : null;
  } catch {
    return null;
  }
}

/**
 * A presentation from the Cloud app while this app is signed in nowhere. Asked, since signing in
 * brings that account's presentations here – only for the server this app signs in to: any web
 * page can hand over a `slider://open` link, and must not offer signing in to one of its choosing.
 */
async function offerSignIn(page) {
  const server = new URL(page).origin;
  if (server !== (await signInServer())) return void shell.openExternal(page);
  toFront();
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    message: `Slider an ${new URL(page).host} anmelden?`,
    detail:
      'Die Präsentation liegt auf diesem Server. Angemeldet öffnet Slider sie hier – sonst zeigt sie der Browser.',
    buttons: ['Anmelden', 'Im Browser öffnen'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return void shell.openExternal(page);
  try {
    const { url } = await askApi('/desktop/cloud/start', { server });
    pageWaiting = page;
    openExternal(url);
  } catch (error) {
    dialog.showErrorBox('Anmelden hat nicht geklappt', error.message);
    void shell.openExternal(page);
  }
}

async function followLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return;
  }
  if (url.protocol !== 'slider:') return;
  // `slider://open?url=…`: a page of Slider's from the Cloud app (a presentation opened from the
  // files). Shown here if it is this account's server and it answers, else in the browser.
  if (url.hostname === 'open') {
    const page = url.searchParams.get('url');
    if (!page || !/^https?:/i.test(page)) return;
    let own;
    try {
      own = live && cloudOrigin !== null && new URL(page).origin === cloudOrigin;
    } catch {
      return;
    }
    if (own && tabsWindow) {
      tabsWindow.show(page);
      return toFront();
    }
    // Signed in nowhere: the way here is signing in at that server – offered, not taken.
    if (cloudOrigin === null && tabsWindow) return void offerSignIn(page);
    return void shell.openExternal(page);
  }
  if (url.hostname !== 'auth') return;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return;
  const add = adding.get(state);
  if (add) {
    adding.delete(state);
    try {
      await addAccount(add, code);
    } catch (error) {
      dialog.showErrorBox('Konto hinzufügen hat nicht geklappt', error.message);
    }
    return toFront();
  }
  try {
    await askApi('/desktop/cloud/finish', { code, state }, 'Die Anmeldung hat nicht geklappt.');
    await syncCloud({ force: true });
    // Signed in: the first pass brought the account's decks; the tabs move to the server's pages.
    await followConnection();
    // What the Cloud app handed over before (`offerSignIn`) opens now.
    const page = pageWaiting;
    pageWaiting = null;
    if (page && live && cloudOrigin === new URL(page).origin) tabsWindow?.show(page);
  } catch (error) {
    dialog.showErrorBox('Anmelden hat nicht geklappt', error.message);
  }
  // Back to the front: the page asks again who is signed in.
  toFront();
  for (const contents of tabsWindow?.contents?.() ?? []) {
    contents.executeJavaScript(
      "document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))",
      true,
    );
  }
}

/**
 * The local server answers only pages that carry this cookie (or Electron's secret): another
 * browser on this machine, or a web page made to reach 127.0.0.1, gets nothing
 * (apps/api/src/http/desktop-guard.ts, the same derivation).
 */
async function letPagesIn(local, secret) {
  const value = createHmac('sha256', secret).update('desktop-page').digest('base64url');
  await session.defaultSession.cookies.set({
    url: local,
    name: 'slider_desktop',
    value,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
  });
}

/**
 * The server's session as its cookie in the app's browser session, so its pages open in the tabs
 * signed in – or gone, once signed out. Asked at start, after signing in and when the window
 * comes to the front (signing out happens in the page).
 */
/** The token this app last put into its pages' cookie. */
let pagesToken = null;

/**
 * `force`: just signed in here – the pages take the app's session whatever they had. Otherwise
 * the pages' own sign-in wins, as in a browser: switched to another account there (several
 * accounts, like Figma), they stay on it; only none, or this app's previous token, is replaced.
 */
function syncCloud(options) {
  // One after another: an answer from before signing in must not come in after the one from
  // after it and take the session away again.
  syncing = syncing
    .then(() => readCloud(options))
    // Never silent: a failure here leaves the tabs where they are, with nothing to tell why.
    .catch((error) => logLive(`session not taken: ${error?.stack ?? error}`));
  return syncing;
}
let syncing = Promise.resolve();

async function readCloud({ force = false } = {}) {
  if (!origin || !apiSecret) return;
  let answer;
  try {
    const response = await callApi('/desktop/cloud/session');
    if (!response.ok) return logLive(`session not read: ${response.status}`);
    answer = await response.json();
  } catch (error) {
    return logLive(`session not read: ${error.message}`);
  }
  const { server, token } = answer;
  const before = { server: cloudOrigin, ids };
  ids = { decks: answer.decks ?? {}, workspaces: answer.workspaces ?? {} };
  const secure = server.startsWith('https://');
  // As the server names it (apps/api/src/auth/cookies.ts): `__Host-` on https.
  const name = `${secure ? '__Host-' : ''}slider_session`;
  const cookies = session.defaultSession.cookies;
  if (token) {
    cloudOrigin = new URL(server).origin;
    const [current] = await cookies.get({ url: server, name }).catch(() => []);
    if (force || !current || current.value === pagesToken) {
      await cookies
        .set({
          url: server,
          name,
          value: token,
          path: '/',
          secure,
          httpOnly: true,
          sameSite: 'lax',
        })
        .catch(() => {});
      // The pages lost their session (ended there, the cookie dropped) and stand at the login:
      // back in as the app's account, they load anew instead of asking to sign in in a tab.
      if (!current && live) {
        for (const contents of tabsWindow?.contents() ?? []) {
          if (contents.getURL().startsWith(`${cloudOrigin}/login`)) {
            void contents.loadURL(cloudOrigin);
          }
        }
      }
    }
    pagesToken = token;
  } else {
    cloudOrigin = null;
    pagesToken = null;
    // The other accounts signed in on the pages go too: the computer is left clean.
    await cookies.remove(server, name).catch(() => {});
    await cookies.remove(server, `${secure ? '__Host-' : ''}slider_accounts`).catch(() => {});
    if (before.server) {
      logLive('session gone, tabs leave the server');
      leaveServer(before);
    }
  }
}

// ── Keys: generated once, kept encrypted by the keychain ──────────────────────────────────────

/** `{ secret, dataKey }` – the API's SLIDER_SECRET and SLIDER_DATA_KEY. */
async function loadKeys() {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error(
      'Der Schlüsselbund ist nicht verfügbar – Slider kann seine Schlüssel nicht sicher ablegen.',
    );
  }
  const store = async (keys) => {
    mkdirSync(service.root, { recursive: true });
    writeFileSync(keysFile, await safeStorage.encryptStringAsync(JSON.stringify(keys)), {
      mode: 0o600,
    });
  };
  if (existsSync(keysFile)) {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
      readFileSync(keysFile),
    );
    const keys = JSON.parse(result);
    if (shouldReEncrypt) await store(keys);
    return keys;
  }
  const keys = {
    secret: randomBytes(48).toString('base64url'),
    dataKey: randomBytes(32).toString('base64url'),
  };
  await store(keys);
  return keys;
}

// ── The service ───────────────────────────────────────────────────────────────────────────────

/** The service this app carries: started when none runs, or in place of an older one. */
const ownService = (soffice) => ({
  app: 'Slider',
  // From the repo `getVersion` is Electron's own: a start from there is older than any release,
  // and among themselves the later stage is the newer.
  version: app.isPackaged ? app.getVersion() : '0.0.0',
  built: app.isPackaged ? 0 : statSync(appRoot).mtimeMs,
  packaged: app.isPackaged,
  libreoffice: soffice ?? null,
  appRoot,
  bun: bunBinary,
});

/** The environment the service starts in. */
function serviceEnv(port, keys, soffice) {
  const user = os.userInfo().username;
  // A clean environment: nothing of the shell's .env or variables leaks in.
  return {
    HOME: os.homedir(),
    USER: user,
    LANG: process.env.LANG ?? 'de_DE.UTF-8',
    TMPDIR: os.tmpdir(),
    PATH: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(
      ':',
    ),
    NODE_ENV: 'production',
    SLIDER_DESKTOP: 'true',
    HOST: '127.0.0.1',
    PORT: String(port),
    SLIDER_URL: `http://127.0.0.1:${port}`,
    DATA_DIR: dataDir,
    WEB_DIST_DIR: path.join(appRoot, 'apps/web/dist'),
    ...(soffice && { LIBREOFFICE_PATH: soffice }),
    SLIDER_SECRET: keys.secret,
    SLIDER_DATA_KEY: keys.dataKey,
    DEV_OWNER_NAME: fullName(),
    DEV_OWNER_EMAIL: 'ich@slider.desktop',
    // The Slider server „Anmelden“ signs in to; unset: office.bertro.dev.
    ...(process.env.SLIDER_CLOUD_URL && { SLIDER_CLOUD_URL: process.env.SLIDER_CLOUD_URL }),
    // The release (CI sets it from the tag); from the repo package.json's 0.1.0 would mislead.
    ...(app.isPackaged && { SLIDER_VERSION: app.getVersion() }),
  };
}

/** A start or take under way (it holds the service's lock): quitting waits for it. */
let starting = null;

/**
 * Starts the service or takes the one that runs; resolves to `{ port, started }` once it
 * answers. `hungAfterMs`: see `useService`.
 */
function startService(keys, soffice, hungAfterMs) {
  const used = useService({
    paths: service,
    own: ownService(soffice),
    env: (port) => serviceEnv(port, keys, soffice),
    hungAfterMs,
  }).then((result) => {
    // Quit meanwhile: the service is being left, nothing goes on with it.
    serving = !quitting;
    return result;
  });
  starting = used;
  const done = () => {
    if (starting === used) starting = null;
  };
  used.then(done, done);
  return used;
}

/** Looks without an answer before the app acts (5 s each). */
const GONE_AFTER = 3;
/** A service that runs but has not answered for this many looks hangs (two minutes). */
const HUNG_AFTER = 24;
/** Started anew this often within ten minutes, the service keeps breaking: Slider says so. */
const MAX_STARTS = 3;

/**
 * The service is not this app's child: it may go without it – a newer app put its own in its
 * place, or it crashed. Gone for three looks in a row, it is taken or started anew (on the same
 * port, the pages go on). One that still runs is left alone – it may be busy starting – until
 * it has been silent for two minutes. When it will not start, or breaks again and again, Slider
 * says so and ends, as it did when the service was its own.
 */
function watchService(keys, soffice) {
  let missed = 0;
  let busy = false;
  const starts = [];
  setInterval(async () => {
    if (quitting || busy || !serving) return;
    busy = true;
    try {
      missed = (await serviceAnswers(Number(new URL(origin).port))) ? 0 : missed + 1;
      if (missed < GONE_AFTER || quitting) return;
      const hung = missed >= HUNG_AFTER;
      if (serviceRuns(service) && !hung) return;
      const { started } = await startService(keys, soffice, hung ? 0 : undefined);
      missed = 0;
      if (!started) return;
      const now = Date.now();
      starts.push(now);
      while (starts[0] < now - 600_000) starts.shift();
      if (starts.length >= MAX_STARTS) throw new Error('Er bricht immer wieder ab.');
    } catch (error) {
      if (quitting) return;
      quitting = true;
      dialog.showErrorBox(
        'Slider wurde beendet',
        `Der lokale Dienst läuft nicht mehr. ${error.message}\n\nProtokoll: ${path.join(logDir, 'api.log')}`,
      );
      await stopService();
      app.exit(1);
    } finally {
      busy = false;
    }
  }, 5_000);
}

/** The full name the system knows for this account (Linux: the GECOS field), else its name. */
function fullName() {
  const user = os.userInfo().username;
  try {
    const name =
      process.platform === 'darwin'
        ? execFileSync('/usr/bin/id', ['-F'], { encoding: 'utf8' })
        : (execFileSync('getent', ['passwd', user], { encoding: 'utf8' })
            .split(':')[4]
            ?.split(',')[0] ?? '');
    return name.trim() || user;
  } catch {
    return user;
  }
}

/** This app is done with the service; the last app to go ends it. */
async function stopService() {
  serving = false;
  // A start under way holds the lock: let it through first, but a quit does not hang on it.
  if (starting) {
    await Promise.race([
      starting.catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
  await leaveService(service);
}

// ── Window ────────────────────────────────────────────────────────────────────────────────────

const isOwn = (url) => {
  try {
    const { origin: of } = new URL(url);
    return (origin !== null && of === origin) || (cloudOrigin !== null && of === cloudOrigin);
  } catch {
    return false;
  }
};

/** Cloud's pages (`appOfPath` in apps/web/src/lib/apps.ts). */
const CLOUD_PAGE = /^\/(cloud|office|w\/[^/]+\/dateien(\/.*)?)\/?$/;
/**
 * The app is Slider only: a page of Cloud's on the server opens in the browser, where one moves
 * between the apps. This computer's own pages have no browser to go to and stay.
 */
function inBrowser(url) {
  const { origin: server, pathname } = new URL(url);
  if (server !== cloudOrigin || !CLOUD_PAGE.test(pathname)) return false;
  shell.openExternal(url);
  return true;
}

function openExternal(url) {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
}

function setMenu() {
  // Standard roles: Chromium hands ⌘C/⌘V/⌘Z to the page first, the menu only gets what the page
  // leaves – so Slider's own shortcuts win and plain text fields still copy and paste.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      {
        // „Ablage“ as macOS calls it; elsewhere „Datei“, which carries Beenden too.
        label: process.platform === 'darwin' ? 'Ablage' : 'Datei',
        submenu: [
          { label: 'Öffnen …', accelerator: 'CmdOrCtrl+O', click: () => void chooseFiles() },
          ...(process.platform === 'darwin'
            ? [
                {
                  label: 'Zuletzt geöffnet',
                  role: 'recentDocuments',
                  submenu: [{ label: 'Liste löschen', role: 'clearRecentDocuments' }],
                },
              ]
            : []),
          { type: 'separator' },
          {
            label: 'Als Datei sichern …',
            accelerator: 'CmdOrCtrl+Shift+S',
            click: () => void saveFromMenu(),
          },
          ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }]),
        ],
      },
      { role: 'editMenu' },
      {
        role: 'viewMenu',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        role: 'windowMenu',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          // No shortcut: ⌘[ is the editor's. Only off a login provider's page (`back`).
          { label: 'Zurück zu Slider', click: () => tabsWindow?.back() },
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
      {
        role: 'help',
        submenu: [
          { label: 'LibreOffice laden …', click: () => loadLibreOfficeFromMenu() },
          { label: 'Nach Updates suchen …', click: () => checkFromMenu(mainWindow) },
          { type: 'separator' },
          { label: 'Datenordner zeigen', click: () => shell.openPath(service.root) },
          { label: 'Protokoll zeigen', click: () => shell.openPath(path.join(logDir, 'api.log')) },
        ],
      },
    ]),
  );
}

/** ⌘⇧S: the presentation in front, its title from the API. */
async function saveFromMenu() {
  const shown = tabsWindow?.activeDeckId();
  if (!shown || !origin) return;
  // On the server's page its id; the file is this computer's copy.
  const deckId = live ? (flip(ids.decks)[shown] ?? null) : shown;
  if (!deckId) return;
  const deck = await readApi(`/decks/${encodeURIComponent(deckId)}`).catch(() => null);
  await saveAsFile(deckId, deck?.title ?? '');
}

// ── LibreOffice ───────────────────────────────────────────────────────────────────────────────

// Tests: SLIDER_NO_INSTALLED_LIBREOFFICE=1 ignores an installed one, SLIDER_LIBREOFFICE_ANSWER
// (load | later) answers the question without showing it.
const lookFor = { installed: !process.env.SLIDER_NO_INSTALLED_LIBREOFFICE };
const testAnswer = process.env.SLIDER_LIBREOFFICE_ANSWER;

/** The line under „Slider“ in the start window. */
function showStatus(text) {
  tabsWindow?.home
    .executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(text)}`)
    .catch(() => {});
}

/** Loads LibreOffice with its progress in the Dock (and, while starting, in the start window). */
async function loadLibreOffice() {
  try {
    return await installLibreOffice(service.root, (phase, share) => {
      if (phase === 'download') {
        mainWindow?.setProgressBar(share);
        showStatus(`LibreOffice wird geladen … ${Math.floor(share * 100)} %`);
      } else {
        mainWindow?.setProgressBar(2);
        showStatus('LibreOffice wird eingerichtet …');
      }
    });
  } finally {
    mainWindow?.setProgressBar(-1);
    showStatus('');
  }
}

/** No LibreOffice on this Mac: asks to load it; `null` – later, or it failed (asked again next start). */
async function offerLibreOffice() {
  if (process.platform !== 'darwin') {
    if (!testAnswer) await showLinuxHint();
    return null;
  }
  const { response } = testAnswer
    ? { response: testAnswer === 'load' ? 0 : 1 }
    : await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: 'LibreOffice laden?',
        detail: `Slider zeichnet Folien und bearbeitet sie mit LibreOffice. Es wird einmalig geladen (etwa ${DOWNLOAD_MB} MB von libreoffice.org), danach geht alles offline.\n\nOhne LibreOffice kannst du Präsentationen ansehen, aber nicht bearbeiten.`,
        buttons: ['Laden', 'Später'],
        defaultId: 0,
        cancelId: 1,
      });
  if (response !== 0) return null;
  try {
    return await loadLibreOffice();
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: 'LibreOffice konnte nicht geladen werden',
      detail: `${error.message}\n\nSlider startet ohne – beim nächsten Start fragt es wieder, oder Hilfe → LibreOffice laden.`,
    });
    return null;
  }
}

/** Linux: LibreOffice comes from the system's packages, Slider only says how. */
async function showLinuxHint() {
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    message: 'LibreOffice fehlt',
    detail: `Slider zeichnet Folien und bearbeitet sie mit LibreOffice. ${LINUX_HINT}\n\nOhne LibreOffice kannst du Präsentationen ansehen, aber nicht bearbeiten.`,
  });
}

/** Hilfe → LibreOffice laden: loads it while Slider runs, then starts again to use it. */
async function loadLibreOfficeFromMenu() {
  const found = findLibreOffice(service.root, lookFor);
  if (found) {
    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'LibreOffice ist da',
      detail: found.replace(/\/Contents\/MacOS\/soffice$/, ''),
    });
    return;
  }
  if (process.platform !== 'darwin') {
    await showLinuxHint();
    return;
  }
  try {
    await loadLibreOffice();
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: 'LibreOffice konnte nicht geladen werden',
      detail: error.message,
    });
    return;
  }
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    message: 'LibreOffice ist bereit',
    detail: 'Slider startet neu, damit du bearbeiten kannst.',
  });
  app.relaunch();
  app.quit();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  if (!firstInstance) return;
  // Packaged, the bundle carries the icon; from the repo (`bun run desktop`) Electron's own would show.
  if (!app.isPackaged) app.dock?.setIcon(path.join(here, 'icon.png'));
  setMenu();
  openWindow();
  showSplash();
  try {
    const keys = await loadKeys();
    apiSecret = keys.secret;
    const found = findLibreOffice(service.root, lookFor);
    const soffice = found
      ? await ownLibreOffice(service.root, found, () =>
          showStatus('LibreOffice wird eingerichtet …'),
        )
      : await offerLibreOffice();
    showStatus('');
    origin = `http://127.0.0.1:${(await startService(keys, soffice)).port}`;
    // Quit while it started: `before-quit` leaves the service and ends the app.
    if (quitting) return;
    watchService(keys, soffice);
    await letPagesIn(origin, keys.secret);
    // Before the tabs of last time come back: some may be on the server.
    await syncCloud();
    live = cloudOrigin !== null && (await serverAnswers());
    logLive(`start: ${live ? `live on ${cloudOrigin}` : `here (server ${cloudOrigin ?? 'none'})`}`);
    if (live) {
      await askApi('/desktop/cloud/sync', {}).catch(() => {});
      // The pass brought decks made offline up: their server ids, for the tabs of last time.
      await syncCloud();
      live = cloudOrigin !== null;
    }
    // Closed while LibreOffice loaded (macOS keeps the app running): a new window.
    if (!tabsWindow) openWindow();
    await startTabs();
    ready = true;
    // The session is read anew each time: signed in or out meanwhile, the tabs follow within
    // seconds even where no focus or link told so.
    setInterval(() => void syncCloud().then(followConnection), 10_000);
    for (const link of linksWaiting.splice(0)) void followLink(link);
    void openFiles(filesWaiting.splice(0));
    startUpdates({ logDir, window: () => mainWindow });
  } catch (error) {
    if (quitting) return;
    dialog.showErrorBox(
      'Slider startet nicht',
      `${error.message}\n\nProtokoll: ${path.join(logDir, 'api.log')}`,
    );
    quitting = true;
    await stopService();
    app.exit(1);
  }
});

const themeFile = path.join(userData, 'theme.json');

/** What Slider opens in: the theme chosen in the app last time, else the system's. */
function startTheme() {
  try {
    const { choice } = JSON.parse(readFileSync(themeFile, 'utf8'));
    if (choice === 'light' || choice === 'dark') return choice;
  } catch {
    // nothing chosen yet
  }
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/** The start screen in the home tab while Slider starts. */
function showSplash() {
  tabsWindow.home.loadFile(path.join(here, 'splash.html'), { query: { theme: startTheme() } });
}

function openWindow() {
  tabsWindow = createTabWindow({
    here,
    stateFile: path.join(userData, 'tabs.json'),
    themeFile,
    theme: startTheme(),
    isOwn,
    openExternal,
    elsewhere: inBrowser,
  });
  mainWindow = tabsWindow.window;
  mainWindow.on('focus', () => {
    void syncCloud().then(followConnection);
    // Back from another app: a file changed there comes in now.
    void flushFiles();
  });
  // Off to another app (to open the file there): the last step is in it.
  mainWindow.on('blur', () => void flushFiles());
  mainWindow.on('closed', () => {
    mainWindow = null;
    tabsWindow = null;
  });
}

/** The tabs on the side they show now (online the server's), last time's brought there. */
const startTabs = () => tabsWindow.start(live ? cloudOrigin : origin, (url) => toPageOrigin(url));

app.on('activate', () => {
  if (mainWindow || !app.isReady()) return;
  openWindow();
  // Still starting: the start screen, until the start brings the tabs.
  if (ready) void startTabs();
  else showSplash();
});

app.on('window-all-closed', () => {
  // macOS: the app stays in the Dock with its service running, like other Mac apps.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitting || !firstInstance) return;
  quitting = true;
  event.preventDefault();
  // The last step into its file, rested or not.
  flushFiles()
    .then(stopService)
    .then(() => app.exit(0));
});
