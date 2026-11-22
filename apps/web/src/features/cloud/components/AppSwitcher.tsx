import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { HeaderPopover } from '@/features/workspaces';
import { installedApp, windowForApp, useCurrentApp, type AppId } from '@/lib/apps';
import { routes } from '@/lib/routes';
import { Badge, cn, Icon, LogoMark, MenuHeading, MenuItem } from '@/ui';
import cloudMark from '../assets/cloud-mark.svg';
import senderMark from '../assets/sender-mark.svg';
import readerMark from '../assets/reader-mark.svg';
import writerMark from '../assets/writer-mark.svg';

/**
 * Cloud's mark, `width` px wide – the app's sign beside Slider's. It is the cloud (the brand's
 * „Cloud Mark“); the two boxes are the family's mark and stand on the website only.
 */
export function CloudMark({ width = 24 }: { width?: number }) {
  return (
    <img src={cloudMark} alt="" width={width} height={(width * 188) / 212} draggable={false} />
  );
}

/** Cloud's word mark, built like Slider's: the mark beside the word. */
export function CloudLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-fg', className)}>
      <CloudMark />
      <span className="text-lg font-semibold tracking-tight">Cloud</span>
    </span>
  );
}

/** Writer's mark and word mark, built like Cloud's. */
export function WriterMark({ width = 24 }: { width?: number }) {
  return <img src={writerMark} alt="" width={width} height={(width * 20) / 22} draggable={false} />;
}

export function WriterLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-fg', className)}>
      <WriterMark />
      <span className="text-lg font-semibold tracking-tight">Writer</span>
    </span>
  );
}

/** Reader's mark (a document – a page folded top left, a picture and lines – under the comment box) and word mark, built like Cloud's. */
export function ReaderMark({ width = 24 }: { width?: number }) {
  return (
    <img src={readerMark} alt="" width={width} height={(width * 191) / 208} draggable={false} />
  );
}

export function ReaderLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-fg', className)}>
      <ReaderMark />
      <span className="text-lg font-semibold tracking-tight">Reader</span>
    </span>
  );
}

/**
 * Sender's mark (two speech bubbles: a message, and one with reactions stacked on it) and word
 * mark, built like Cloud's.
 */
export function SenderMark({ width = 24 }: { width?: number }) {
  return (
    <img src={senderMark} alt="" width={width} height={(width * 93.65) / 96} draggable={false} />
  );
}

export function SenderLogo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-fg', className)}>
      <SenderMark />
      <span className="text-lg font-semibold tracking-tight">Sender</span>
    </span>
  );
}

interface AppEntry {
  id: string;
  name: string;
  note: string;
  mark: ReactNode;
  to: string;
  /** Still being built: „Alpha“ (early) or „Beta“ (nearly there) at the row's end. */
  stage?: 'Alpha' | 'Beta';
}

/** A mark in the row's icon place, as wide as a workspace's picture. */
const mark = (child: ReactNode) => (
  <span className="flex size-6 shrink-0 items-center justify-center">{child}</span>
);

/**
 * The chevron beside the logo: the apps of one account – Cloud, Slider, Writer, Reader and
 * Sender – one click apart, in the same workspace. A menu built like the workspace
 * switcher beside it: one row per app, the open one picked. At the app's start the logo is part
 * of the button (`logo`).
 * In the desktop app there is one app only: the logo stands alone, no menu. Installed as a web
 * app, the menu is there – the other app opens in a window of its own.
 */
export function AppSwitcher({
  workspaceId,
  logo,
  link,
}: {
  workspaceId: string | null;
  /** Elsewhere: the logo as a link, before the chevron – the menu opens flush with its left. */
  link?: ReactNode;
  /**
   * At the app's start, where the logo has nowhere to lead: the logo itself, which then opens
   * the menu together with the chevron – one button, like the workspace switcher's.
   */
  logo?: ReactNode;
}) {
  const app = useCurrentApp();
  const navigate = useNavigate();
  if (!workspaceId) return link ?? null;
  // The desktop app's window is one app; an installed web app has the menu too – the other app
  // opens in a window of its own (`windowForApp`).
  if (installedApp && /\bElectron\//.test(navigator.userAgent)) return link ?? logo ?? null;

  const apps: AppEntry[] = [
    {
      id: 'cloud',
      name: 'Cloud',
      note: 'Dateien',
      mark: mark(<CloudMark width={22} />),
      to: routes.cloud(workspaceId),
      stage: 'Beta',
    },
    {
      id: 'slider',
      name: 'Slider',
      note: 'Präsentationen',
      mark: mark(<LogoMark width={22} />),
      to: routes.workspace(workspaceId),
    },
    {
      id: 'writer',
      name: 'Writer',
      note: 'Dokumente',
      mark: mark(<WriterMark width={22} />),
      to: routes.documents(workspaceId),
      stage: 'Alpha',
    },
    {
      id: 'reader',
      name: 'Reader',
      note: 'PDFs',
      mark: mark(<ReaderMark width={22} />),
      to: routes.pdfs(workspaceId),
      stage: 'Alpha',
    },
    {
      id: 'sender',
      name: 'Sender',
      note: 'Nachrichten',
      mark: mark(<SenderMark width={22} />),
      to: routes.messages(workspaceId),
      stage: 'Alpha',
    },
  ];

  return (
    <HeaderPopover
      label="App wechseln"
      before={link}
      className={logo ? undefined : 'flex shrink-0 items-center gap-0.5'}
      triggerClassName={
        logo
          ? // The padding hangs out to the left, so the logo stands where the link's does.
            '-ml-1.5 flex h-9 items-center gap-0.5 rounded-control pl-1.5 text-fg transition-colors hover:bg-hover aria-expanded:bg-hover'
          : 'flex h-9 w-6 items-center justify-center rounded-chip text-fg-subtle transition-colors hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg'
      }
      panelClassName="w-[min(280px,calc(100vw-32px))]"
      trigger={() =>
        logo ? (
          <>
            {logo}
            <span className="flex w-6 justify-center text-fg-subtle">
              <Icon name="expandMore" size={18} />
            </span>
          </>
        ) : (
          <Icon name="expandMore" size={18} />
        )
      }
    >
      {(close) => (
        <>
          <MenuHeading>Apps</MenuHeading>
          <div className="flex flex-col gap-0.5">
            {apps.map((each) => (
              <MenuItem
                key={each.id}
                // Alpha: greyed, still a click away – one sees it is early before going there.
                icon={
                  each.stage === 'Alpha' ? (
                    <span className="opacity-60 grayscale">{each.mark}</span>
                  ) : (
                    each.mark
                  )
                }
                selected={each.id === app}
                trailing={each.stage && <Badge>{each.stage}</Badge>}
                onClick={() => {
                  close();
                  // Installed, a window is one app: the other one opens beside it, as itself.
                  const other = each.id === app ? null : windowForApp(each.id as AppId);
                  if (other) other.go(each.to);
                  else void navigate(each.to);
                }}
              >
                <span className={cn('truncate', each.stage === 'Alpha' && 'text-fg-subtle')}>
                  {each.name}
                </span>
                <span
                  className={cn(
                    'shrink-0 text-xs',
                    each.stage === 'Alpha' ? 'text-fg-faint' : 'text-fg-subtle',
                  )}
                >
                  {each.note}
                </span>
              </MenuItem>
            ))}
          </div>
        </>
      )}
    </HeaderPopover>
  );
}
