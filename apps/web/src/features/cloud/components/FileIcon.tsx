import type { CloudFileType, CloudNodeKind } from '@slider/shared';
import { cn, Icon, LogoMark } from '@/ui';
import solverMark from '../assets/solver-mark.svg';
import writerMark from '../assets/writer-mark.svg';
import { FILE_KINDS } from '../lib/kinds';

const SIZES = {
  20: { box: 'size-5 rounded-thumb', icon: 14, mark: 14 },
  32: { box: 'size-8 rounded-chip', icon: 18, mark: 22 },
  40: { box: 'size-10 rounded-control-sm', icon: 22, mark: 26 },
  56: { box: 'size-14 rounded-control', icon: 28, mark: 36 },
} as const;

/**
 * What a file is, at a glance: presentations wear Slider's mark, documents Writer's and tables
 * Solver's – the apps they belong to, also before those open them – every other kind a tinted
 * tile with its symbol. A folder is a plain tile.
 */
export function FileIcon({
  kind,
  type,
  size = 32,
  className,
}: {
  kind: CloudNodeKind;
  type: CloudFileType | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { box, icon, mark } = SIZES[size];
  const frame = cn('flex shrink-0 items-center justify-center', box, className);
  if (kind === 'folder') {
    return (
      <span className={cn(frame, 'bg-surface-2 text-fg-muted')}>
        <Icon name="folder" size={icon} />
      </span>
    );
  }
  if (type === 'presentation') {
    return (
      <span className={frame}>
        <LogoMark width={mark} />
      </span>
    );
  }
  if (type === 'document') {
    return (
      <span className={frame}>
        <img src={writerMark} alt="" width={mark} height={(mark * 24.05) / 26} draggable={false} />
      </span>
    );
  }
  if (type === 'spreadsheet') {
    return (
      <span className={frame}>
        <img src={solverMark} alt="" width={mark} height={(mark * 89) / 96} draggable={false} />
      </span>
    );
  }
  const look = FILE_KINDS[type ?? 'other'];
  return (
    <span className={cn(frame, look.tile, look.ink)}>
      <Icon name={look.icon} size={icon} />
    </span>
  );
}
