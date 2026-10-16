import { cn } from './cn';
import { Spinner } from './Spinner';

const PADDING = {
  sm: 'py-4',
  md: 'py-6',
  lg: 'py-16',
} as const;

export interface LoadingStateProps {
  /**
   * Fills the page on the dot grid (`<main>`), e.g. while the account or a deck loads. Without
   * it the spinner is centred in a block with vertical `padding`.
   */
  fullPage?: boolean;
  /** Full-page height: `full` (`min-h-full`, inside the app shell) or `screen` (`h-dvh`). */
  height?: 'full' | 'screen';
  /** Vertical padding of the inline block: `sm` 16, `md` 24, `lg` 64px. */
  padding?: keyof typeof PADDING;
  /** Spinner size; 28 on a full page, else 20. */
  size?: number;
}

/** A centred spinner while something loads (inline block or the whole page). */
export function LoadingState({
  fullPage = false,
  height = 'full',
  padding = 'md',
  size,
}: LoadingStateProps) {
  if (fullPage) {
    return (
      <main
        className={cn(
          'dot-grid flex items-center justify-center',
          height === 'screen' ? 'h-dvh' : 'min-h-full',
        )}
        aria-busy
      >
        <Spinner size={size ?? 28} className="text-fg-subtle" />
      </main>
    );
  }
  return (
    <div className={cn('flex justify-center', PADDING[padding])} aria-busy>
      <Spinner size={size ?? 20} className="text-fg-subtle" />
    </div>
  );
}
