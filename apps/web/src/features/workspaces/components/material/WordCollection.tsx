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
 * The spell check's own words – a workspace's or one's own („Wörter“ in the Bibliothek), laid out as a dictionary: under their first letter. Cards: one card a letter,
 * each word with who taught it and when, the cards flowing in columns; list: one a row under its
 * letter. A click copies a word, right click offers „Kopieren“ and „Löschen“.
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

  const word = (entry: SpellingWord) => (
    <li key={entry.word}>
      <button
        type="button"
        title={`${entry.word} – Klick kopiert`}
        onClick={() => void copy(entry)}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, word: entry });
        }}
        className={cn(
          'w-full rounded-control-sm text-left transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-fg focus-visible:outline-none',
          view === 'list'
            ? 'flex items-center gap-4 px-3 py-2 text-body text-fg'
            : 'flex flex-col px-3 py-2',
        )}
      >
        <span
          className={cn(
            'min-w-0 truncate',
            view === 'list' ? 'flex-1' : 'text-base font-medium text-fg',
          )}
        >
          {entry.word}
        </span>
        {view === 'list' ? (
          <>
            {entry.addedBy && (
              <span className="truncate text-xs text-fg-subtle">{entry.addedBy}</span>
            )}
            <span className="shrink-0 text-xs text-fg-subtle tabular-nums">
              {formatShortDate(entry.createdAt)}
            </span>
          </>
        ) : (
          <span className="truncate text-caption text-fg-subtle">
            {[entry.addedBy, formatShortDate(entry.createdAt)].filter(Boolean).join(', ')}
          </span>
        )}
      </button>
    </li>
  );

  return (
    <>
      {view === 'list' ? (
        <div className="glass flex flex-col rounded-panel p-1.5">
          {byLetter(words).map(([letter, entries]) => (
            <section key={letter} aria-label={letter}>
              <h3 className="px-3 pt-3 pb-1 text-xs font-medium text-fg-subtle">{letter}</h3>
              <ul className="flex flex-col gap-0.5">{entries.map(word)}</ul>
            </section>
          ))}
        </div>
      ) : (
        // As a dictionary's pages: one card a letter, the cards flowing in columns.
        <div className="columns-[16rem] gap-4">
          {byLetter(words).map(([letter, entries]) => (
            <section
              key={letter}
              aria-label={letter}
              className="glass mb-4 break-inside-avoid rounded-panel p-1.5"
            >
              <h3 className="px-3 pt-2 pb-1 text-display leading-none font-semibold text-fg-faint">
                {letter}
              </h3>
              <ul className="flex flex-col">{entries.map(word)}</ul>
            </section>
          ))}
        </div>
      )}
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

/** The words under their first letter, A–Z as in a dictionary: Ä under A, digits and signs „#“. */
function byLetter(words: readonly SpellingWord[]): [string, SpellingWord[]][] {
  const groups = new Map<string, SpellingWord[]>();
  const sorted = [...words].sort((a, b) =>
    a.word.localeCompare(b.word, 'de', { sensitivity: 'base' }),
  );
  for (const entry of sorted) {
    const first = entry.word
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .charAt(0)
      .toLocaleUpperCase('de');
    const letter = /^[A-Z]$/.test(first) ? first : '#';
    groups.set(letter, [...(groups.get(letter) ?? []), entry]);
  }
  return [...groups].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)));
}

export function WordCollectionSkeleton() {
  return (
    <div className="columns-[16rem] gap-4" aria-hidden>
      {[3, 2, 4].map((count, index) => (
        <div key={index} className="glass mb-4 flex flex-col gap-2 rounded-panel p-4">
          <div className="skeleton h-7 w-7 rounded-control-sm" />
          {Array.from({ length: count }, (_, row) => (
            <div key={row} className="skeleton h-5 w-2/3 rounded-control-sm" />
          ))}
        </div>
      ))}
    </div>
  );
}
