import { matchPath, useLocation, useNavigate } from 'react-router';
import { routes } from './routes';

/** The apps of one account that are there to open. */
export type AppId = 'slider' | 'cloud' | 'writer' | 'reader' | 'sender';

const KEY = 'slider.app';
/** Pages that belong to no app – the account, its settings, usage, the instance, its setup, an invitation: they keep the app one came from. */
const NEUTRAL = [
  '/w/:workspaceId/einstellungen/*',
  '/nutzung',
  '/instanz',
  '/konto',
  '/einstellungen',
  '/verbinden',
  '/desktop-anmelden',
  '/einrichtung',
  '/join/:token',
];

/** Where an installed Cloud starts: on to the files of the workspace last open. */
export const CLOUD_START = '/cloud';
/** Its address before it was called Cloud – still leads there (`router.tsx`). */
const OLD_START = '/office';

/** Where an installed Writer starts: on to the documents of the workspace last open. */
export const WRITER_START = '/writer';

/** Where an installed Reader starts: on to the PDFs of the workspace last open. */
export const READER_START = '/reader';

/** Where an installed Sender starts: on to the messages of the workspace last open. */
export const SENDER_START = '/sender';

const isApp = (value: string | null): value is AppId =>
  value === 'cloud' ||
  value === 'writer' ||
  value === 'reader' ||
  value === 'sender' ||
  value === 'slider';

/** The app a page is part of; `null` on the pages between the apps. */
export function appOfPath(pathname: string): AppId | null {
  if (
    pathname === WRITER_START ||
    matchPath('/w/:workspaceId/dokumente/*', pathname) ||
    matchPath('/t/:documentId', pathname)
  )
    return 'writer';
  if (pathname === SENDER_START || matchPath('/w/:workspaceId/nachrichten/*', pathname))
    return 'sender';
  if (
    pathname === READER_START ||
    matchPath('/w/:workspaceId/pdfs/*', pathname) ||
    matchPath('/r/:pdfId', pathname)
  )
    return 'reader';
  if (
    pathname === CLOUD_START ||
    pathname === OLD_START ||
    matchPath('/w/:workspaceId/dateien/*', pathname)
  )
    return 'cloud';
  return NEUTRAL.some((pattern) => matchPath(pattern, pathname)) ? null : 'slider';
}

export function rememberApp(app: AppId): void {
  try {
    sessionStorage.setItem(KEY, app);
  } catch {
    // No storage (private mode): the pages between the apps fall back to Cloud, the start page.
  }
}

/** The app last open in this tab – `null` when none was (a page between the apps opened first). */
function keptApp(): AppId | null {
  try {
    const kept = sessionStorage.getItem(KEY);
    return isApp(kept) ? kept : null;
  } catch {
    return null;
  }
}
// None open yet: Cloud, where the start page (`/`) leads – as the way back there.
const lastApp = (): AppId => keptApp() ?? 'cloud';

const INSTALLED_KEY = 'slider.installed';

/**
 * Installed (a window of its own, from the Dock or the home screen) or in the desktop app, this
 * window is one app: the one it was started as – Cloud from `/cloud`, else Slider – kept for
 * the window's life. There is no way across to the other app there (no app switcher): each app
 * is installed by itself. A page of the other app reached anyway opens outside – a window of
 * its own (`windowForApp`), from the desktop app in the browser (`inBrowser` in desktop/).
 * In a browser tab `null`: there one moves between the apps freely – and so in Cloud's desktop
 * app, whose window shows every app's pages in its tabs (`cloudDesktop.tabs`, `guest` in
 * desktop/cloud/main.mjs): home gives the other app a tab, a tab goes there itself.
 */
export const installedApp: AppId | null = (() => {
  try {
    if (window.cloudDesktop?.tabs === true) return null;
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as { standalone?: boolean }).standalone === true ||
      /\bElectron\//.test(navigator.userAgent);
    if (!standalone) return null;
    // The page it loads with says which app the window is (a window opened for the other app
    // starts on that app's page); on a page between the apps, what the window was before.
    const kept = sessionStorage.getItem(INSTALLED_KEY);
    const app = appOfPath(window.location.pathname) ?? (isApp(kept) ? kept : 'slider');
    sessionStorage.setItem(INSTALLED_KEY, app);
    return app;
  } catch {
    return null;
  }
})();

/**
 * Installed: a window for the other app's page, opened now (inside the click) and sent on once
 * the address is known. In a browser tab `null` – the caller navigates as ever.
 */
export function windowForApp(app: AppId): { go: (to: string) => void; close: () => void } | null {
  if (!installedApp || installedApp === app) return null;
  const opened = window.open('', '_blank');
  if (!opened) return null;
  return { go: (to) => opened.location.replace(to), close: () => opened.close() };
}

/**
 * Each app installs by itself: the page names the manifest (name, icon, start) of the app one is
 * in, so „Installieren“ in Cloud installs Cloud.
 */
export function showAppManifest(app: AppId): void {
  const href =
    app === 'reader'
      ? '/reader.webmanifest'
      : app === 'cloud'
        ? '/cloud.webmanifest'
        : app === 'writer'
          ? '/writer.webmanifest'
          : app === 'sender'
            ? '/sender.webmanifest'
            : '/manifest.webmanifest';
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link && link.getAttribute('href') !== href) link.setAttribute('href', href);
  showAppIcon(app);
}

/** The browser tab wears the app's icon; Slider's are the ones the page came with. */
let sliderIcons: { rel: string; href: string; type: string | null; sizes: string | null }[] | null =
  null;
function showAppIcon(app: AppId): void {
  const icons = [
    ...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]'),
  ];
  sliderIcons ??= icons.map((icon) => ({
    rel: icon.rel,
    href: icon.getAttribute('href') ?? '',
    type: icon.getAttribute('type'),
    sizes: icon.getAttribute('sizes'),
  }));
  icons.forEach((icon, at) => {
    const own = sliderIcons?.[at];
    if (!own) return;
    // The tab: the mark on nothing. The installed app's icon is the mark on its tile.
    const touch = own.rel === 'apple-touch-icon';
    const href =
      app === 'reader'
        ? touch
          ? '/reader-icon-192.png?v=4'
          : '/reader-favicon.svg'
        : app === 'cloud'
          ? touch
            ? '/cloud-icon-192.png?v=5'
            : '/cloud-favicon.svg'
          : app === 'writer'
            ? touch
              ? '/writer-icon-192.png?v=4'
              : '/writer-favicon.svg'
            : app === 'sender'
              ? touch
                ? '/sender-icon-192.png?v=2'
                : '/sender-favicon.svg'
              : own.href;
    if (icon.getAttribute('href') === href) return;
    const slider = app === 'slider';
    const type = slider ? own.type : touch ? 'image/png' : 'image/svg+xml';
    // A new element, not a changed address: Safari (and others now and then) keep the tab's icon
    // when only `href` changes – a link put in anew is read anew.
    const fresh = document.createElement('link');
    fresh.rel = own.rel;
    if (type) fresh.type = type;
    // The 32 px size belongs to Slider's .ico; on an SVG it would only mislead the pick.
    if (slider && own.sizes) fresh.setAttribute('sizes', own.sizes);
    fresh.href = href;
    icon.replaceWith(fresh);
  });
}

/** The app of this page (`null` between the apps). */
export const usePageApp = (): AppId | null => appOfPath(useLocation().pathname);

/** The app one is in: the page's, or – on settings, usage and the like – the one last open. */
export const useCurrentApp = (): AppId => usePageApp() ?? installedApp ?? lastApp();

/**
 * The app a way back leads to: the page's, or the one last open – `null` when none is known (a
 * page between the apps opened first): then it leads to the start page, not to one app.
 */
export const useBackApp = (): AppId | null => usePageApp() ?? installedApp ?? keptApp();

/**
 * Where an app starts (in the workspace last open) and what a link there is called – a page that
 * opens nothing (not found, blocked, an invitation that failed) leads there; `null`: the start page.
 */
export const appStart = (app: AppId | null): { to: string; label: string } =>
  app === 'cloud'
    ? { to: CLOUD_START, label: 'Zu den Dateien' }
    : app === 'reader'
      ? { to: READER_START, label: 'Zu den PDFs' }
      : app === 'writer'
        ? { to: WRITER_START, label: 'Zu den Dokumenten' }
        : app === 'sender'
          ? { to: SENDER_START, label: 'Zu den Nachrichten' }
          : app === 'slider'
            ? { to: routes.reviews(), label: 'Zu den Präsentationen' }
            : { to: routes.home(), label: 'Zur Startseite' };

/** An app's start in a workspace, and what the way back to it is called; `null`: the start page. */
export const appHome = (app: AppId | null, workspaceId: string | null | undefined) =>
  app === null
    ? { to: routes.home(), label: 'Zurück zur Startseite' }
    : app === 'cloud' && workspaceId
      ? { to: routes.cloud(workspaceId), label: 'Zurück zu den Dateien' }
      : app === 'reader'
        ? {
            to: workspaceId ? routes.pdfs(workspaceId) : routes.readerStart(),
            label: 'Zurück zu den PDFs',
          }
        : app === 'writer'
          ? {
              to: workspaceId ? routes.documents(workspaceId) : routes.writerStart(),
              label: 'Zurück zu den Dokumenten',
            }
          : app === 'sender'
            ? {
                to: workspaceId ? routes.messages(workspaceId) : routes.senderStart(),
                label: 'Zurück zu den Nachrichten',
              }
            : { to: workspaceId ? routes.workspace(workspaceId) : routes.reviews() };

/** The tabs of the pages that speak for every app: all of it, or one app's part. */
/** Writer has no part of its own: its documents are files, counted with Cloud's. */
export type AppScope = 'all' | 'slider' | 'cloud';
export const APP_SCOPES = [
  { value: 'all', label: 'Gesamt' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'slider', label: 'Slider' },
] as const satisfies readonly { value: AppScope; label: string }[];
export const appScopeOf = (value: string | null): AppScope =>
  value === 'cloud' || value === 'slider' ? value : 'all';

/**
 * The „Bibliothek“ is one set of pages in all three apps (fonts, colours, icons, words serve every
 * app; templates are Slider's, seen in both): its addresses in the app one is in, and the name
 * that app's pages carry in the tab title.
 */
export function useLibrary() {
  const page = usePageApp();
  const cloud = page === 'cloud';
  if (cloud) {
    return {
      cloud,
      app: 'cloud',
      appName: 'Cloud',
      home: routes.cloudLibrary,
      create: routes.cloudLibraryNew,
      master: routes.cloudLibraryMaster,
    } as const;
  }
  if (page === 'writer') {
    return {
      cloud,
      app: 'writer',
      appName: 'Writer',
      home: routes.writerLibrary,
      create: routes.writerLibraryNew,
      master: routes.writerLibraryMaster,
    } as const;
  }
  return {
    cloud,
    app: 'slider',
    appName: 'Slider',
    home: routes.workspaceMaterial,
    create: routes.newMaterial,
    master: routes.workspaceMaster,
  } as const;
}

/**
 * The way to a page of Slider's from wherever one is (a template opened in the editor from
 * Cloud's library): call it inside the click – installed, Cloud stays Cloud and Slider gets
 * a window of its own, which a popup blocker allows only then – and `go` once the address is
 * known, `close` when it never will be.
 */
export function useSliderDoor() {
  const navigate = useNavigate();
  return () => {
    const opened = windowForApp('slider');
    return {
      go: (to: string) => (opened ? opened.go(to) : void navigate(to)),
      close: () => opened?.close(),
    };
  };
}
