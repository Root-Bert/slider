import { pluralize } from '@/lib/format';
import { AvatarStack, cn } from '@/ui';
import type { Thread } from '../lib/comment-selectors';

/**
 * All comments of a slide folded into one small stacked blob (Figma B4 blob in miniature) – for
 * comment columns too narrow for cards. The connector lines of the slide merge into its top.
 */
export function CommentBubble({
  threads,
  slideLabel,
  width,
  onActivate,
  emphasized,
}: {
  threads: Thread[];
  slideLabel: string;
  width: number;
  onActivate: () => void;
  emphasized: boolean;
}) {
  const authors = [
    ...new Map(
      threads.flatMap((thread) => thread.participants).map((author) => [author.id, author]),
    ).values(),
  ];
  const open = threads.some((thread) => thread.root.status === 'open');
  const label = pluralize(threads.length, 'Kommentar', 'Kommentare');

  return (
    <div
      data-connector-blob
      data-comment-bubble
      className={cn('relative mx-auto pb-2.5', !open && 'opacity-60')}
      style={{ width }}
    >
      <span
        aria-hidden
        className="glass absolute inset-x-3 bottom-0 h-3 rounded-b-chip opacity-50"
      />
      <span aria-hidden className="glass absolute inset-x-1.5 bottom-1 h-3 rounded-b-chip" />
      <button
        type="button"
        onClick={onActivate}
        title={label}
        aria-label={`${label} zu ${slideLabel} – vergrößern`}
        className={cn(
          'glass relative flex h-9 w-full items-center justify-center gap-1.5 rounded-control px-1.5 transition-shadow',
          emphasized
            ? 'shadow-[inset_0_0_0_1px_white]!'
            : 'hover:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3)]!',
        )}
      >
        {width >= 64 && (
          <AvatarStack authors={authors.slice(0, 2)} size={20} className="shrink-0" />
        )}
        <span className="text-xs font-semibold text-fg tabular-nums">{threads.length}</span>
      </button>
    </div>
  );
}
