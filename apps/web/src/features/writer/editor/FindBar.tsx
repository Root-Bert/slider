import { useEffect, useRef, useState } from 'react';
import { pluralize } from '@/lib/format';
import { Button, GlassPanel, IconButton } from '@/ui';
import type { Hit } from '../lib/model';
import { useWriter, useWriterState } from './session';

/**
 * „Suchen“, in the page above the sheet: every place the words stand is marked, ↵ leads to the
 * next; „Ersetzen“ swaps the one in front, „Alle ersetzen“ all of them in one step.
 */
export function FindBar({
  query,
  onQuery,
  hits,
  at,
  onAt,
  onClose,
}: {
  query: string;
  onQuery: (query: string) => void;
  hits: readonly Hit[];
  at: number;
  onAt: (index: number) => void;
  onClose: () => void;
}) {
  const { engine, document, notify } = useWriter();
  const { mode } = useWriterState();
  const [swap, setSwap] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const editing = document.permissions.canEdit && mode === 'edit';
  const hit = hits[at];

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const step = (by: 1 | -1) => {
    if (hits.length === 0) return;
    onAt((at + by + hits.length) % hits.length);
  };
  const well = 'field-well focus-field flex h-8 min-w-0 items-center rounded-control-sm px-2.5';
  const input =
    'w-full min-w-0 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle';

  return (
    <GlassPanel
      data-chrome
      role="search"
      aria-label="Suchen"
      className="fixed top-3 left-1/2 z-(--z-chrome) flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-pop-in items-center gap-1.5 rounded-panel p-1.5"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <label className={`${well} w-52`}>
        <input
          ref={field}
          type="text"
          aria-label="Suchen"
          placeholder="Suchen"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
          }}
          className={input}
        />
      </label>
      <span
        aria-live="polite"
        className="min-w-16 text-center text-caption text-fg-subtle tabular-nums"
      >
        {query === ''
          ? ''
          : hits.length === 0
            ? 'Nichts gefunden'
            : `${Math.min(at + 1, hits.length)} von ${hits.length}`}
      </span>
      <IconButton
        icon="chevronLeft"
        label="Vorige Stelle (⇧↵)"
        size="compact"
        variant="subtle"
        disabled={hits.length === 0}
        onClick={() => step(-1)}
      />
      <IconButton
        icon="chevronRight"
        label="Nächste Stelle (↵)"
        size="compact"
        variant="subtle"
        disabled={hits.length === 0}
        onClick={() => step(1)}
      />
      {editing && (
        <>
          <label className={`${well} w-40`}>
            <input
              aria-label="Ersetzen durch"
              placeholder="Ersetzen durch"
              value={swap}
              onChange={(event) => setSwap(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && hit) {
                  event.preventDefault();
                  engine.replace(hit, swap);
                }
              }}
              className={input}
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            disabled={!hit}
            onClick={() => hit && engine.replace(hit, swap)}
          >
            Ersetzen
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={hits.length === 0}
            onClick={() => {
              const count = engine.replaceAll(query, swap);
              if (count > 0) notify(`${pluralize(count, 'Stelle', 'Stellen')} ersetzt`);
            }}
          >
            Alle ersetzen
          </Button>
        </>
      )}
      <IconButton
        icon="close"
        label="Suche schließen"
        size="compact"
        variant="subtle"
        onClick={onClose}
      />
    </GlassPanel>
  );
}
