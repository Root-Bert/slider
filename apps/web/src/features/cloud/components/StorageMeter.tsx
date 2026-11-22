import type { CloudHome } from '@slider/shared';
import { formatFileSize } from '@/lib/format';
import { cn } from '@/ui';

/** The parts of the storage bar, in its order: what Slider keeps, documents, media, the rest. */
export const storageParts = (storage: CloudHome['storage']) => [
  {
    key: 'presentations',
    label: 'Präsentationen',
    bytes: storage.presentationBytes,
    fill: 'bg-logo',
    stroke: 'stroke-logo',
  },
  {
    key: 'documents',
    label: 'Dokumente',
    bytes: storage.documentBytes,
    fill: 'bg-sky',
    stroke: 'stroke-sky',
  },
  {
    key: 'media',
    label: 'Medien',
    bytes: storage.mediaBytes,
    fill: 'bg-accent-violet',
    stroke: 'stroke-accent-violet',
  },
  {
    key: 'other',
    label: 'Andere',
    bytes: storage.otherBytes,
    fill: 'bg-fg-subtle',
    stroke: 'stroke-fg-subtle',
  },
];

/** The bar itself: each part as wide as its share of the plan (or, without a limit, of what is used). */
export function StorageBar({
  storage,
  className,
}: {
  storage: CloudHome['storage'];
  className?: string;
}) {
  const whole = storage.maxBytes ?? Math.max(storage.usedBytes, 1);
  return (
    <div
      role="meter"
      aria-label="Speicher"
      aria-valuemin={0}
      aria-valuemax={whole}
      aria-valuenow={Math.min(storage.usedBytes, whole)}
      aria-valuetext={usedText(storage)}
      className={cn('flex h-2 overflow-hidden rounded-thumb bg-surface-3', className)}
    >
      {storageParts(storage).map((part) => (
        <span
          key={part.key}
          className={cn('h-full shrink-0', part.fill)}
          style={{ width: `${Math.min(100, (part.bytes / whole) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export const usedText = (storage: CloudHome['storage']) =>
  storage.maxBytes === null
    ? `${formatFileSize(storage.usedBytes)} belegt`
    : `${formatFileSize(storage.usedBytes)} von ${formatFileSize(storage.maxBytes)}`;

/** The bar bent into a ring, for where there is no width for it: the folded side bar. */
export function StorageRing({
  storage,
  size = 20,
}: {
  storage: CloudHome['storage'];
  size?: number;
}) {
  const whole = storage.maxBytes ?? Math.max(storage.usedBytes, 1);
  // As large as the icons of the rows above it (20px).
  const width = 3;
  const radius = (size - width) / 2;
  const around = 2 * Math.PI * radius;
  // Each part with where it begins: one after the other, never past the whole.
  const parts = storageParts(storage).reduce<
    { key: string; stroke: string; from: number; share: number }[]
  >((list, part) => {
    const from = list.reduce((sum, each) => sum + each.share, 0);
    return [
      ...list,
      {
        key: part.key,
        stroke: part.stroke,
        from,
        share: Math.max(0, Math.min(1 - from, part.bytes / whole)),
      },
    ];
  }, []);
  return (
    <svg
      role="meter"
      aria-label="Speicher"
      aria-valuemin={0}
      aria-valuemax={whole}
      aria-valuenow={Math.min(storage.usedBytes, whole)}
      aria-valuetext={usedText(storage)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={width}
        className="stroke-surface-3"
      />
      {parts.map(({ key, stroke, from, share }) => {
        if (share <= 0) return null;
        return (
          <circle
            key={key}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={width}
            strokeDasharray={`${share * around} ${around}`}
            strokeDashoffset={-from * around}
            className={stroke}
          />
        );
      })}
    </svg>
  );
}

/** „Speicher“ at the foot of the side bar. */
export function StorageMeter({ storage }: { storage: CloudHome['storage'] }) {
  const full = storage.maxBytes !== null && storage.usedBytes >= storage.maxBytes * 0.95;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="text-body font-medium text-fg">Speicher</span>
        <span className={cn('text-xs tabular-nums', full ? 'text-warning' : 'text-fg-muted')}>
          {usedText(storage)}
        </span>
      </div>
      <StorageBar storage={storage} />
    </div>
  );
}
