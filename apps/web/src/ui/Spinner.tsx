import { cn } from './cn';
import { iconPx, type IconSize } from './icon-size';

export function Spinner({
  size = 20,
  label = 'Lädt',
  className,
}: {
  /** A step of the icon scale (`'md'`) or px. */
  size?: IconSize;
  /** Accessible name of the status. */
  label?: string;
  className?: string;
}) {
  const px = iconPx(size);
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      className={cn('animate-spin', className)}
      role="status"
      aria-label={label}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
