import { PROVIDER_LABELS, STOCK_HOMES, stockLink, type ImageCredit } from '@slider/shared';
import { cn } from '@/ui';

const linkClasses = 'underline decoration-fg-subtle/50 underline-offset-2 hover:text-fg';

/** „Foto von … auf Unsplash“ (or Pexels), both linked – shown wherever a stock photo is (their terms). */
export function PhotoCredit({ credit, className }: { credit: ImageCredit; className?: string }) {
  const source = credit.source ?? 'unsplash';
  return (
    <p className={cn('truncate text-caption text-fg-subtle', className)}>
      Foto von{' '}
      <a
        href={stockLink(credit.profileUrl, source)}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClasses}
      >
        {credit.name}
      </a>{' '}
      auf{' '}
      <a
        href={stockLink(STOCK_HOMES[source], source)}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClasses}
      >
        {PROVIDER_LABELS[source]}
      </a>
    </p>
  );
}
