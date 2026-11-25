import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { isModEnter } from '@/lib/keyboard';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { Kbd, ReturnKey } from './Kbd';

/*
 * A palette: a field on top, what it finds and can do below, ↑ ↓ pick, ↵ runs, Esc closes. Cloud's
 * search (⇧⌘F where the side bar has no field) and the command panel (⌘K) alike.
 */

export interface PaletteEntry {
  key: string;
  /** The heading it stands under; entries of one group follow each other. */
  group: string;
  leading: ReactNode;
  title: ReactNode;
  subtitle?: string;
  /** What runs once the palette has closed and the focus is back where it was. */
  run: () => void;
  /** Runs with the palette open, which closes once it is done – the AI, once its agent is there. */
  stays?: boolean;
}

/** The round mark of an entry that is no file or person: a command, a page, a mail. */
export function PaletteMark({ icon }: { icon: IconName }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
      <Icon name={icon} size={18} />
    </span>
  );
}

/** The name with the first word typed set in bold. */
export function PaletteMarked({ text, query }: { text: string; query: string }) {
  const word = query.trim().split(/\s+/)[0] ?? '';
  const at = word ? text.toLocaleLowerCase('de').indexOf(word.toLocaleLowerCase('de')) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-fg">{text.slice(at, at + word.length)}</span>
      {text.slice(at + word.length)}
    </>
  );
}

/*
 * The selection the page had as the palette opened – a caret in a text, words picked. Focus goes
 * back by itself as a modal dialog closes, the selection stays in the dialog: put back, the page
 * types on where it was, and a command for the words picked finds them.
 */
type Kept =
  | { ranges: Range[] }
  | {
      field: HTMLInputElement | HTMLTextAreaElement;
      /** What it held: typed into already when the dialog's `close` comes, it is not put back. */
      value: string;
      start: number | null;
      end: number | null;
      direction: 'forward' | 'backward' | 'none' | null;
    };
const keptSelections = new WeakMap<HTMLDialogElement, Kept>();

const keepSelection = (dialog: HTMLDialogElement) => {
  const active = document.activeElement;
  // A field's caret is its own: the document's range lies beside it. Put back with the field's
  // own, so it takes the typing again.
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    keptSelections.set(dialog, {
      field: active,
      value: active.value,
      start: active.selectionStart,
      end: active.selectionEnd,
      direction: active.selectionDirection,
    });
    return;
  }
  const selection = document.getSelection();
  keptSelections.set(dialog, {
    ranges: selection
      ? Array.from({ length: selection.rangeCount }, (_, index) =>
          selection.getRangeAt(index).cloneRange(),
        )
      : [],
  });
};

const restoreSelection = (dialog: HTMLDialogElement) => {
  const kept = keptSelections.get(dialog);
  keptSelections.delete(dialog);
  if (!kept) return;
  if ('field' in kept) {
    const { field, value, start, end, direction } = kept;
    // The `close` event comes a task after the focus went back: letters typed fast in between
    // already stand where the caret was – putting it back then would move it behind them.
    if (
      !field.isConnected ||
      document.activeElement !== field ||
      field.value !== value ||
      start === null ||
      end === null
    )
      return;
    try {
      field.setSelectionRange(start, end, direction ?? undefined);
    } catch {
      // A field without a caret (a number, a date) – nothing to put back.
    }
    return;
  }
  const { ranges } = kept;
  if (!ranges.length || !ranges.every((range) => range.startContainer.isConnected)) return;
  // A caret in an editable text takes the focus with it: put back there only while the focus is
  // in that text – opened over a field beside it (a panel's select), the field keeps it.
  const active = document.activeElement;
  const elsewhere = ranges.some((range) => {
    const node = range.startContainer;
    const element = node instanceof Element ? node : node.parentElement;
    return (
      element instanceof HTMLElement && element.isContentEditable && !active?.contains(element)
    );
  });
  if (elsewhere) return;
  const selection = document.getSelection();
  selection?.removeAllRanges();
  for (const range of ranges) selection?.addRange(range);
};

/** Closes the palette at once and gives the page its selection back, before a command runs. */
const closePalette = (dialog: HTMLDialogElement) => {
  if (dialog.open) dialog.close();
  restoreSelection(dialog);
};

/** The dialog around it: opened and closed by `open`, closed by Esc or a click beside it. */
export function PaletteDialog({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      keepSelection(element);
      element.showModal();
    }
    if (!open && element.open) closePalette(element);
  }, [open]);
  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={(event) => {
        // The event comes a task later: opened again meanwhile (⌘K twice at once), it is old.
        if (event.currentTarget.open) return;
        // Esc, a pick, ⌘K again or a click beside it – each way gives the selection back.
        closePalette(event.currentTarget);
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="glass-elevated m-0 mx-auto mt-[min(120px,14vh)] w-[min(660px,calc(100vw-32px))] rounded-panel p-0 text-left text-fg backdrop:bg-scrim backdrop:backdrop-blur-sm open:animate-pop-in"
    >
      {children}
    </dialog>
  );
}

/**
 * The field, the entries in their groups and the keys' line. A pick closes the dialog first – the
 * focus goes back where it was, a caret and a selection with it (`closePalette`) – and runs then.
 */
export function PaletteBody({
  label,
  query,
  onQuery,
  entries,
  icon = 'search',
  pick = 'öffnen',
  onModEnter,
  hints,
  children,
}: {
  /** The field's name and its placeholder. */
  label: string;
  query: string;
  onQuery: (query: string) => void;
  entries: readonly PaletteEntry[];
  icon?: IconName;
  /** What ↵ does, in the keys' line. */
  pick?: string;
  /**
   * ⌘↵ / Strg ↵: what runs whatever is picked (the command panel: the words to the AI) – with the
   * palette open, as an entry that `stays`.
   */
  onModEnter?: () => void;
  /** More keys for the line at the bottom. */
  hints?: ReactNode;
  /** Under the entries: nothing found, more to find, … */
  children?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [active, setActive] = useState(0);
  const picked = Math.min(active, Math.max(0, entries.length - 1));
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [picked]);
  const run = (entry: PaletteEntry) => {
    const dialog = root.current?.closest('dialog');
    if (dialog && !entry.stays) closePalette(dialog);
    entry.run();
  };

  return (
    <div ref={root} className="flex max-h-[min(560px,70vh)] flex-col">
      <label className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-5">
        <Icon name={icon} size={20} className="text-fg-muted" />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            onQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive(Math.min(entries.length - 1, picked + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(Math.max(0, picked - 1));
            } else if (onModEnter && isModEnter(event)) {
              event.preventDefault();
              onModEnter();
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const entry = entries[picked];
              if (entry) run(entry);
            }
          }}
          aria-label={label}
          aria-controls={listId}
          aria-activedescendant={entries[picked] ? `${listId}-${picked}` : undefined}
          placeholder={label}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
        />
        <Kbd>esc</Kbd>
      </label>
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Treffer"
        className="flex-1 overflow-y-auto p-2"
      >
        {entries.map((entry, index) => {
          const heading = entries[index - 1]?.group !== entry.group;
          const current = index === picked;
          return (
            <div key={`${entry.group}:${entry.key}`}>
              {heading && (
                <p className="px-2.5 pt-2.5 pb-1.5 text-caption font-semibold tracking-wider text-fg-subtle uppercase">
                  {entry.group}
                </p>
              )}
              <button
                type="button"
                role="option"
                id={`${listId}-${index}`}
                aria-selected={current}
                data-active={current}
                onMouseMove={() => setActive(index)}
                onClick={() => run(entry)}
                className={cn(
                  'flex h-12 w-full items-center gap-3 rounded-control px-2.5 text-left',
                  current && 'bg-hover',
                )}
              >
                {entry.leading}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-fg-muted">{entry.title}</span>
                  {entry.subtitle && (
                    <span className="truncate text-xs text-fg-subtle">{entry.subtitle}</span>
                  )}
                </span>
                {current && (
                  <Kbd>
                    <ReturnKey />
                  </Kbd>
                )}
              </button>
            </div>
          );
        })}
        {children}
      </div>
      <footer className="flex shrink-0 items-center gap-4 border-t border-hairline px-5 py-2.5 text-xs text-fg-subtle">
        <span className="flex items-center gap-1.5">
          <Kbd>↑↓</Kbd> wählen
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>
            <ReturnKey />
          </Kbd>{' '}
          {pick}
        </span>
        {hints}
      </footer>
    </div>
  );
}
