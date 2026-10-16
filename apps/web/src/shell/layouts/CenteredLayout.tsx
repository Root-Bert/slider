import { useId, type ReactNode } from 'react';
import type { To } from 'react-router';
import { cn, IconTile } from '@/ui';
import { LogoHeader } from './LogoHeader';

export interface CenteredLayoutProps {
  /** Document title (`<title>`), e.g. "Anmelden · Slider". */
  docTitle: string;
  /** Makes the header logo a link home. */
  logoLink?: { to: To; label: string };
  /** Right end of the header, e.g. the account menu when signed in. */
  headerEnd?: ReactNode;
  /** Stacked with 16px gaps in a 440px column (banner, card, hint). */
  children: ReactNode;
}

/**
 * Shell of the standalone pages outside the app (login, join): logo header and a narrow column
 * that sits a little above the middle of the dot grid.
 */
export function CenteredLayout({ docTitle, logoLink, headerEnd, children }: CenteredLayoutProps) {
  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>{docTitle}</title>
      <LogoHeader logoLink={logoLink} end={headerEnd} />
      <main className="flex flex-1 justify-center px-4 pt-[clamp(8px,12vh,140px)] pb-16">
        <div className="flex w-full max-w-[440px] flex-col gap-4">{children}</div>
      </main>
    </div>
  );
}

export interface CenteredCardProps {
  /** Shown in a 56px tile above the title. */
  icon: ReactNode;
  /** Small line above the title, e.g. "Einladung von …". */
  eyebrow?: ReactNode;
  title: ReactNode;
  message: ReactNode;
  /** 1 when the card is the page (login, join), 2 inside a page (no access). */
  headingLevel?: 1 | 2;
  /** `compact`: 20px gaps and fixed 32px sides (the no-access card inside "Neue Review"). */
  density?: 'default' | 'compact';
  /** Stable id for the heading (defaults to a generated one). */
  titleId?: string;
  /** Below the text: options, buttons, links. */
  children?: ReactNode;
}

/** Hero card of a standalone page: icon tile, 24px title, message, then the actions. */
export function CenteredCard({
  icon,
  eyebrow,
  title,
  message,
  headingLevel = 1,
  density = 'default',
  titleId,
  children,
}: CenteredCardProps) {
  const generatedId = useId();
  const headingId = titleId ?? generatedId;
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'glass flex animate-fade-in flex-col items-center rounded-panel pt-10 pb-8 text-center',
        density === 'compact' ? 'gap-5 px-8' : 'gap-6 px-6 sm:px-10',
      )}
    >
      <IconTile size={56} tone="fg">
        {icon}
      </IconTile>
      <div className="flex flex-col gap-2">
        {eyebrow && <p className="text-xs text-fg-subtle">{eyebrow}</p>}
        <Heading id={headingId} className="text-2xl leading-8 font-semibold break-words text-fg">
          {title}
        </Heading>
        <p className="text-sm leading-5 text-fg-subtle">{message}</p>
      </div>
      {children}
    </section>
  );
}
