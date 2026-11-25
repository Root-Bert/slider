import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, matchPath, useLocation } from 'react-router';
import { routes } from '@/lib/routes';
import { rememberApp, showAppManifest, useCurrentApp, usePageApp } from '@/lib/apps';
import {
  AppSwitcher,
  CloudChatButton,
  DateButton,
  MeetingNotice,
  CloudLogo,
  SenderLogo,
  ReaderLogo,
  WriterLogo,
} from '@/features/cloud';
import { HomeChatButton } from '@/features/reviews';
import { NotifyOffer } from '@/features/sender';
import {
  AccountMenu,
  OnlineMembers,
  useActiveWorkspace,
  WorkspaceSwitcher,
} from '@/features/workspaces';
import { cn, Logo, LOGO_ANIMATIONS, ToolbarDivider, type LogoAnimation } from '@/ui';

interface AppHeaderProps {
  /** Next to the workspace switcher, e.g. the page's primary action. */
  leading?: ReactNode;
  /** Centred on the page, independent of how wide the two sides are. */
  center?: ReactNode;
  actions?: ReactNode;
  /** Where the logo leads; the reviews by default. */
  logoLink?: { to: string; label: string };
}

/**
 * Top bar of the member area (G1, A1, A3): logo, workspace switcher and its AI left, page actions
 * right, who else of the workspace is online next to the avatar, account menu behind it.
 */
export function AppHeader({
  leading,
  center,
  actions,
  logoLink = { to: routes.reviews(), label: 'Slider – Präsentationen' },
}: AppHeaderProps) {
  const location = useLocation();
  // The same header for every app of the account: in Cloud the logo is Cloud's and leads to
  // its start; the chevron beside it switches between the apps.
  const app = useCurrentApp();
  // Settings, usage and the like keep the app one came from: remembered while in one.
  const pageApp = usePageApp();
  useEffect(() => {
    if (pageApp) rememberApp(pageApp);
  }, [pageApp]);
  useEffect(() => showAppManifest(app), [app]);
  const workspace = useActiveWorkspace();
  // `run` remounts the logo, so a click mid-animation starts the next one from scratch.
  const [logoAnimation, setLogoAnimation] = useState<{ name?: LogoAnimation; run: number }>({
    run: 0,
  });
  const lastLogoAnimation = useRef<LogoAnimation>(undefined);

  // Already where the logo leads – home: `/` itself, the workspace overview it redirects to, or its other
  // view, the Bibliothek (whatever its `?filter=`): don't reload the page (it flickers), let the logo do a
  // little trick instead – a different one each time.
  const toReviews = logoLink.to === routes.reviews();
  const atLibrary =
    toReviews && !!matchPath(routes.workspaceMaterial(':workspaceId'), location.pathname);
  const atHome =
    atLibrary ||
    ((location.pathname === logoLink.to ||
      (toReviews && !!matchPath(routes.workspace(':workspaceId'), location.pathname))) &&
      !location.search);
  const atCloudHome =
    app === 'cloud' && !!workspace && location.pathname === routes.cloud(workspace.id);
  const atWriterHome =
    app === 'writer' && !!workspace && location.pathname === routes.documents(workspace.id);
  const atReaderHome =
    app === 'reader' && !!workspace && location.pathname === routes.pdfs(workspace.id);
  // Sender's side bar is always beside its conversations: the logo has nowhere else to lead.
  const inSender = app === 'sender' && !!workspace;
  // ✨ where the files are (`CloudLayout` holds the chat) – and in Sender (`SenderLayout`).
  const inCloud =
    app === 'cloud' && !!workspace && location.pathname.startsWith(routes.cloud(workspace.id));
  // ✨ on Slider's start, beside the presentations (`ReviewsPage` holds the chat).
  const atSliderStart =
    app === 'slider' && !!workspace && location.pathname === routes.workspace(workspace.id);
  // At an app's start the logo has nowhere to lead: it opens the app menu instead, one button
  // with the chevron – like the workspace switcher beside it.
  const logoSwitches =
    !!workspace &&
    (app === 'cloud'
      ? atCloudHome
      : app === 'writer'
        ? atWriterHome
        : app === 'reader'
          ? atReaderHome
          : app === 'sender'
            ? inSender
            : atHome);
  function onLogoClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!atHome) return;
    event.preventDefault();
    const others = LOGO_ANIMATIONS.filter((name) => name !== lastLogoAnimation.current);
    const name = others[Math.floor(Math.random() * others.length)];
    lastLogoAnimation.current = name;
    setLogoAnimation(({ run }) => ({ name, run: run + 1 }));
  }

  return (
    <header
      data-app-header
      className={cn(
        // Over what stands close under it (Cloud's path) only while one of its menus is open.
        'relative z-(--z-raised) grid h-[88px] has-[[aria-expanded=true]]:z-(--z-chrome) shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,312px)_minmax(max-content,1fr)] items-center gap-3 px-4 sm:gap-6 sm:px-6',
        // Cloud's side bar starts at the page's edge: its header lines up with it.
        'md:px-8',
      )}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="flex shrink-0 items-center gap-0.5">
          <AppSwitcher
            workspaceId={workspace?.id ?? null}
            link={
              logoSwitches ? undefined : app === 'cloud' && workspace ? (
                <Link
                  to={routes.cloud(workspace.id)}
                  aria-label="Cloud | Dateien"
                  className="flex h-9 shrink-0 items-center transition-opacity hover:opacity-80"
                >
                  <CloudLogo className="max-sm:[&>span]:hidden" />
                </Link>
              ) : app === 'reader' && workspace ? (
                <Link
                  to={routes.pdfs(workspace.id)}
                  aria-label="Reader | PDFs"
                  className="flex h-9 shrink-0 items-center transition-opacity hover:opacity-80"
                >
                  <ReaderLogo className="max-sm:[&>span]:hidden" />
                </Link>
              ) : app === 'writer' && workspace ? (
                <Link
                  to={routes.documents(workspace.id)}
                  aria-label="Writer | Dokumente"
                  className="flex h-9 shrink-0 items-center transition-opacity hover:opacity-80"
                >
                  <WriterLogo className="max-sm:[&>span]:hidden" />
                </Link>
              ) : (
                <Link
                  to={logoLink.to}
                  aria-label={logoLink.label}
                  onClick={onLogoClick}
                  className="flex h-9 shrink-0 items-center transition-opacity hover:opacity-80"
                >
                  <Logo
                    key={logoAnimation.run}
                    tone="brand"
                    className="max-sm:[&>span]:hidden"
                    animation={logoAnimation.name}
                    onAnimationEnd={() => setLogoAnimation(({ run }) => ({ run }))}
                  />
                </Link>
              )
            }
            logo={
              !logoSwitches ? undefined : app === 'cloud' ? (
                <CloudLogo className="max-sm:[&>span]:hidden" />
              ) : app === 'reader' ? (
                <ReaderLogo className="max-sm:[&>span]:hidden" />
              ) : app === 'writer' ? (
                <WriterLogo className="max-sm:[&>span]:hidden" />
              ) : app === 'sender' ? (
                <SenderLogo className="max-sm:[&>span]:hidden" />
              ) : (
                <Logo tone="brand" className="max-sm:[&>span]:hidden" />
              )
            }
          />
        </div>
        <ToolbarDivider spacing="none" className="max-sm:hidden" />
        <WorkspaceSwitcher />
        {leading && <span className="ml-1 flex shrink-0 items-center">{leading}</span>}
      </div>
      <div className="flex min-w-0 justify-center">{center}</div>
      {/* A side panel in Cloud takes the whole height: the people step aside for it. */}
      <div className="flex items-center justify-end gap-3 transition-[margin] duration-300 ease-out md:[body:has([data-cloud-panel])_&]:mr-[400px]">
        {actions}
        {/* Every app: whoever writes reaches one, wherever one is. */}
        <NotifyOffer />
        {/* Today, and from it the calendar – where one's to-dos are (Cloud, Sender). */}
        {/* A meeting coming up, left of the date: joined from here. */}
        {(inCloud || inSender) && workspace && <MeetingNotice workspaceId={workspace.id} />}
        {(inCloud || inSender) && workspace && <DateButton workspaceId={workspace.id} />}
        {(inCloud || inSender) && <CloudChatButton name={workspace?.aiName} />}
        {atSliderStart && <HomeChatButton name={workspace?.aiName} />}
        <OnlineMembers />
        <AccountMenu />
      </div>
    </header>
  );
}
