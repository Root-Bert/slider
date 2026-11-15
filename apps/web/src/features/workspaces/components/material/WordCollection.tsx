import { useState } from 'react';
import type { SpellingWord } from '@slider/shared';
import { formatShortDate } from '@/lib/format';
import { cn, ContextMenu, type MenuAction, type ShowToast } from '@/ui';
import type { MaterialView } from '../../lib/font-families';

interface WordCollectionProps {
  /** A–Z, as the server keeps them. */
  words: readonly SpellingWord[];
  view: MaterialView;
  /** `null`: may not delete (reviewers, viewers). */
  onRemove: ((word: SpellingWord) => void) | null;
  onNotify: ShowToast;
}

/**
 * The spell check's own words – a workspace's („Wörter“ in its Bibliothek) or one's own
 * („Wörterbuch“). Cards: the words side by side; list: one a row, with who taught it and when. A
 * click copies a word, right click offers „Kopieren“ and „Löschen“.
 */
export function WordCollection({ words, view, onRemove, onNotify }: WordCollectionProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; word: SpellingWord } | null>(null);
  const copy = (word: SpellingWord) =>
    navigator.clipboard
      ?.writeText(word.word)
      .then(() => onNotify(`„${word.word}“ kopiert`))
      .catch(() => onNotify('Konnte nicht in die Zwischenablage kopieren.', 'danger'));
  const actionsFor = (word: SpellingWord): MenuAction[] => [
    { label: 'Kopieren', icon: 'contentCopy', onSelect: () => void copy(word) },
    ...(onRemove
      ? [
          {
            label: 'Löschen',
            icon: 'delete',
            tone: 'danger',
            onSelect: () => onRemove(word),
          } satisfies MenuAction,
        ]
      : []),
  ];

  return (
    <>
      <ul
        className={cn(
          'glass rounded-panel p-1.5',
          view === 'list' ? 'flex flex-col gap-0.5' : 'flex flex-wrap gap-1.5',
        )}
      >
        {words.map((word) => (
          <li key={word.word} className={view === 'list' ? undefined : 'min-w-0'}>
            <button
              type="button"
              title={`${word.word} – Klick kopiert`}
              onClick={() => void copy(word)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, word });
              }}
              className={cn(
                'rounded-control-sm text-body text-fg transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none',
                view === 'list'
                  ? 'flex w-full items-center gap-4 px-3 py-2 text-left'
                  : 'max-w-full truncate bg-surface-1 px-3 py-1.5',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{word.word}</span>
              {view === 'list' && (
                <>
                  {word.addedBy && (
                    <span className="truncate text-xs text-fg-subtle">{word.addedBy}</span>
                  )}
                  <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
                    {formatShortDate(word.createdAt)}
                  </span>
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
      {menu && (
        <ContextMenu
          label={`Aktionen für „${menu.word.word}“`}
          actions={actionsFor(menu.word)}
          at={menu}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

export function WordCollectionSkeleton() {
  return (
    <div className="glass flex flex-wrap gap-1.5 rounded-panel p-1.5" aria-hidden>
      {[72, 112, 88, 136, 64].map((width) => (
        <div key={width} className="skeleton h-8 rounded-control-sm" style={{ width }} />
      ))}
    </div>
  );
}
