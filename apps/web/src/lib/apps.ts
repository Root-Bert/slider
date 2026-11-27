import { matchPath, useLocation, useNavigate } from 'react-router';
import { handOverName } from './call-handover';
import { routes } from './routes';

/** The apps of one account that are there to open. */
export type AppId = 'slider' | 'cloud' | 'writer' | 'reader' | 'sender';

/** Each app's name – the end of its pages' tab titles („Anmelden | Cloud“). */
export const APP_NAMES: Record<AppId, string> = {
  slider: 'Slider',
  cloud: 'Cloud',
  writer: 'Writer',
  reader: 'Reader',
  sender: 'Sender',
};

const KEY = 'slider.app';
/**
 * Pages that belong to no app – the start page, signing in, the account, its settings, usage, the
 * instance, its setup, an invitation, the legal pages: they keep the app one came from (or wear
 * the one they lead to, `appOfTarget`).
 */
const NEUTRAL = [
  '/',
  '/login',
  '/registrieren',
  '/anmelden/:token',
  '/konto-bestaetigen/:token',
  '/datenschutz',
  '/impressum',
  '/datenanfrage',
  '/daten/:token',
  '/w/:workspaceId/einstellungen/*',
  '/nutzung',
  '/instanz',
  '/konto',
  '/einstellungen',
  '/verbinden',
  '/desktop-anmelden',
  '/einrichtung',
  '/join/:token',
  // „Neue Präsentation“: from Cloud's „Neu“ as from Slider – it stays in the app it came from.
  '/neu',
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
    matchPath(WRITER_START, pathname) ||
    matchPath('/w/:workspaceId/dokumente/*', pathname) ||
    matchPath('/t/:documentId', pathname)
  )
    return 'writer';
  if (matchPath(SENDER_START, pathname) || matchPath('/w/:workspaceId/nachrichten/*', pathname))
    return 'sender';
  if (
    matchPath(READER_START, pathname) ||
    matchPath('/w/:workspaceId/pdfs/*', pathname) ||
    matchPath('/r/:pdfId', pathname)
  )
    return 'reader';
  if (
    // `matchPath`: with a slash at the end too (`/cloud/`, as the router takes it).
    matchPath(CLOUD_START, pathname) ||
    matchPath(OLD_START, pathname) ||
    matchPath('/w/:workspaceId/dateien/*', pathname) ||
    // A diagram: drawn on in Cloud.
    matchPath('/diagramm/:diagramId', pathname) ||
    // What a link of Cloud's shows to someone outside.
    matchPath('/s/:token', pathname)
  )
    return 'cloud';
  return NEUTRAL.some((pattern) => matchPath(pattern, pathname)) ? null : 'slider';
}

/** The app an address leads to (a `returnTo`, query and hash left off); `null` between the apps. */
export const appOfTarget = (to: string): AppId | null => appOfPath(to.split(/[?#]/)[0] ?? to);

/** The app the login's `returnTo` in this address leads to – a window started on the login. */
function appOfReturnTo(search: string): AppId | null {
  const returnTo = new URLSearchParams(search).get('returnTo');
  return returnTo?.startsWith('/') ? appOfTarget(returnTo) : null;
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
    // starts on that app's page); on a page between the apps, what the window was before – else
    // where the login leads, else Cloud, the start page's.
    const kept = sessionStorage.getItem(INSTALLED_KEY);
    const app =
      appOfPath(window.location.pathname) ??
      (isApp(kept) ? kept : null) ??
      appOfReturnTo(window.location.search) ??
      'cloud';
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
  // An app's window, not a popup of this one: it rings and calls itself (`CallProvider` skips
  // windows with an opener) and takes over the call this one is in.
  opened.opener = null;
  opened.name = handOverName();
  return { go: (to) => opened.location.replace(to), close: () => opened.close() };
}

/**
 * Each app's files in `public/`: the manifest it installs by, the tab's icon (the mark on nothing)
 * and the installed app's (the mark on its tile). `index.html` names Cloud's – the start page's
 * app, worn until the page says otherwise. After new pictures bump `?v=` here and in `index.html`.
 */
const APP_FILES: Record<AppId, { manifest: string; tab: string; tile: string }> = {
  slider: {
    manifest: '/manifest.webmanifest',
    tab: '/favicon.svg?v=8',
    tile: '/apple-touch-icon.png?v=13',
  },
  cloud: {
    manifest: '/cloud.webmanifest',
    tab: '/cloud-favicon.svg',
    tile: '/cloud-touch-icon.png?v=1',
  },
  writer: {
    manifest: '/writer.webmanifest',
    tab: '/writer-favicon.svg',
    tile: '/writer-touch-icon.png?v=1',
  },
  reader: {
    manifest: '/reader.webmanifest',
    tab: '/reader-favicon.svg',
    tile: '/reader-touch-icon.png?v=1',
  },
  sender: {
    manifest: '/sender.webmanifest',
    tab: '/sender-favicon.svg',
    tile: '/sender-touch-icon.png?v=1',
  },
};

/**
 * Each app installs by itself: the page names the manifest (name, icon, start) of the app one is
 * in, so „Installieren“ in Cloud installs Cloud – and the tab wears that app's icon.
 */
export function showAppManifest(app: AppId): void {
  const files = APP_FILES[app];
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (link && link.getAttribute('href') !== files.manifest)
    link.setAttribute('href', files.manifest);
  for (const icon of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="apple-touch-icon"]',
  )) {
    const touch = icon.rel === 'apple-touch-icon';
    const href = touch ? files.tile : files.tab;
    if (icon.getAttribute('href') === href) continue;
    // A new element, not a changed address: Safari (and others now and then) keep the tab's icon
    // when only `href` changes – a link put in anew is read anew.
    const fresh = document.createElement('link');
    fresh.rel = icon.rel;
    fresh.type = touch ? 'image/png' : 'image/svg+xml';
    fresh.href = href;
    icon.replaceWith(fresh);
  }
}

/** The tab's title for the app: a page's „… | Slider“ ends in the app's name instead. */
export const appTitle = (docTitle: string, app: AppId): string =>
  docTitle.replace(/\| Slider$/, `| ${APP_NAMES[app]}`);

/** The app of this page (`null` between the apps). */
export const usePageApp = (): AppId | null => appOfPath(useLocation().pathname);

/** On a page between the apps (or one that does not exist): the app last open, else Cloud. */
export const appBetween = (): AppId => installedApp ?? lastApp();

/** The app one is in: the page's, or – on settings, usage and the like – the one last open. */
export const useCurrentApp = (): AppId => usePageApp() ?? appBetween();

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
    : app === 'cloud'
      ? // Without a workspace Cloud's start page, never Slider's.
        {
          to: workspaceId ? routes.cloud(workspaceId) : routes.home(),
          label: 'Zurück zu den Dateien',
        }
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
            : {
                to: workspaceId ? routes.workspace(workspaceId) : routes.reviews(),
                label: 'Zurück zu den Präsentationen',
              };

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
