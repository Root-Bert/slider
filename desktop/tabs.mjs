// One window, Slider's own tab bar on top (no macOS title bar), a tab per open presentation
// below it – like Figma's desktop app. The first tab, „Präsentationen“, is the app's home and
// stays; a presentation picked there opens in a tab of its own (or the one it has), and when a
// presentation tab leaves its presentation („Präsentation schließen“) the tab closes and home
// shows where it went. Every tab is the web app in a view of its own, all on one origin – one
// outbox, one service worker, as in browser tabs.
import { BaseWindow, WebContentsView, ipcMain } from 'electron';
import { existsSync, readFileSync, writeFile, writeFileSync } from 'node:fs';
import path from 'node:path';

const BAR_HEIGHT = 40;
const HOME_TITLE = 'Präsentationen';
/** The tab bar's buttons for the presentation in front (`slider:desktop-bar` in the page). */
const DECK_ACTIONS = ['present', 'presenter', 'share', 'close'];
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
 */
export function createTabWindow({
  here,
  stateFile,
  themeFile,
  theme: startTheme,
  isOwn,
  openExternal,
}) {
  // A BaseWindow with the bar as a view of its own, only 40 px high: a BrowserWindow's own page
  // spans the whole window, and on macOS it – with its drag region – took the real mouse clicks
  // meant for the tab views laid over it (views are siblings there since Electron 30).
  const window = new BaseWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Slider',
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
  window.contentView.addChildView(bar);
  bar.webContents.loadFile(path.join(here, 'tabbar', 'index.html'), {
    query: { theme: startTheme, platform: process.platform },
  });
  bar.webContents.once('did-finish-load', () => window.show());

  /**
   * `bar`: what the presentation offers in the tab bar (Präsentieren, Referentenansicht,
   * Exportieren, ✕), as its page reported it; `fullscreen`: the page is presenting in full screen.
   * @type {{ id: number, kind: 'home' | 'deck', view: WebContentsView, title: string, deckId?: string, renamable?: boolean, bar?: { share: boolean, shareOpen: boolean, template: boolean } | null, fullscreen?: boolean }[]}
   */
  const tabs = [];
  let active = null;
  let theme = startTheme;
  let origin = null;
  let nextId = 1;
  let closing = false;

  // A presentation on this computer or on the Slider server signed in to (BER-201). Only an id
  // as Slider makes them (a UUID): it goes into scripts run in the page.
  const deckIdOf = (url) => {
    if (!origin || !isOwn(url)) return null;
    return new URL(url).pathname.match(/^\/d\/([A-Za-z0-9-]{1,100})(?:\/|$)/)?.[1] ?? null;
  };
  const deckApi = (deckId) => JSON.stringify(`/api/decks/${encodeURIComponent(deckId)}`);

  function newView() {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
        // `window.sliderDesktop`: files on this computer (BER-201), answered for Slider's own pages only.
        preload: path.join(here, 'page-preload.cjs'),
      },
    });
    view.setBackgroundColor(canvas(theme));
    const contents = view.webContents;
    // Links out of Slider open in the default browser; Slider's own new windows (presenting) stay.
    contents.setWindowOpenHandler(({ url }) => {
      if (isOwn(url)) return { action: 'allow' };
      openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (isOwn(url) || url.startsWith('file:')) return;
      event.preventDefault();
      openExternal(url);
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
      active: active?.id ?? null,
      deck: active?.kind === 'deck' ? (active.bar ?? null) : null,
      theme,
      fullscreen: window.isFullScreen(),
    });
  };

  const save = () => {
    // Not before start() – the tabs of last time are read there – nor while the window closes.
    if (!origin || closing) return;
    const decks = tabs.filter((tab) => tab.kind === 'deck').map((tab) => tab.url);
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
    for (const tab of tabs) {
      const shown = tab === active;
      tab.view.setVisible(shown);
      if (shown) tab.view.setBounds({ x: 0, y: top, width, height: height - top });
    }
  }

  function select(tab, { focus = true } = {}) {
    if (!tab) return;
    active = tab;
    layout();
    if (focus) tab.view.webContents.focus();
    send();
    save();
    if (tab.kind === 'deck') refreshTitle(tab);
  }

  async function refreshTitle(tab) {
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
      title: kind === 'home' ? HOME_TITLE : 'Präsentation',
    };
    tabs.push(tab);
    window.contentView.addChildView(view);
    const contents = view.webContents;
    if (kind === 'home') {
      // A presentation picked at home opens as a tab; home stays where it was.
      const onNavigate = (_event, url) => {
        if (!deckIdOf(url)) return;
        openDeck(url);
        backToList();
      };
      contents.on('did-navigate-in-page', onNavigate);
      contents.on('did-navigate', onNavigate);
    } else {
      tab.deckId = deckIdOf(url);
      // Leaving the presentation (closing it, a link elsewhere): the tab goes, home takes over.
      contents.on('did-navigate-in-page', (_event, next) => {
        const deckId = deckIdOf(next);
        if (deckId) {
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
      // A new page offers its buttons anew.
      contents.on('did-navigate', () => {
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

  function openDeck(url) {
    const deckId = deckIdOf(url);
    const open = tabs.find((tab) => tab.kind === 'deck' && tab.deckId === deckId);
    select(open ?? addTab('deck', url));
  }

  function closeTab(tab) {
    if (!tab || tab.kind === 'home') return;
    const index = tabs.indexOf(tab);
    tabs.splice(index, 1);
    window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    if (active === tab) select(tabs[Math.min(index, tabs.length - 1)]);
    else {
      send();
      save();
    }
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
      contents.loadURL(origin);
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
  ipcMain.on('tabs:deckBar', (event, offer) => {
    const tab = tabs.find((each) => each.view.webContents === event.sender);
    if (tab?.kind !== 'deck' || !isOwn(event.senderFrame?.url ?? '')) return;
    tab.bar =
      offer && typeof offer === 'object'
        ? {
            share: offer.share === true,
            shareOpen: offer.shareOpen === true,
            template: offer.template === true,
          }
        : null;
    if (tab === active) send();
  });
  // A button of the bar: the presentation in front does it as if clicked there – the slide show
  // goes full screen and the presenter view opens its window only within a click.
  ipcMain.on('tabs:deckAction', (event, action) => {
    if (event.sender !== bar.webContents || active?.kind !== 'deck' || !active.bar) return;
    if (!DECK_ACTIONS.includes(action) || (action === 'share' && !active.bar.share)) return;
    const contents = active.view.webContents;
    contents.focus();
    contents
      .executeJavaScript(
        `dispatchEvent(new CustomEvent('slider:desktop-bar', { detail: ${JSON.stringify(action)} }))`,
        true,
      )
      .catch(() => {});
  });
  window.on('resize', layout);
  window.on('enter-full-screen', send);
  window.on('leave-full-screen', send);
  bar.webContents.on('did-finish-load', send);
  window.on('close', () => {
    closing = true;
  });
  window.on('closed', () => {
    clearInterval(themeTimer);
    ipcMain.removeAllListeners('tabs:select');
    ipcMain.removeAllListeners('tabs:close');
    ipcMain.removeAllListeners('tabs:rename');
    ipcMain.removeAllListeners('tabs:typing');
    ipcMain.removeAllListeners('tabs:deckBar');
    ipcMain.removeAllListeners('tabs:deckAction');
    // A BaseWindow leaves its views' pages running: they go with it.
    for (const contents of [bar.webContents, ...tabs.map((tab) => tab.view.webContents)]) {
      if (!contents.isDestroyed()) contents.close();
    }
  });

  // Home first; it shows the start screen until the service is up.
  const home = addTab('home', null);
  select(home, { focus: false });

  return {
    window,
    /** The home tab's page (the start screen while Slider starts). */
    home: home.view.webContents,
    /**
     * The service is up: home shows Slider, the tabs of last time come back. `url`: the side the
     * tabs show (online the server's, BER-201); `move` brings a saved tab's address there.
     */
    async start(url, move = (each) => each) {
      origin = url;
      await home.view.webContents.loadURL(url);
      let saved = null;
      try {
        if (existsSync(stateFile)) saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      } catch {
        saved = null;
      }
      for (const deck of saved?.decks ?? []) {
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
    /** Every tab's page, home first. */
    contents() {
      return tabs.map((tab) => tab.view.webContents);
    },
  };
}
