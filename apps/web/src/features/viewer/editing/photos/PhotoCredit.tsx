import { STOCK_HOME, stockLink, type ImageCredit } from '@slider/shared';
import { cn } from '@/ui';

const linkClasses = 'underline decoration-fg-subtle/50 underline-offset-2 hover:text-fg';

/** „Foto von … auf Unsplash“, both linked – shown wherever a stock photo is (Unsplash's terms). */
export function PhotoCredit({ credit, className }: { credit: ImageCredit; className?: string }) {
  return (
    <p className={cn('truncate text-caption text-fg-subtle', className)}>
      Foto von{' '}
      <a
        href={stockLink(credit.profileUrl)}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClasses}
      >
        {credit.name}
      </a>{' '}
      auf{' '}
      <a
        href={stockLink(STOCK_HOME)}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClasses}
      >
        Unsplash
      </a>
    </p>
  );
}
