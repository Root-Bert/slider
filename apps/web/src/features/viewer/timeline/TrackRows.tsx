import { notesText } from '@slider/shared';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useAiProposals, useResolveProposal } from '@/lib/api';
import { AutosizeTextarea, Avatar, Button, cn, Icon, IconButton, Spinner, usePopover } from '@/ui';
import { AiProposalCard } from '../comments/AiProposalCard';
import { Divider } from '../editing/StyleControls';
import { useEditing } from '../editing/editing-context';
import { useAskAi } from '../editing/hooks/useAskAi';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { useVariantAsk, useVariantCopy } from './hooks/useVariantFlow';
import { useTrackDots } from './TrackDots';
import {
  madeByProposal,
  setVariantPrompt,
  useVariantPrompted,
  useVariantRequest,
} from './lib/variant-requests';
import { notesFromDom, notesFromText, notesToHtml } from './lib/notes-html';

/** Notes are saved this long after the last key – and when the field is left. */
const NOTES_SAVE_MS = 700;

/**
 * The AI's answer on a variant done („Erledigen“, the thread's toggle) or opened again (its
 * avatar in the badge) – for everyone, as a thread is done or opened again: shown at once, a
 * refusal toasts. `null` for whoever may not comment – they see the card as it is.
 */
const useResolveNote = () => {
  const { deck, canComment } = useViewerData();
  const toast = useViewerToast();
  const resolve = useResolveProposal(deck.id);
  if (!canComment) return null;
  return (proposalId: string, open: boolean) =>
    resolve.mutate(
      { proposalId, status: open ? 'open' : 'done' },
      { onError: (error) => toast(error.message, 'danger') },
    );
};

/** The page id of slide `slideId` in the file, as operations name it. */
const usePageOf = () => {
  const editing = useEditing();
  return (slideId: string) =>
    editing.state?.slides.find((item) => item.slideId === slideId)?.pageId;
};

/**
 * Over a variant on its track: its name and, on an editable deck, „Verwenden“ – it takes its
 * slide's place in the deck, the slide becoming a variant of it. A variant the AI made from the
 * words of „Variante erstellen“ (no thread to answer in) carries the AI's answer: the card a
 * thread shows – what it did, „Änderung zurücknehmen“ (the variant goes) – open on it until
 * someone marks it done („Erledigen“, as a thread; its avatar in the badge opens it again):
 * done for everyone, like a thread.
 */
export const VariantBadge = memo(function VariantBadge({
  variantId,
  number,
  x,
  w,
  canEdit,
}: {
  variantId: string;
  number: number;
  x: number;
  w: number;
  canEdit: boolean;
}) {
  const editing = useEditing();
  const toast = useViewerToast();
  const pageOf = usePageOf();
  const { deck, aiAuthor } = useViewerData();
  const pageId = pageOf(variantId);
  // Only a page the AI made can be one of its variants – no proposals fetched for the others.
  const { data: proposals } = useAiProposals(deck.id, !!pageId?.startsWith('ai'));
  const proposal = pageId
    ? proposals?.find(
        (item) =>
          item.commentId === null && item.status === 'applied' && madeByProposal(pageId, item.id),
      )
    : undefined;
  const noteOpen = !!proposal && proposal.resolvedAt === null;
  const resolveNote = useResolveNote();
  const use = () => {
    if (!pageId) return;
    void editing
      .apply([{ type: 'useVariant', pageId }])
      .then((ok) => ok && toast('Variante verwendet'));
  };
  return (
    <>
      <div
        data-variant-badge
        className="glass-dark pointer-events-auto absolute top-3 z-(--z-overlay) flex items-center gap-1 rounded-chip py-0.5 pr-0.5 pl-2.5 text-xs text-fg"
        style={{ left: x + 12 }}
      >
        <span className={cn(!canEdit && !proposal && 'pr-2')}>Variante {number}</span>
        {proposal && (
          <button
            type="button"
            aria-pressed={noteOpen}
            aria-label="Antwort der KI"
            title={noteOpen ? 'Antwort der KI schließen' : 'Antwort der KI wieder öffnen'}
            disabled={!resolveNote}
            onClick={() => resolveNote?.(proposal.id, !noteOpen)}
            className={cn(
              'flex items-center rounded-badge p-1 transition-colors enabled:hover:bg-hover',
              noteOpen && 'bg-hover',
            )}
          >
            <Avatar author={aiAuthor} size={18} nativeTitle={false} />
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={use}
            disabled={editing.busy}
            title="Statt der Folie verwenden"
            className="flex items-center gap-1 rounded-badge px-2 py-1 text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-50"
          >
            <Icon name="compareArrows" size="sm" />
            Verwenden
          </button>
        )}
      </div>
      {proposal && noteOpen && (
        <div
          data-variant-note
          // At the bottom of the variant: clear of its title.
          className="pointer-events-auto absolute bottom-3 z-(--z-overlay)"
          style={{ left: x + 12, width: Math.min(320, w - 24) }}
        >
          <AiProposalCard
            proposal={proposal}
            onResolve={resolveNote ? (done) => resolveNote(proposal.id, !done) : undefined}
          />
        </div>
      )}
    </>
  );
});

/**
 * On the slides' track, bottom left over a slide with a variant whose AI answer nobody has
 * closed yet: the AI's avatar and „Variante n“ – a click shows that variant's track, the
 * answer open on it. So the answer is found after a reload too, not only by the track dots.
 */
export const VariantNoteHint = memo(function VariantNoteHint({
  slideId,
  x,
  h,
}: {
  slideId: string;
  x: number;
  h: number;
}) {
  const { deck, aiAuthor, variantsOf } = useViewerData();
  const pageOf = usePageOf();
  // None without variant tracks (phones): nowhere to go.
  const dots = useTrackDots();
  const variants = variantsOf.get(slideId) ?? [];
  const pages = variants.map((variant) => pageOf(variant.id));
  const { data: proposals } = useAiProposals(
    deck.id,
    pages.some((pageId) => pageId?.startsWith('ai')),
  );
  const found = pages
    .map((pageId, at) => {
      const proposal = pageId
        ? proposals?.find(
            (item) =>
              item.commentId === null &&
              item.status === 'applied' &&
              madeByProposal(pageId, item.id),
          )
        : undefined;
      return proposal && proposal.resolvedAt === null ? { number: at + 1 } : null;
    })
    .find((item) => item !== null);
  if (!found || !dots) return null;
  return (
    <button
      type="button"
      data-variant-hint={slideId}
      onClick={() => dots.go(-found.number)}
      title="Antwort der KI zur Variante zeigen"
      className="glass-dark pointer-events-auto absolute z-(--z-overlay) flex items-center gap-1.5 rounded-chip py-0.5 pr-2.5 pl-0.5 text-xs whitespace-nowrap text-fg transition-colors hover:bg-hover"
      // Bottom left: the top holds the slide's own badges (hidden, changed) and who is on it.
      style={{ left: x + 12, top: h - 12, translate: '0 -100%' }}
    >
      <Avatar author={aiAuthor} size={18} nativeTitle={false} />
      Variante {found.number}
      <Icon name="expandLess" size="sm" className="text-fg-muted" />
    </button>
  );
});

/**
 * On the variant track over a slide's last variant: a slide-sized „Variante erstellen“ – the
 * slide's right-click „Variante erstellen“ brings it into view and opens it, so both are one. With
 * the AI at hand it opens a field right there for what the variant should be („dunkler, Bild
 * rechts“): typed, the AI makes the variant so (the tile shows it at work until the variant is
 * in); left empty, the variant is a copy of the slide at once, opened to work on by hand – as
 * without the AI.
 */
export const VariantGhost = memo(function VariantGhost({
  slideId,
  x,
  w,
  h,
}: {
  slideId: string;
  x: number;
  w: number;
  h: number;
}) {
  const editing = useEditing();
  const { deck } = useViewerData();
  const ai = useAskAi();
  const copy = useVariantCopy();
  const request = useVariantRequest(slideId);
  const { prompt, setPrompt, typed, submit: send, pending } = useVariantAsk(slideId);
  const { open, setOpen, close, wrapperRef, triggerProps, panelId } = usePopover({
    hasPopup: 'dialog',
  });
  const working = !!request || pending;
  // Always fetched: a variant taken back leaves its card here (below).
  const { data: proposals } = useAiProposals(deck.id);
  const running = proposals?.find(
    (item) => item.id === request?.proposalId && item.status === 'running',
  );
  const card = !!running && w >= 240;
  // A variant of this slide the AI made and someone took back: its card stays where the variant
  // was – „Wieder anwenden“ brings the same variant back (the change applied again, as in a
  // thread) – until someone marks it done, for everyone. The latest one (the list is newest first).
  const taken = proposals?.find(
    (item) => item.slideId === slideId && item.commentId === null && item.status === 'reverted',
  );
  const resolveNote = useResolveNote();
  const takenCard = !!taken && taken.resolvedAt === null && !working && w >= 240;

  // Asked for from the slide's right-click menu: open, once the menu has let go of the focus.
  const prompted = useVariantPrompted(slideId);
  useEffect(() => {
    if (!prompted) return;
    setVariantPrompt(null);
    // Not cancelled with the next render – the one this very call makes.
    if (!working) requestAnimationFrame(() => setOpen(true));
  }, [prompted, working, setOpen]);

  const submit = () => {
    close();
    send();
  };

  return (
    <div ref={wrapperRef} className="absolute top-0" style={{ left: x, width: w, height: h }}>
      <button
        type="button"
        {...triggerProps}
        // Without the AI: a copy at once, as ever.
        onClick={ai.available ? triggerProps.onClick : () => copy(slideId)}
        data-variant-ghost={slideId}
        disabled={editing.busy || working}
        aria-label={working ? 'Die KI erstellt die Variante' : 'Variante erstellen'}
        className="flex size-full flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-handle px-4 text-sm text-fg-muted transition-colors enabled:hover:border-border-focus enabled:hover:bg-surface-1 enabled:hover:text-fg"
      >
        {!card && !takenCard && !open && (
          <>
            {working ? (
              <Spinner size="xl" label="Die KI erstellt die Variante" />
            ) : (
              <Icon name="addCircle" size="xl" />
            )}
            {w >= 160 && (working ? 'Variante wird erstellt …' : 'Variante erstellen')}
            {w >= 160 && request && (
              <span className="line-clamp-2 text-xs text-fg-subtle">{request.prompt}</span>
            )}
          </>
        )}
      </button>
      {/* At work: the card a thread shows – what it does now, its latest drawing, „abbrechen“. */}
      {card && running && (
        <div
          data-variant-working={slideId}
          className="absolute inset-3 z-(--z-overlay) flex flex-col overflow-y-auto"
        >
          {/* Centred while it fits, scrolled from its top once it does not. */}
          <div className="my-auto flex flex-col gap-2">
            <p className="line-clamp-2 px-1 text-xs text-fg-muted">{request?.prompt}</p>
            <AiProposalCard proposal={running} />
          </div>
        </div>
      )}
      {takenCard && !open && (
        <div
          data-variant-taken={slideId}
          className="pointer-events-none absolute inset-3 z-(--z-overlay) flex flex-col overflow-y-auto"
        >
          <div className="pointer-events-auto my-auto flex flex-col gap-2">
            <p className="line-clamp-2 px-1 text-xs text-fg-muted">{taken.prompt}</p>
            <AiProposalCard
              proposal={taken}
              onResolve={resolveNote ? (done) => resolveNote(taken.id, !done) : undefined}
            />
          </div>
        </div>
      )}
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Variante erstellen"
          data-variant-prompt={slideId}
          className="absolute inset-0 z-(--z-overlay) flex flex-col gap-2 rounded-panel border border-border-focus bg-surface-1 p-3"
        >
          <div className="field-well focus-field min-h-0 flex-1 overflow-y-auto rounded-control-sm px-3 py-2">
            <AutosizeTextarea
              autoFocus
              aria-label="Was soll anders sein?"
              placeholder="Was soll anders sein? z. B. dunkler, mit Bild rechts"
              maxLength={4_000}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                // ↵ creates, ⇧↵ is a new line – as in the comments.
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              className="text-xs leading-5 text-fg"
            />
          </div>
          <Button
            size="sm"
            variant="primary"
            icon={typed ? 'autoAwesome' : 'difference'}
            onClick={submit}
          >
            {typed ? 'Mit KI erstellen' : 'Kopie erstellen'}
          </Button>
        </div>
      )}
    </div>
  );
});

/** The formatting buttons under the notes, as the slide text's (`StyleControls`). */
const NOTES_LOOKS = [
  { command: 'bold', icon: 'formatBold', label: 'Fett (⌘B)' },
  { command: 'italic', icon: 'formatItalic', label: 'Kursiv (⌘I)' },
  { command: 'underline', icon: 'formatUnderlined', label: 'Unterstrichen (⌘U)' },
  { command: 'strikeThrough', icon: 'formatStrikethrough', label: 'Durchgestrichen (⌘⇧X)' },
] as const;
const NOTES_LISTS = [
  { command: 'insertUnorderedList', icon: 'formatListBulleted', label: 'Aufzählung (⌘⇧8)' },
  { command: 'insertOrderedList', icon: 'formatListNumbered', label: 'Nummerierung (⌘⇧7)' },
] as const;
type NotesCommand =
  | (typeof NOTES_LOOKS)[number]['command']
  | (typeof NOTES_LISTS)[number]['command']
  | 'indent'
  | 'outdent';

/** Which formatting the text at the caret has – the buttons show it lit. */
function notesFormatting(): Record<string, boolean> {
  const state = (command: string) => {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };
  return Object.fromEntries(
    [...NOTES_LOOKS, ...NOTES_LISTS].map(({ command }) => [command, state(command)]),
  );
}

/**
 * The notes track under one slide: its speaker notes, as big as the slide, typed right there –
 * bold, italic, underlined, struck through, in lists (the buttons under it, the slide text's
 * shortcuts). Saved shortly after the last key and when the field is left; what someone else
 * saves meanwhile shows while it is not being typed in.
 */
export const SlideNotes = memo(function SlideNotes({
  slideId,
  index,
  x,
  w,
  h,
}: {
  slideId: string;
  index: number;
  x: number;
  w: number;
  h: number;
}) {
  const editing = useEditing();
  const own = editing.state?.slides.find((item) => item.slideId === slideId);
  const plain = own?.notes ?? '';
  const rich = own?.notesRich;
  const saved = useMemo(() => rich ?? notesFromText(plain), [rich, plain]);
  const pageId = own?.pageId;
  const field = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  /** Typed and not saved yet (or saved and not back from the server yet). */
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const [empty, setEmpty] = useState(saved.length === 0);
  const [formatting, setFormatting] = useState<Record<string, boolean>>({});

  // What the deck has, while it is not being typed in.
  useEffect(() => {
    const node = field.current;
    if (!node || focused.current || dirty.current) return;
    node.innerHTML = notesToHtml(saved);
    setEmpty(saved.length === 0);
  }, [saved]);

  const save = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const node = field.current;
    if (!node || !pageId) return;
    const paragraphs = notesFromDom(node);
    if (JSON.stringify(paragraphs) === JSON.stringify(saved)) {
      dirty.current = false;
      return;
    }
    void editing
      .apply([{ type: 'setSlideNotes', pageId, text: notesText(paragraphs), paragraphs }], {
        coalesce: `notes:${pageId}`,
      })
      // The server has it (or refused it): left, the field shows what the deck has again.
      .then(() => {
        if (!focused.current) dirty.current = false;
      });
  };
  const changed = () => {
    dirty.current = true;
    setEmpty(!field.current?.textContent && !field.current?.querySelector('li'));
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, NOTES_SAVE_MS);
  };
  const run = (command: NotesCommand) => {
    const node = field.current;
    if (!node || !pageId) return;
    if (document.activeElement !== node) node.focus();
    // Tags (`<b>`, `<i>`), not styled spans: what `notesFromDom` reads.
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(command);
    setFormatting(notesFormatting());
    changed();
  };
  const inList = formatting.insertUnorderedList || formatting.insertOrderedList;

  useEffect(() => {
    const follow = () => {
      if (focused.current) setFormatting(notesFormatting());
    };
    document.addEventListener('selectionchange', follow);
    return () => {
      document.removeEventListener('selectionchange', follow);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <div
      data-slide-notes={slideId}
      className="absolute top-0 flex flex-col overflow-hidden rounded-panel border border-hairline bg-surface-1 transition-colors focus-within:border-border-focus"
      style={{ left: x, width: w, height: h }}
    >
      <div
        ref={field}
        role="textbox"
        aria-multiline
        aria-label={`Notizen zu Folie ${index + 1}`}
        aria-disabled={!pageId || undefined}
        contentEditable={!!pageId}
        suppressContentEditableWarning
        spellCheck
        data-placeholder="Notizen für den Vortrag …"
        onFocus={() => {
          focused.current = true;
          setFormatting(notesFormatting());
        }}
        onInput={changed}
        onPaste={(event) => {
          // Its text only: formatting from elsewhere would show here and not in the file.
          event.preventDefault();
          document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
        }}
        onBlur={() => {
          focused.current = false;
          setFormatting({});
          if (dirty.current) save();
        }}
        onKeyDown={(event) => {
          // Esc leaves the field as it is (saved), as everywhere in the editor.
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.currentTarget.blur();
            return;
          }
          const mod = event.metaKey || event.ctrlKey;
          const key = event.key.toLowerCase();
          const command: NotesCommand | null =
            mod && event.shiftKey && key === 'x'
              ? 'strikeThrough'
              : mod && event.shiftKey && (key === '8' || event.code === 'Digit8')
                ? 'insertUnorderedList'
                : mod && event.shiftKey && (key === '7' || event.code === 'Digit7')
                  ? 'insertOrderedList'
                  : mod && !event.shiftKey && (key === 'b' || key === 'i' || key === 'u')
                    ? ({ b: 'bold', i: 'italic', u: 'underline' } as const)[key]
                    : // In a list, ⇥ and ⇧⇥ change its level (as on the slide).
                      event.key === 'Tab' && inList
                      ? event.shiftKey
                        ? 'outdent'
                        : 'indent'
                      : null;
          if (!command) return;
          event.preventDefault();
          event.stopPropagation();
          run(command);
        }}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-5 py-4 text-base leading-relaxed whitespace-pre-wrap text-fg outline-none',
          '[&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ul_ul]:list-[circle]',
          empty &&
            'before:pointer-events-none before:absolute before:text-fg-faint before:content-[attr(data-placeholder)]',
        )}
      />
      <div
        role="toolbar"
        aria-label="Notizen formatieren"
        className="flex shrink-0 items-center gap-1 border-t border-hairline px-3 py-1.5"
        // A click on a button keeps the text's selection.
        onMouseDown={(event) => event.preventDefault()}
      >
        {NOTES_LOOKS.map((item) => (
          <IconButton
            key={item.command}
            icon={item.icon}
            label={item.label}
            size="compact"
            disabled={!pageId}
            active={!!formatting[item.command]}
            onClick={() => run(item.command)}
          />
        ))}
        <Divider />
        {NOTES_LISTS.map((item) => (
          <IconButton
            key={item.command}
            icon={item.icon}
            label={item.label}
            size="compact"
            disabled={!pageId}
            active={!!formatting[item.command]}
            onClick={() => run(item.command)}
          />
        ))}
        <IconButton
          icon="formatIndentDecrease"
          label="Ebene höher (⇧⇥)"
          size="compact"
          disabled={!pageId || !inList}
          onClick={() => run('outdent')}
        />
        <IconButton
          icon="formatIndentIncrease"
          label="Ebene tiefer (⇥)"
          size="compact"
          disabled={!pageId || !inList}
          onClick={() => run('indent')}
        />
      </div>
    </div>
  );
});
