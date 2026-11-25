// One window, Slider's own tab bar on top (no macOS title bar), a tab per open presentation
// below it – like Figma's desktop app. The first tab, „Präsentationen“, is the app's home and
// stays; a presentation picked there opens in a tab of its own (or the one it has), and when a
// presentation tab leaves its presentation („Präsentation schließen“) the tab closes and home
// shows where it went. Every tab is the web app in a view of its own, all on one origin – one
// outbox, one service worker, as in browser tabs.
//
// Cloud (`cloud/main.mjs`) is the same window with its own words (`app`): its home is the
// files, a tab is a folder, an area or – when Slider is not there to take it – a presentation.
import {
  BaseWindow,
  Menu,
  View,
  WebContentsView,
  desktopCapturer,
  ipcMain,
  session,
} from 'electron';
import { existsSync, readFileSync, writeFile, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { movedUrl } from './hosted.mjs';

const BAR_HEIGHT = 40;
const HOME_TITLE = 'Präsentationen';
/** The tab bar's buttons for the presentation in front (`slider:desktop-bar` in the page). */
const DECK_ACTIONS = ['present', 'presenter', 'share', 'close'];
/**
 * How a page and the bar's buttons speak: the presentation's, unless an app brings its own
 * (`app.bar`, Writer's document). `channel`: the page's offer in; `event`: the click out, in the
 * page; `offer`: what is kept of an offer; `allows`: whether the offer has that button.
 */
const DECK_BAR = {
  channel: 'tabs:deckBar',
  event: 'slider:desktop-bar',
  actions: DECK_ACTIONS,
  offer: (offer) => ({
    share: offer.share === true,
    shareOpen: offer.shareOpen === true,
    template: offer.template === true,
  }),
  allows: (action, bar) => action !== 'share' || bar.share,
};
/** `--color-canvas` per theme. */
const canvas = (theme) => (theme === 'light' ? '#f4f4f5' : '#000000');

/**
 * @param {object} options
 * @param {string} options.here – the folder of main.mjs (tab bar files beside it)
 * @param {string} options.stateFile – where the open tabs are kept for the next start
 * @param {string} options.themeFile – where the app's theme choice is kept for the next start
 * @param {'light' | 'dark'} options.theme – the theme to open in
 * @param {(url: string) => boolean} options.isOwn – Slider's own address
 * @param {(url: string) => void} options.openExternal
 * @param {object} [options.app] – another app's window (Cloud); left out: Slider's
 * @param {string} options.app.name – which mark home wears in the bar (`tabbar.js`)
 * @param {string} options.app.title – the window's name
 * @param {string} options.app.homeTitle
 * @param {string} options.app.tabTitle – a tab's name until its page tells
 * @param {string} options.app.preload – the pages' preload
 * @param {(url: URL) => string | null} options.app.tabOf – what has a tab of its own, by a key
 * @param {(title: string) => string} options.app.pageTitle – a tab's name from its page's title
 * @param {string} options.app.start – where home starts, after the server's address
 * @param {boolean} [options.app.newTab] – „+“ in the bar: a tab at the start, free to move about;
 *   a link that asks for a new tab gets such a one where its page has no tab of its own
 * @param {() => {label: string, path: string}[]} [options.app.newTabs] – beside „+“: what a new
 *   tab can start on (the apps this window shows), as a menu
 * @param {(url: URL) => boolean} [options.app.guest] – a page of another app shown in this
 *   window: home gives it a tab, a tab goes there itself and is free from then on
 * @param {boolean} [options.app.split] – two tabs side by side, and files dropped onto a tab
 * @param {typeof DECK_BAR} [options.app.bar] – the page's buttons in the bar, if not the deck's
 * @param {(front: { kind: 'home' | 'deck' | null, bar: object | null }) => void} [options.app.onFront]
 *   – told with every state the bar gets: what is in front (the app's menu follows it)
 * @param {(url: string) => boolean} [options.elsewhere] – a page of the other app, handed to it
 *   (`true`): this window stays where it was
 */
export function createTabWindow({
  here,
  stateFile,
  themeFile,
  theme: startTheme,
  isOwn,
  openExternal,
  app = null,
  elsewhere = null,
}) {
  const homeTitle = app?.homeTitle ?? HOME_TITLE;
  const pageBar = app?.bar ?? DECK_BAR;
  // A BaseWindow with the bar as a view of its own, only 40 px high: a BrowserWindow's own page
  // spans the whole window, and on macOS it – with its drag region – took the real mouse clicks
  // meant for the tab views laid over it (views are siblings there since Electron 30).
  const window = new BaseWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: app?.title ?? 'Slider',
    show: false,
    // macOS: the tab bar is the title bar, traffic lights inside it. Linux keeps its own frame.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 13 } }
      : { autoHideMenuBar: true }),
    backgroundColor: canvas(startTheme),
  });
  const bar = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(here, 'tabbar', 'preload.cjs'),
    },
  });
  bar.setBackgroundColor(canvas(startTheme));
  // The bar is this one page: a file or link let go on it must not take its place (it would
  // speak with the bar's voice).
  bar.webContents.on('will-navigate', (event) => event.preventDefault());
  bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.contentView.addChildView(bar);
  bar.webContents.loadFile(path.join(here, 'tabbar', 'index.html'), {
    query: { theme: startTheme, platform: process.platform, app: app?.name ?? 'slider' },
  });
  bar.webContents.once('did-finish-load', () => window.show());

  /**
   * `bar`: what the presentation offers in the tab bar (Präsentieren, Referentenansicht,
   * Exportieren, ✕), as its page reported it; `fullscreen`: the page is presenting in full screen.
   * @type {{ id: number, kind: 'home' | 'deck', view: WebContentsView, title: string, deckId?: string, renamable?: boolean, bar?: { share: boolean, shareOpen: boolean, template: boolean } | null, fullscreen?: boolean }[]}
   */
  const tabs = [];
  let active = null;
  /** A tab loading behind the one in front, about to take over (`openFromHome`). */
  let arriving = null;
  /**
   * Side by side (`app.split`): the tab in the other half. `active` is the half with the keys –
   * a pick in the bar changes that one; `activeRight` says which half it is.
   */
  let beside = null;
  let activeRight = false;
  /** The tab in front before this one: what a split puts beside it. */
  let last = null;
  const seam = new View();
  seam.setVisible(false);
  let theme = startTheme;
  let origin = null;
  let nextId = 1;
  let closing = false;

  // A presentation on this computer or on the Slider server signed in to (BER-201). Only an id
  // as Slider makes them (a UUID): it goes into scripts run in the page.
  // In another app's window: the key of what has a tab there (`app.tabOf`).
  const deckIdOf = (url) => {
    if (!origin || !isOwn(url)) return null;
    if (app) return app.tabOf(new URL(url));
    return new URL(url).pathname.match(/^\/d\/([A-Za-z0-9-]{1,100})(?:\/|$)/)?.[1] ?? null;
  };
  /** A page of another app that this window shows in its tabs (`app.guest`). */
  const guestAt = (url) => Boolean(origin && app?.guest && isOwn(url) && app.guest(new URL(url)));
  /**
   * A page of another app (Cloud's files in Slider, a presentation in Writer): that app takes
   * it, and this page steps back to where it was. `loaded`: a page load, not a step of the router.
   */
  const handedOver = (contents, url, loaded = false) => {
    if (!origin || !isOwn(url) || !elsewhere?.(url)) return false;
    if (!loaded) contents.executeJavaScript('history.back()').catch(() => {});
    else if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    else contents.loadURL(homeUrl());
    return true;
  };
  /** Where home starts: Slider at the top, another app on its own page. */
  const homeUrl = () => origin + (app?.start ?? '');
  const deckApi = (deckId) => JSON.stringify(`/api/decks/${encodeURIComponent(deckId)}`);

  /** Out of Slider's pages only into the default browser; of this computer only the app's own. */
  const local = (url) => {
    try {
      return fileURLToPath(url).startsWith(here + path.sep);
    } catch {
      return false;
    }
  };
  function guard(contents) {
    // (A sign-in abroad comes and goes by redirects, which this does not see – on purpose.)
    contents.on('will-navigate', (event, url) => {
      if (isOwn(url) || local(url)) return;
      event.preventDefault();
      openExternal(url);
    });
  }
  // Camera, microphone, clipboard and the like: for Slider's own pages only (Electron says yes
  // to everyone unless told) – a foreign page shown on the way through a sign-in gets none.
  const mayAsk = (url) => Boolean(url) && (isOwn(url) || url.startsWith('file://'));
  session.defaultSession.setPermissionRequestHandler((contents, permission, done, details) =>
    done(mayAsk(details?.requestingUrl || contents?.getURL())),
  );
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) =>
    mayAsk(requestingOrigin || contents?.getURL()),
  );
  // Showing one's screen in a call (`getDisplayMedia`): Electron has no picker of its own – the
  // system's where there is one (macOS 15+), else the first screen. Slider's own pages only.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, done) => {
      if (!mayAsk(request.frame?.url || request.securityOrigin)) return done({});
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => done(sources[0] ? { video: sources[0] } : {}))
        .catch(() => done({}));
    },
    { useSystemPicker: true },
  );

  function newView() {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
        // `window.sliderDesktop`: files on this computer (BER-201), answered for Slider's own pages only.
        preload: app?.preload ?? path.join(here, 'page-preload.cjs'),
      },
    });
    view.setBackgroundColor(canvas(theme));
    const contents = view.webContents;
    // Links out of Slider open in the default browser; Slider's own new windows (presenting) stay.
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (origin && isOwn(url) && elsewhere?.(url)) return { action: 'deny' };
      // A link that asks for a new tab (an agent's desk) gets one: its page's own, or – with
      // „+“ in the bar – a free one. A window asked for as such (presenting: `popup`) stays a
      // window, and so does what is no page (a file's content).
      if (origin && isOwn(url) && disposition !== 'new-window') {
        if (deckIdOf(url)) {
          openDeck(url, true);
          return { action: 'deny' };
        }
        if (app?.newTab && !new URL(url).pathname.startsWith('/api/')) {
          openFree(url, true);
          return { action: 'deny' };
        }
      }
      if (isOwn(url)) return { action: 'allow' };
      openExternal(url);
      return { action: 'deny' };
    });
    guard(contents);
    // Slider's own new windows (presenting): the same rules as the tab they came from.
    contents.on('did-create-window', (child) => {
      guard(child.webContents);
      child.webContents.setWindowOpenHandler(({ url }) => {
        openExternal(url);
        return { action: 'deny' };
      });
    });
    return view;
  }

  const send = () => {
    if (window.isDestroyed()) return;
    bar.webContents.send('tabs:state', {
      tabs: tabs.map(({ id, kind, title, renamable }) => ({
        id,
        kind,
        title,
        renamable: !!renamable,
      })),
      // The tab on its way is the one picked: the bar does not wait for its page.
      active: (arriving ?? active)?.id ?? null,
      beside: beside?.id ?? null,
      // „Nebeneinander“: offered once there are two tabs.
      split: Boolean(app?.split) && tabs.length > 1,
      // „+“: a new tab at the app's start.
      fresh: Boolean(app?.newTab) && Boolean(origin),
      // Beside it: the apps a new tab can start on.
      freshMenu: Boolean(app?.newTab && app.newTabs) && Boolean(origin),
      deck: active?.kind === 'deck' ? (active.bar ?? null) : null,
      theme,
      fullscreen: window.isFullScreen(),
    });
    app?.onFront?.({ kind: active?.kind ?? null, bar: active?.bar ?? null });
  };

  const save = () => {
    // Not before start() – the tabs of last time are read there – nor while the window closes.
    if (!origin || closing) return;
    // (A „+“ tab on a page without a tab of its own is not kept: the start shows that anyway.)
    const decks = tabs
      .filter((tab) => tab.kind === 'deck' && deckIdOf(tab.url))
      .map((tab) => tab.url);
    try {
      writeFileSync(stateFile, JSON.stringify({ decks, active: tabs.indexOf(active) }));
    } catch {
      // Not worth stopping for: the tabs just don't come back.
    }
  };

  function layout() {
    const { width, height } = window.getContentBounds();
    // Presenting in full screen: the page takes the whole window, the bar steps aside.
    const top = active?.fullscreen ? 0 : BAR_HEIGHT;
    bar.setVisible(top > 0);
    bar.setBounds({ x: 0, y: 0, width, height: BAR_HEIGHT });
    const split = Boolean(beside) && top > 0;
    const half = Math.floor((width - 1) / 2);
    const halves = [
      { x: 0, y: top, width: half, height: height - top },
      { x: half + 1, y: top, width: width - half - 1, height: height - top },
    ];
    seam.setVisible(split);
    if (split) {
      seam.setBackgroundColor(theme === 'light' ? '#00000022' : '#ffffff26');
      seam.setBounds({ x: half, y: top, width: 1, height: height - top });
    }
    for (const tab of tabs) {
      // A tab getting ready draws behind the one in front, so it is there when it takes over.
      const shown = tab === active || tab === arriving || (split && tab === beside);
      tab.view.setVisible(shown);
      if (!shown) continue;
      const right = tab === beside ? !activeRight : activeRight;
      tab.view.setBounds(
        split ? halves[right ? 1 : 0] : { x: 0, y: top, width, height: height - top },
      );
    }
    // The one in front lies on top (adding a view that is there moves it up).
    if (arriving && active) window.contentView.addChildView(active.view);
  }

  // A call one is in follows into a tab a page opens (a presentation, another app's page – as the
  // web app's window for another app, `lib/call-handover.ts`) and out of a tab that closes: the
  // page in front before says its call (`data-call`), the page now in front is named after it and
  // takes it over – never a call left behind in a hidden tab. Only on opening and closing: a
  // plain switch of tabs leaves it where it is (taken over, the others hear one leave and come). Only between Slider's own pages on one
  // side (this computer or the server); the id as the server makes them, it goes into a script.
  const CALL_ID = /^[A-Za-z0-9-]{1,100}$/;
  const ownOrigin = (contents) => {
    if (!origin || contents.isDestroyed()) return null;
    const url = contents.getURL();
    return url && isOwn(url) ? new URL(url).origin : null;
  };
  /**
   * The call the page of `contents` is in, or `null` while it stays there (`data-call-stays`,
   * taken over it would join anew unmuted, without camera or screen) – sharing, unless `even`
   * (its page closes); muted, always.
   */
  async function callIn(contents, { even = false } = {}) {
    if (!ownOrigin(contents)) return null;
    try {
      const [id, stays] = await contents.executeJavaScript(
        `[document.documentElement.dataset.call ?? '', document.documentElement.dataset.callStays ?? '']`,
      );
      if (stays === 'muted' || (stays && !even)) return null;
      return typeof id === 'string' && CALL_ID.test(id) ? id : null;
    } catch {
      return null;
    }
  }
  /**
   * `to`'s page takes over the call `from`'s is in, once loaded; `even`: also one with the screen
   * or camera shared (`from` closes). Resolves whether it was handed on.
   */
  async function followCall(from, to, { even = false } = {}) {
    const side = ownOrigin(from.view.webContents);
    const callId = side ? await callIn(from.view.webContents, { even }) : null;
    const contents = to.view.webContents;
    if (!callId || contents.isDestroyed()) return false;
    const give = () => {
      // Never into a page that is not Slider's (a sign-in on the way) or on the other side, nor
      // into one put out of sight again meanwhile.
      if (to !== active || contents.isDestroyed() || ownOrigin(contents) !== side) return false;
      return contents
        .executeJavaScript(
          `window.name = ${JSON.stringify(`slider-call:${callId}`)};
           dispatchEvent(new Event('slider:call-handover'));`,
        )
        .then(
          () => true,
          () => false,
        );
    };
    // Whether it was handed: else a closing page need not wait to be out of it.
    if (!contents.isLoading()) return give();
    // (Never loading, or gone: not handed – a closing page is not kept on that account.)
    return new Promise((resolve) => {
      const end = (handed) => {
        clearTimeout(late);
        contents.removeListener('destroyed', gone);
        contents.removeListener('did-stop-loading', loaded);
        resolve(handed);
      };
      const gone = () => end(false);
      const loaded = () => end(give());
      const late = setTimeout(gone, 10_000);
      contents.once('destroyed', gone);
      contents.once('did-stop-loading', loaded);
    });
  }
  /** Whether the page of `contents` is in a call at all. */
  const stillIn = (contents) =>
    ownOrigin(contents)
      ? contents.executeJavaScript(`'call' in document.documentElement.dataset`).then(
          (is) => is === true,
          () => false,
        )
      : Promise.resolve(false);
  /** Closes a tab's page – once it is out of the call it handed on, at most 10 s later. */
  async function closeOnceOut(contents, handed) {
    const until = Date.now() + 10_000;
    while (handed && Date.now() < until && (await stillIn(contents)))
      await new Promise((resolve) => setTimeout(resolve, 250));
    if (!contents.isDestroyed()) contents.close();
  }

  function select(tab, { focus = true, follow = false } = {}) {
    if (!tab) return;
    const before = active;
    arriving = null;
    if (tab === beside) {
      // The other half: the keys go there, both stay where they are.
      beside = active;
      activeRight = !activeRight;
    } else if (active && active !== tab) last = active;
    active = tab;
    layout();
    if (focus) tab.view.webContents.focus();
    send();
    save();
    if (tab.kind === 'deck') refreshTitle(tab);
    // Opened from the tab in front before, which is out of sight now (not the other half): its
    // call comes along.
    if (follow && before && before !== tab && before !== beside) void followCall(before, tab);
  }

  async function refreshTitle(tab) {
    if (app) {
      const title = app.pageTitle(tab.view.webContents.getTitle());
      if (title && title !== tab.title) {
        tab.title = title;
        send();
      }
      return;
    }
    try {
      const deck = await tab.view.webContents.executeJavaScript(
        `fetch(${deckApi(tab.deckId)}).then((r) => (r.ok ? r.json() : null))
           .then((d) => d && { title: d.title, renamable: !!d.permissions?.canManage })`,
      );
      if (deck && (deck.title !== tab.title || deck.renamable !== tab.renamable)) {
        tab.title = deck.title;
        // „Umbenennen“ as in the deck's menu: for those who may manage it.
        tab.renamable = deck.renamable;
        send();
      }
    } catch {
      // The page is still loading; the next pick asks again.
    }
  }

  /** A double click on a tab renames its presentation, as „Umbenennen“ does in its menu. */
  async function renameTab(tab, title) {
    if (!tab?.renamable || !tab.deckId) return;
    tab.title = title;
    send();
    try {
      const ok = await tab.view.webContents.executeJavaScript(
        `fetch(${deckApi(tab.deckId)}, {
           method: 'PATCH',
           credentials: 'same-origin',
           headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
           body: ${JSON.stringify(JSON.stringify({ title }))},
         }).then((r) => r.ok, () => false)`,
      );
      // The list at home follows when it shows again (its page's visibility changes).
      if (ok) return;
    } catch {
      // between pages
    }
    // Refused or not reachable: the server's name again.
    refreshTitle(tab);
  }

  function addTab(kind, url) {
    const view = newView();
    const tab = {
      id: nextId++,
      kind,
      view,
      url,
      title: kind === 'home' ? homeTitle : (app?.tabTitle ?? 'Präsentation'),
    };
    tabs.push(tab);
    window.contentView.addChildView(view);
    const contents = view.webContents;
    if (kind === 'home') {
      // A presentation picked at home opens as a tab; home stays where it was.
      const onNavigate = (url, loaded) => {
        if (handedOver(contents, url, loaded)) return;
        // Another app's page (a presentation among the files): a tab of this window shows it.
        const guest = guestAt(url);
        if (!deckIdOf(url)) {
          if (!guest) return;
          openFree(url, true);
          return backToList();
        }
        if (app && !loaded && !guest) return openFromHome(url);
        openDeck(url, true);
        backToList();
      };
      contents.on('did-navigate-in-page', (_event, url) => onNavigate(url, false));
      contents.on('did-navigate', (_event, url) => onNavigate(url, true));
    } else {
      tab.deckId = deckIdOf(url);
      // Leaving the presentation (closing it, a link elsewhere): the tab goes, home takes over.
      contents.on('did-navigate-in-page', (_event, next) => {
        // Closed, its page still handing its call on (`closeOnceOut`): nothing of it shows.
        if (!tabs.includes(tab)) return;
        if (handedOver(contents, next)) return;
        const deckId = deckIdOf(next);
        // The tab itself opens another app's page, and is free from there on.
        if (guestAt(next)) tab.free = true;
        // A tab opened with „+“ is one's own to move about in: it shows wherever one goes.
        if (deckId || tab.free) {
          tab.url = next;
          if (deckId !== tab.deckId) {
            tab.deckId = deckId;
            refreshTitle(tab);
          }
          save();
          return;
        }
        closeTab(tab);
        showAtHome(next);
      });
      contents.on('did-finish-load', () => refreshTitle(tab));
      contents.on('page-title-updated', () => refreshTitle(tab));
      // A new page offers its buttons anew. Loaded anew away from the presentation (the account
      // was switched, the session ended): the tab goes, home shows where things are now.
      contents.on('did-navigate', (_event, next) => {
        if (!tabs.includes(tab)) return;
        if (guestAt(next)) tab.free = true;
        if (isOwn(next) && !deckIdOf(next) && !tab.free) return closeTab(tab);
        if (tab.free) {
          tab.url = next;
          tab.deckId = deckIdOf(next);
        }
        tab.bar = null;
        if (tab === active) send();
      });
    }
    // The page's full screen (the slide show) – `layout` gives it the whole window.
    contents.on('enter-html-full-screen', () => {
      tab.fullscreen = true;
      layout();
    });
    contents.on('leave-html-full-screen', () => {
      tab.fullscreen = false;
      layout();
    });
    contents.on('did-finish-load', readTheme);
    // Side by side: a click into the other half makes it the one the bar's picks change.
    contents.on('focus', () => {
      if (tab === beside) select(tab, { focus: false });
    });
    if (url) contents.loadURL(url);
    return tab;
  }

  /**
   * Home after it handed a presentation to a tab: back to where it was – past „Neue
   * Präsentation“ too (its upload is done), to the list.
   */
  function backToList() {
    // In the page, one step after the other: the router has to take each step before the next.
    tabs[0].view.webContents
      .executeJavaScript(
        `(async () => {
           const back = () =>
             new Promise((resolve) => {
               addEventListener('popstate', () => setTimeout(resolve, 50), { once: true });
               history.back();
             });
           if (history.length < 2) return;
           await back();
           if (/\\/neu$/.test(location.pathname) && history.length > 1) await back();
         })()`,
      )
      .catch(() => {});
  }

  /** Home moves to `url` without a reload (the app's router listens to popstate). */
  function showAtHome(url) {
    const home = tabs[0];
    if (!home || !isOwn(url)) return;
    // Another origin (this computer ↔ the server) is a page load, not a step of the router.
    if (new URL(home.view.webContents.getURL()).origin !== new URL(url).origin) {
      home.view.webContents.loadURL(url);
      return;
    }
    const { pathname, search, hash } = new URL(url);
    const target = JSON.stringify(pathname + search + hash);
    home.view.webContents
      .executeJavaScript(
        `if (location.pathname + location.search + location.hash !== ${target}) {
           history.pushState(null, '', ${target});
           dispatchEvent(new PopStateEvent('popstate'));
         }`,
      )
      .catch(() => {});
  }

  /** `follow`: opened by a page – its call comes along (not from the bar or from outside). */
  function openDeck(url, follow = false) {
    const deckId = deckIdOf(url);
    const open = tabs.find((tab) => tab.kind === 'deck' && tab.deckId === deckId);
    select(open ?? addTab('deck', url), { follow });
  }

  /** A tab that is one's own to move about in („+“, a link that asks for a new tab). */
  function openFree(url, follow = false) {
    const tab = addTab('deck', url);
    tab.free = true;
    select(tab, { follow });
  }

  /**
   * Another app's window (Cloud's folders): home has the page already, as a step of its router
   * – it keeps showing it while the tab loads the same page behind it, and the tab takes over
   * once it shows the same. Nothing blank, nothing jumping; home steps back unseen.
   */
  function openFromHome(url) {
    const home = tabs[0];
    const key = deckIdOf(url);
    const open = tabs.find((tab) => tab.kind === 'deck' && tab.deckId === key);
    if (open) {
      select(open, { follow: true });
      return backToList();
    }
    const tab = addTab('deck', url);
    arriving = tab;
    layout();
    send();
    const started = Date.now();
    const settle = () => {
      if (arriving !== tab || window.isDestroyed()) return;
      const contents = tab.view.webContents;
      const same =
        !contents.isLoading() && contents.getTitle() === home.view.webContents.getTitle();
      if (!same && Date.now() - started < 4000) return void setTimeout(settle, 40);
      // One more beat: the page has drawn what its title says.
      setTimeout(() => {
        if (arriving !== tab || window.isDestroyed()) return;
        select(tab, { follow: true });
        backToList();
      }, 120);
    };
    settle();
  }

  function closeTab(tab) {
    // (Its page may still speak while it closes: closed once is enough.)
    if (!tab || tab.kind === 'home' || !tabs.includes(tab)) return;
    if (tab === arriving) arriving = null;
    if (tab === last) last = null;
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);
    window.contentView.removeChildView(tab.view);
    // One of two side by side: the other takes the window.
    const alone = active === tab ? beside : null;
    if (tab === beside || alone) {
      beside = null;
      activeRight = false;
    }
    if (active === tab) select(alone ?? tabs[Math.min(index, tabs.length - 1)]);
    else {
      layout();
      send();
      save();
    }
    // A call its page is in goes to the tab in front first: closed at once, the page would leave
    // the call – and end one it is alone in.
    void (active ? followCall(tab, active, { even: true }) : Promise.resolve(false))
      .catch(() => false)
      .then((handed) => closeOnceOut(tab.view.webContents, handed));
  }

  /** „Nebeneinander“ on or off: the tab that was in front before comes beside this one. */
  function toggleSplit() {
    if (beside) {
      beside = null;
      activeRight = false;
    } else {
      const other =
        (last && last !== active && tabs.includes(last) ? last : null) ??
        tabs[tabs.indexOf(active) + 1] ??
        tabs[tabs.indexOf(active) - 1];
      if (!app?.split || !other) return;
      beside = other;
      activeRight = false;
    }
    layout();
    send();
  }

  /** The app's theme (its own setting, not only the system's): the bar follows it. */
  let savedChoice;
  async function readTheme() {
    const source = active ?? tabs[0];
    if (!source || !origin || !isOwn(source.view.webContents.getURL())) return;
    try {
      const [next, choice] = await source.view.webContents.executeJavaScript(
        `[document.documentElement.dataset.theme, localStorage.getItem('slider.theme')]`,
      );
      if (choice !== savedChoice) {
        savedChoice = choice;
        // The next start opens in it before the page could say (null: the system's).
        writeFile(themeFile, JSON.stringify({ choice: JSON.parse(choice ?? 'null') }), () => {});
      }
      if ((next === 'light' || next === 'dark') && next !== theme) {
        theme = next;
        const color = canvas(theme);
        window.setBackgroundColor(color);
        bar.setBackgroundColor(color);
        for (const tab of tabs) tab.view.setBackgroundColor(color);
        send();
      }
    } catch {
      // between pages
    }
  }
  // The theme can change on the settings page at any moment; a look every second is cheap.
  const themeTimer = setInterval(readTheme, 1000);

  ipcMain.on('tabs:select', (event, id) => {
    if (event.sender !== bar.webContents) return;
    const tab = tabs.find((each) => each.id === id);
    // Home picked again while it shows another side than the tabs do (BER-201): back to it.
    const contents = tab?.view.webContents;
    if (tab?.kind === 'home' && tab === active && origin && !contents.getURL().startsWith(origin)) {
      contents.loadURL(homeUrl());
    }
    select(tab);
  });
  ipcMain.on('tabs:close', (event, id) => {
    if (event.sender === bar.webContents) closeTab(tabs.find((tab) => tab.id === id));
  });
  // A click alone leaves the keys with the page in front (a real mouse, unlike Playwright's).
  ipcMain.on('tabs:typing', (event) => {
    if (event.sender === bar.webContents) bar.webContents.focus();
  });
  ipcMain.on('tabs:rename', (event, id, title) => {
    if (event.sender !== bar.webContents || typeof title !== 'string') return;
    const name = title.trim().slice(0, 200);
    const tab = tabs.find((each) => each.id === id);
    if (name && tab && name !== tab.title) renameTab(tab, name);
  });
  // A presentation's page: what it offers in the tab bar right now (`null`: nothing).
  ipcMain.on(pageBar.channel, (event, offer) => {
    const tab = tabs.find((each) => each.view.webContents === event.sender);
    if (tab?.kind !== 'deck' || !isOwn(event.senderFrame?.url ?? '')) return;
    tab.bar = offer && typeof offer === 'object' ? pageBar.offer(offer) : null;
    if (tab === active) send();
  });
  /** The page does `action` as if clicked there (a user gesture: full screen, a new window). */
  const tell = (contents, action) => {
    contents.focus();
    contents
      .executeJavaScript(
        `dispatchEvent(new CustomEvent(${JSON.stringify(pageBar.event)}, { detail: ${JSON.stringify(action)} }))`,
        true,
      )
      .catch(() => {});
  };
  // A button of the bar: the presentation in front does it as if clicked there – the slide show
  // goes full screen and the presenter view opens its window only within a click.
  ipcMain.on('tabs:deckAction', (event, action) => {
    if (event.sender !== bar.webContents || active?.kind !== 'deck' || !active.bar) return;
    if (!pageBar.actions.includes(action) || !pageBar.allows(action, active.bar)) return;
    tell(active.view.webContents, action);
  });
  ipcMain.on('tabs:new', (event) => {
    if (event.sender !== bar.webContents || !app?.newTab || !origin) return;
    openFree(homeUrl());
  });
  /** A new tab on a page of the server's – or, where that page is another app's, over there. */
  const openAt = (at) => {
    if (!origin || !app?.newTab) return;
    const url = origin + at;
    if (elsewhere?.(url)) return;
    openFree(url);
  };
  // The arrow beside „+“: a menu of the system's, under the button.
  ipcMain.on('tabs:newMenu', (event, x, y) => {
    if (event.sender !== bar.webContents || !app?.newTab || !app.newTabs || !origin) return;
    Menu.buildFromTemplate(
      app.newTabs().map((each) => ({ label: each.label, click: () => openAt(each.path) })),
    ).popup({ window, x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) });
  });
  ipcMain.on('tabs:split', (event) => {
    if (event.sender === bar.webContents) toggleSplit();
  });
  // Files dragged out of a page onto a tab (`app.split`): its page takes them where it is
  // (`TAB_DROP_EVENT` in apps/web/src/features/cloud/lib/drag.ts).
  ipcMain.on('tabs:drop', (event, id, carried) => {
    if (event.sender !== bar.webContents || !app?.split) return;
    const tab = tabs.find((each) => each.id === id);
    if (!tab || typeof carried !== 'string' || carried.length > 50_000) return;
    if (!isOwn(tab.view.webContents.getURL())) return;
    tab.view.webContents
      .executeJavaScript(
        `dispatchEvent(new CustomEvent('cloud:drop', { detail: ${JSON.stringify(carried)} }))`,
      )
      .catch(() => {});
  });
  window.on('resize', layout);
  window.on('enter-full-screen', send);
  window.on('leave-full-screen', send);
  bar.webContents.on('did-finish-load', send);
  window.on('close', (event) => {
    // Called off by the app (Sender hides its window instead): nothing closes.
    if (!event.defaultPrevented) closing = true;
  });
  window.on('closed', () => {
    clearInterval(themeTimer);
    ipcMain.removeAllListeners('tabs:select');
    ipcMain.removeAllListeners('tabs:close');
    ipcMain.removeAllListeners('tabs:rename');
    ipcMain.removeAllListeners('tabs:typing');
    ipcMain.removeAllListeners(pageBar.channel);
    ipcMain.removeAllListeners('tabs:deckAction');
    ipcMain.removeAllListeners('tabs:split');
    ipcMain.removeAllListeners('tabs:new');
    ipcMain.removeAllListeners('tabs:newMenu');
    ipcMain.removeAllListeners('tabs:drop');
    // A BaseWindow leaves its views' pages running: they go with it.
    for (const contents of [bar.webContents, ...tabs.map((tab) => tab.view.webContents)]) {
      if (!contents.isDestroyed()) contents.close();
    }
  });

  window.contentView.addChildView(seam);
  // Home first; it shows the start screen until the service is up.
  const home = addTab('home', null);
  select(home, { focus: false });

  return {
    window,
    /** A new tab on that page of the server's (the menu's „Neuer Tab mit …“). */
    openAt,
    /** The pages there now are looked at anew: what is another app's goes over there (`elsewhere`). */
    sortOut() {
      for (const tab of [...tabs]) {
        if (tab.kind === 'home') continue;
        const url = tab.view.webContents.getURL();
        if (origin && isOwn(url) && elsewhere?.(url)) closeTab(tab);
      }
    },
    /** The home tab's page (the start screen while Slider starts). */
    home: home.view.webContents,
    /**
     * The service is up: home shows Slider, the tabs of last time come back. `url`: the side the
     * tabs show (online the server's, BER-201); `move` brings a saved tab's address there.
     */
    async start(url, move = (each) => each) {
      origin = url;
      await home.view.webContents.loadURL(homeUrl());
      let saved = null;
      try {
        if (existsSync(stateFile)) saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      } catch {
        saved = null;
      }
      for (const kept of saved?.decks ?? []) {
        // Kept at the hosted Slider's old address: at its new one (hosted.mjs).
        const deck = movedUrl(kept);
        // Nothing to move to (made offline, not up yet): it stays where it was.
        const there = move(deck) ?? deck;
        if (deckIdOf(there)) addTab('deck', there);
      }
      select(tabs[saved?.active] ?? home);
    },
    /**
     * Online ↔ offline (BER-201): every tab moves to the side at `url`, its address by `move`.
     * Nothing to move to: home goes to the start, a presentation tab stays where it is – or,
     * `dropUnknown` (signed out), closes.
     */
    moveTo(url, move, { dropUnknown = false } = {}) {
      origin = url;
      for (const tab of [...tabs]) {
        const contents = tab.view.webContents;
        const now = contents.getURL();
        if (!now || now.startsWith(url)) continue;
        const there = move(now);
        if (there) {
          tab.url = there;
          if (tab.kind === 'deck') tab.deckId = deckIdOf(there);
          contents.loadURL(there);
        } else if (tab.kind === 'home') contents.loadURL(url);
        else if (dropUnknown) closeTab(tab);
      }
      send();
      save();
    },
    /**
     * ⌘[: a page back – only off a page that is not Slider's (a login provider's, signing in
     * another account), where nothing of Slider's leads back.
     */
    back() {
      const contents = active?.view.webContents;
      if (!contents || isOwn(contents.getURL())) return;
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      else if (origin) contents.loadURL(origin);
    },
    /** Signed out (Cloud): the tabs go, home is the start screen's again. */
    reset() {
      origin = null;
      for (const tab of [...tabs]) closeTab(tab);
      try {
        writeFileSync(stateFile, JSON.stringify({ decks: [], active: 0 }));
      } catch {
        // The tabs of last time then fail to open – they close by themselves.
      }
    },
    /** ⌘W: closes the presentation tab; on home, the window. */
    closeActive() {
      if (active?.kind === 'deck') closeTab(active);
      else window.close();
    },
    /** ⌘1 … ⌘9 (⌘9: the last tab, as in browsers). */
    selectIndex(index) {
      select(index === 8 ? tabs.at(-1) : tabs[index]);
    },
    /** ⌃Tab / ⌃⇧Tab. */
    step(direction) {
      const index = tabs.indexOf(active);
      select(tabs[(index + direction + tabs.length) % tabs.length]);
    },
    /** A page of this app, from outside (a link, the other app): in its tab, or at home. */
    show(url) {
      if (!origin || !isOwn(url)) return;
      if (deckIdOf(url)) return openDeck(url);
      showAtHome(url);
      select(tabs[0]);
    },
    /** A presentation as a tab (or its tab picked). */
    openDeck(url) {
      openDeck(url);
    },
    /** The presentation of the tab in front, if it is one. */
    activeDeckId() {
      return active?.kind === 'deck'
        ? (active.deckId ?? deckIdOf(active.view.webContents.getURL()))
        : null;
    },
    /**
     * The app's menu (Writer's „Neues Dokument“): the page in front – home or a tab – does
     * `action` as a button of the bar would. `false`: no page of the app's is in front.
     */
    pageAction(action) {
      const contents = active?.view.webContents;
      if (!origin || !contents || !isOwn(contents.getURL())) return false;
      tell(contents, action);
      return true;
    },
    /** Every tab's page, home first. */
    contents() {
      return tabs.map((tab) => tab.view.webContents);
    },
  };
}
