import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  title: ReactNode;
  message: ReactNode;
  /** Below the text, e.g. a button or a link. */
  action?: ReactNode;
  /** Above the text: an illustration, a logo, an `IconTile`. */
  illustration?: ReactNode;
  /**
   * `md`: placeholder inside a page (16px heading, generous vertical padding).
   * `lg`: full-page message (24px heading, no padding of its own – the page shell has it).
   */
  size?: 'md' | 'lg';
  /** Defaults to 2 for `md` and 1 for `lg`. */
  headingLevel?: 1 | 2 | 3;
}

/** Placeholder for "nothing here yet" or a full-page message: illustration, title, text, action. */
export function EmptyState({
  title,
  message,
  action,
  illustration,
  size = 'md',
  headingLevel,
}: EmptyStateProps) {
  const large = size === 'lg';
  const Heading = `h${headingLevel ?? (large ? 1 : 2)}` as 'h1' | 'h2' | 'h3';
  return (
    <div
      className={cn('flex flex-col items-center text-center', large ? 'gap-6' : 'gap-5 px-4 py-20')}
    >
      {illustration}
      <div className={cn('flex max-w-sm flex-col', large ? 'gap-2' : 'gap-1.5')}>
        <Heading
          className={cn('font-semibold text-fg', large ? 'text-2xl leading-8' : 'text-base')}
        >
          {title}
        </Heading>
        <p className="text-sm text-fg-subtle">{message}</p>
      </div>
      {action}
    </div>
  );
}
