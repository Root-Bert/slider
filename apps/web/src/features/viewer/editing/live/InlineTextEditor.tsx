import {
  MAX_ELEMENT_TEXT,
  type LiveElement,
  type LiveParagraph,
  type SlideOperation,
} from '@slider/shared';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { listLabels, typedParagraphs } from '@slider/shared/live-text';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { useEditing } from '../editing-context';
import {
  commonLineSpacing,
  commonList,
  commonOf,
  formatRange,
  listOf,
  paragraphRange,
  paragraphsIn,
  richFromLive,
  styleAt,
  styleOf,
  TEXT_TOOLBAR_ATTR,
  type ParagraphPatch,
  type TextRange,
  type TextStylePatch,
} from './model';
import { paragraphCss, textCss } from './css';
import { fontsLoaded, loadFonts } from './fonts';
import { Bullet } from './render';
import { SharedText } from './shared-text';
import { useClicksReachText } from './useClicksReachText';
import { RemoteCarets } from './RemoteCarets';
import { typedAhead } from '../typed-ahead';
import { caretAt, directedRangeOf, ordered, parse, rangeOf, select } from './editor-dom';

/*
 * Typing in a live element on its slide (the live editor). The text is the browser's while one
 * types (input methods, spell checking and the caret work as everywhere); after each change it
 * is read back into paragraphs of runs. When the browser made something the slide cannot hold –
 * a paragraph split or joined, a bullet lost, text outside a run – the paragraphs are drawn
 * anew and the caret put back. Formatting works on that model too. What was typed is written
 * when one leaves the text (or stops typing for a while).
 *
 * The text is a shared one from the first key (`SharedText`): what is typed here goes into it as
 * it is read back – at once, joining the others happens alongside – what the others type draws
 * the text anew with the caret kept on its characters, and their carets show in it. ⌘Z takes
 * back only what was typed here.
 */

const IDLE_WRITE_MS = 2500;
/** What this editor wrote last, once the others changed the text since: no text is that. */
const CHANGED_SINCE = '\u0000';
/** Said when typing or pasting would make the text longer than an element holds. */
const TOO_LONG = 'Mehr Text passt nicht in ein Element.';

/** Characters of the paragraphs' runs (what `MAX_ELEMENT_TEXT` counts). */
const textLength = (paragraphs: readonly LiveParagraph[]) =>
  paragraphs.reduce((n, p) => n + p.runs.reduce((m, run) => m + run.text.length, 0), 0);

function EditableParagraph({
  paragraph,
  index,
  label,
}: {
  paragraph: LiveParagraph;
  index: number;
  label: string | null;
}) {
  const runs = paragraph.runs.filter((run) => run.text);
  const endsWithBreak = runs.at(-1)?.text.endsWith('\n') ?? false;
  return (
    <p
      data-live-paragraph=""
      data-p={index}
      data-align={paragraph.align}
      style={paragraphCss(paragraph, index === 0)}
    >
      <Bullet paragraph={paragraph} label={label} />
      {runs.map((run, i) => (
        <span key={i} data-style={JSON.stringify(styleOf(run))} style={textCss(run, paragraph)}>
          {run.text}
        </span>
      ))}
      {runs.length === 0 ? (
        <span
          data-style={JSON.stringify(paragraph.mark)}
          style={textCss(paragraph.mark, paragraph)}
        >
          <br />
        </span>
      ) : (
        endsWithBreak && <br data-sentinel="" />
      )}
    </p>
  );
}

const serialize = (paragraphs: readonly LiveParagraph[]) =>
  JSON.stringify(richFromLive(paragraphs));

/** A grown box off by less than this (of the slide) keeps its height in the file. */
const GROWN_TOLERANCE = 0.001;

/** No character, one line: an empty placeholder typed in still shows its prompt. */
const blank = (paragraphs: readonly LiveParagraph[]) =>
  paragraphs.length <= 1 && textLength(paragraphs) === 0;

/**
 * `prompt`: what the empty placeholder typed in asks for (`PromptText`) – shown under the caret,
 * where the text goes, until the first character.
 */
export function InlineTextEditor({
  elementId,
  live,
  prompt: promptGiven = null,
}: {
  elementId: string;
  live: LiveElement;
  prompt?: ReactNode;
}) {
  const editing = useEditing();
  const { apply, setTextEditor } = editing;
  const { deck } = useViewerData();
  const toast = useViewerToast();
  // Where the click that started typing was: the caret goes there.
  const [startAt] = useState(editing.textCaret);
  // The text as typing began: its fonts are waited for.
  const [begun] = useState(live);
  // As typing began: emptied again (deleted back), the placeholder asks for its text again.
  const [prompt] = useState(promptGiven);
  const promptRef = useRef<HTMLDivElement>(null);
  // The look of each paragraph as last drawn: a paragraph read back takes the look of the one it
  // came from (`data-p`).
  const templates = useRef(live.paragraphs);
  const [initial] = useState(() => typedParagraphs(live));
  // The paragraphs as typed (read back after each change) …
  const model = useRef<LiveParagraph[]>(initial);
  /** The prompt shown while nothing is typed – set on the node: typing does not re-render. */
  const showPrompt = () => {
    if (promptRef.current) promptRef.current.style.display = blank(model.current) ? '' : 'none';
  };
  // … and as last drawn: typing changes the DOM, not this.
  const [drawn, setDrawn] = useState({ version: 0, paragraphs: initial });
  const version = drawn.version;
  const written = useRef<string | null>(null);
  // Changed by this editor (typing, formatting, ⌘Z) since it last wrote: only then does it write.
  // Typed in together, what the others typed comes with it (the text as merged) – and each of them
  // writes after their own typing, so the last one to type writes all of it.
  const ownChange = useRef(false);
  const restore = useRef<TextRange | null>(null);
  // Drawn anew from the panel's fields (font, colour): the focus stays there.
  const refocus = useRef(true);
  const range = useRef<TextRange | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // Its characters take their clicks, also where something on the stage lies over them.
  useClicksReachText(root);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The text shared with the others typing in it – also its ⌘Z (made once mounted).
  const shared = useRef<SharedText | null>(null);
  const [sharedText, setSharedText] = useState<SharedText | null>(null);

  /**
   * Writes the text into the file when this editor changed it since it last wrote. `final`: the
   * editor goes (closed, the page left) – otherwise a write waits while the editor is away from
   * the shared text (the stream dropped): it joins again bringing this text itself, and writes it
   * merged then (`merged`) – written now as well, the server would merge it in a second time.
   */
  const write = (final = false) => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    if (!ownChange.current) return;
    if (!final && shared.current?.away) return;
    const next = serialize(model.current);
    if (written.current === null || next === written.current) return;
    ownChange.current = false;
    written.current = next;
    const operations: SlideOperation[] = [
      // Joined: what was typed in the shared text, which the server does not write back into it.
      // Typed alone (offline, not joined): merged into the shared text there.
      {
        type: 'setRichText',
        elementId,
        paragraphs: richFromLive(model.current),
        typed: shared.current?.joined ?? false,
      },
    ];
    // A box that grows with its text keeps the height it is drawn at in the file: the file's,
    // or more once its text outgrew that.
    const element = editing.selectedElement;
    const box = root.current?.closest<HTMLElement>('[data-live-element]');
    const layer = root.current?.closest<HTMLElement>('[data-live-host]');
    if (live.autoGrow && element?.id === elementId && element.resizable && box && layer) {
      const height = box.offsetHeight / Math.max(1, layer.offsetHeight);
      if (Math.abs(height - element.bbox.h) > GROWN_TOLERANCE) {
        operations.push({ type: 'setBox', elementId, box: { ...element.bbox, h: height } });
      }
    }
    void apply(operations, { coalesce: `text:${elementId}` });
  };
  const writeRef = useRef(write);
  // A composition's end lets what the others typed in – a moment later (`onCompositionEnd`).
  const released = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Writes once typing paused (`IDLE_WRITE_MS`). */
  const writeLater = () => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => writeRef.current(), IDLE_WRITE_MS);
  };
  const writeLaterRef = useRef(writeLater);
  // The page closed before typing paused: written at once – only this editor writes what it typed
  // (the others don't), and the outbox keeps it for the next visit if it can't go out now.
  useEffect(() => {
    const onHide = (event: PageTransitionEvent) => {
      // Kept for coming back (the back-forward cache) while away: it joins again then and
      // brings this text itself – written now as well, it would be merged in twice.
      if (event.persisted && shared.current?.away) return;
      writeRef.current(true);
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const redraw = (paragraphs: LiveParagraph[]) => {
    refocus.current = document.activeElement === root.current;
    shared.current?.change(paragraphs);
    // The caret on its characters at once: what the others type before the selection moves (an
    // event later) would put it back where it was.
    shared.current?.setCaret(range.current);
    ownChange.current = true;
    model.current = paragraphs;
    templates.current = paragraphs;
    restore.current = range.current;
    setDrawn((current) => ({ version: current.version + 1, paragraphs }));
    publishRef.current();
    writeLater();
  };

  /**
   * One step of what was typed here back (⌘Z) or forth (⇧⌘Z); `false` when there is none. The
   * shared text draws it anew, as by another hand – but it is this editor's change, so it writes.
   */
  const step = (direction: 'undo' | 'redo'): boolean => {
    if (!shared.current?.step(direction)) return false;
    ownChange.current = true;
    writeLater();
    return true;
  };

  /**
   * ⌘Z / ⇧⌘Z while typing: a step of the text; with none left, the editor's own undo – the text
   * lets go first, so it shows what that brings back.
   */
  const undoOrRedo = (direction: 'undo' | 'redo') => {
    if (step(direction)) return;
    const can = direction === 'undo' ? editing.canUndo : editing.canRedo;
    if (!can) return;
    // What was typed goes first – written as the editor closes, it would land over the undo.
    write(true);
    editing.select(null);
    if (direction === 'undo') editing.undo();
    else editing.redo();
  };

  /** A change from the panel or a shortcut: a step of its own for ⌘Z. */
  const change = (paragraphs: LiveParagraph[]) => {
    shared.current?.endStep();
    redraw(paragraphs);
    shared.current?.endStep();
  };

  /** The text before formats were tried on it (`tryFormat`), while they are. */
  const tried = useRef<LiveParagraph[] | null>(null);
  const tryFormat = (patch: TextStylePatch | null) => {
    const before = tried.current;
    if (!patch) {
      if (!before) return;
      tried.current = null;
      // Taken back as one step that never was – else drawn back as it was.
      if (shared.current?.dropStep()) {
        ownChange.current = true;
        writeLater();
      } else if (!shared.current) redraw(before);
      return;
    }
    if (!before) {
      shared.current?.holdStep();
      tried.current = model.current;
    }
    redraw(formatRange(tried.current ?? model.current, range.current, patch));
  };
  const format = (patch: TextStylePatch) => {
    const before = tried.current;
    if (!before) {
      change(formatRange(model.current, range.current, patch));
      return;
    }
    // Ends the trials: the format picked, all of it one step.
    tried.current = null;
    redraw(formatRange(before, range.current, patch));
    shared.current?.endStep();
  };
  const focusText = () => {
    const node = root.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    if (range.current) select(node, range.current);
  };
  const shapeParagraphs = (patch: ParagraphPatch) =>
    change(paragraphRange(model.current, range.current, patch));

  /** Tells the panel what the caret's text looks like, and how to change it. */
  const publish = () => {
    const at = range.current?.start ?? { paragraph: 0, offset: 0 };
    const touched = paragraphsIn(model.current, range.current ?? { start: at, end: at });
    setTextEditor({
      style: styleAt(model.current, at),
      align: commonOf(touched, (paragraph) => paragraph.align),
      list: commonList(touched),
      lineSpacing: commonLineSpacing(touched),
      format,
      tryFormat,
      focus: focusText,
      paragraphs: shapeParagraphs,
    });
  };
  const publishRef = useRef(publish);

  /**
   * The shared text changed by another hand – the others typed, or ⌘Z took back what was typed
   * here: drawn as it is now, the caret where its characters went. Not written for it: whoever
   * typed it writes (⌘Z here writes in `step`).
   */
  const fromShared = () => {
    const text = shared.current;
    if (!text) return;
    const paragraphs = text.read();
    const same = serialize(paragraphs) === serialize(model.current);
    model.current = paragraphs;
    templates.current = paragraphs;
    // The same text (the join brought nothing new): nothing to draw, the caret stays put.
    if (same) return;
    // The file may say otherwise now (the others wrote theirs): the next own change writes, even
    // one that brings the text back to what this editor wrote last.
    written.current = CHANGED_SINCE;
    // Put back as it was made (backwards too); the editor keeps it in order.
    const caret = text.caretRange();
    range.current = caret ? ordered(caret) : range.current;
    refocus.current = document.activeElement === root.current;
    restore.current = caret ?? range.current;
    // Drawn now, not with React's next render: a key typed before then would be read back from
    // the text without their change, and taken for deleting it.
    flushSync(() => setDrawn((current) => ({ version: current.version + 1, paragraphs })));
    publishRef.current();
  };
  const fromSharedRef = useRef(fromShared);
  useLayoutEffect(() => {
    writeRef.current = write;
    writeLaterRef.current = writeLater;
    publishRef.current = publish;
    fromSharedRef.current = fromShared;
  });

  // The shared text, from the text typing starts with – before the first key can come (a layout
  // effect); it joins the others alongside, typing does not wait for that.
  useLayoutEffect(() => {
    const text = new SharedText(deck.id, elementId, initial, {
      changed: () => fromSharedRef.current(),
      // Typed while not joined, now merged with the others' typing: this editor writes all of it.
      merged: () => {
        ownChange.current = true;
        writeLaterRef.current();
      },
      beforeRemote: () => {
        const node = root.current;
        if (node && document.activeElement === node) text.setCaret(directedRangeOf(node));
      },
    });
    shared.current = text;
    setSharedText(text);
    return () => {
      // The last write while it is still joined (or not): `typed` says which.
      writeRef.current(true);
      text.destroy();
      shared.current = null;
    };
  }, [deck.id, elementId, initial]);

  // Drawn anew (`redraw`, the others' typing): the prompt as the text is now.
  useLayoutEffect(showPrompt);

  // Drawn anew (keyed by `version`): focus and the caret come back.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    written.current ??= serialize(model.current);
    if (!refocus.current && version > 0) {
      // The selection is kept for the next change from the panel.
      range.current = restore.current ? ordered(restore.current) : range.current;
      restore.current = null;
      return;
    }
    if (version === 0 && !restore.current) {
      // The caret goes in once the text lays out as it stays: in its own fonts, and after the
      // box has fitted it (its effect runs after this one). Unfocused until then: no caret.
      let gone = false;
      const place = () => {
        if (gone) return;
        const selection = node.ownerDocument.getSelection();
        // Clicked into meanwhile: the browser's caret stays.
        if (!node.contains(selection?.anchorNode ?? null)) {
          node.focus({ preventScroll: true });
          if (!(startAt && caretAt(node, startAt))) {
            // Without a click in the text, typing starts at its end.
            const last = model.current.length - 1;
            const end = {
              paragraph: last,
              offset: (model.current[last]?.runs ?? []).reduce((n, run) => n + run.text.length, 0),
            };
            select(node, { start: end, end });
          }
          // Typed before the element was there (a new frame): typed on here, as by hand.
          const ahead = typedAhead.take(elementId);
          if (ahead) document.execCommand('insertText', false, ahead);
        }
        range.current = rangeOf(node);
      };
      if (fontsLoaded(begun)) queueMicrotask(place);
      else void loadFonts(begun).then(() => requestAnimationFrame(place));
      return () => {
        gone = true;
      };
    }
    node.focus({ preventScroll: true });
    if (restore.current) select(node, restore.current);
    restore.current = null;
    range.current = rangeOf(node);
  }, [version, startAt, begun, elementId]);

  // The caret's style for the panel; what was typed is written when the editor goes.
  useEffect(() => {
    const onSelection = () => {
      const node = root.current;
      if (!node || !node.contains(node.ownerDocument.getSelection()?.anchorNode ?? null)) return;
      range.current = rangeOf(node);
      shared.current?.setCaret(directedRangeOf(node));
      publishRef.current();
    };
    document.addEventListener('selectionchange', onSelection);
    publishRef.current();
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      setTextEditor(null);
    };
  }, [setTextEditor]);

  const onInput = () => {
    const node = root.current;
    if (!node) return;
    const parsed = parse(node, templates.current);
    // More than the file holds for an element: the text stays as it was.
    if (textLength(parsed.paragraphs) > MAX_ELEMENT_TEXT) {
      toast(TOO_LONG, 'neutral');
      redraw(model.current);
      return;
    }
    range.current = rangeOf(node);
    // A paragraph more or less in a numbered list: the numbers after it count anew.
    const renumber =
      parsed.paragraphs.length !== model.current.length &&
      parsed.paragraphs.some((paragraph) => paragraph.bullet?.number);
    if (parsed.dirty || renumber) redraw(parsed.paragraphs);
    else {
      shared.current?.change(parsed.paragraphs);
      // The caret after the key at once (see `redraw`), as the browser has it.
      shared.current?.setCaret(directedRangeOf(node));
      ownChange.current = true;
      model.current = parsed.paragraphs;
      publish();
      writeLater();
    }
    showPrompt();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The selection as it is now: the browser tells of a move (⇧ and an arrow) only a moment later.
    if (root.current) range.current = rangeOf(root.current) ?? range.current;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // Takes the text as it is and lets the element go, like ⌘↵.
      write();
      editing.select(null);
      return;
    }
    if (mod && key === 'z') {
      event.preventDefault();
      event.stopPropagation();
      undoOrRedo(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      // In a list ⇧⇥ takes a level out, ⇥ at a line's start (or over lines) one in – as in
      // PowerPoint; anywhere else ⇥ is a tab.
      const at = range.current;
      const listed = at && paragraphsIn(model.current, at).some((p) => listOf(p));
      const atStart =
        at &&
        (at.start.paragraph !== at.end.paragraph || (at.start.offset === 0 && !at.end.offset));
      if (listed && (event.shiftKey || atStart))
        shapeParagraphs({ levelBy: event.shiftKey ? -1 : 1 });
      else document.execCommand('insertText', false, '\t');
      return;
    }
    // ⌘⇧X strikes through, ⌘⇧7 and ⌘⇧8 number and bullet the lines (as in Google Slides).
    const code = event.code;
    if (mod && event.shiftKey && (code === 'KeyX' || code === 'Digit7' || code === 'Digit8')) {
      event.preventDefault();
      const at = range.current?.start ?? { paragraph: 0, offset: 0 };
      if (code === 'KeyX') {
        format({ strike: !styleAt(model.current, at).strike });
        return;
      }
      const kind = code === 'Digit7' ? 'number' : 'bullet';
      const touched = paragraphsIn(model.current, range.current ?? { start: at, end: at });
      shapeParagraphs({ list: commonList(touched) === kind ? null : kind });
      return;
    }
    if (mod && (key === 'b' || key === 'i' || key === 'u')) {
      event.preventDefault();
      const at = range.current?.start ?? { paragraph: 0, offset: 0 };
      const style = styleAt(model.current, at);
      const name = key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline';
      format({ [name]: !style[name] });
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    // Line and paragraph separators are line breaks here, as the slide has them.
    const pasted = event.clipboardData.getData('text/plain').replace(/\r\n?|[\u2028\u2029]/g, '\n');
    // As much as still fits into the element (what the selection replaces is room too).
    const selected = window.getSelection()?.toString().length ?? 0;
    const room = Math.max(0, MAX_ELEMENT_TEXT - textLength(model.current) + selected);
    if (pasted.length > room) toast(TOO_LONG, 'neutral');
    const text = pasted.slice(0, room);
    if (text) document.execCommand('insertText', false, text);
  };

  // Drawn once per version: React leaves what the browser typed alone in between.
  const content = useMemo(() => {
    const labels = listLabels(drawn.paragraphs);
    return drawn.paragraphs.map((paragraph, i) => (
      <EditableParagraph key={i} paragraph={paragraph} index={i} label={labels[i] ?? null} />
    ));
  }, [drawn]);

  return (
    // Positioned: the others' carets lie over the text. A prompt lies in the same cell, under it.
    <div
      style={
        prompt
          ? { position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)' }
          : { position: 'relative' }
      }
    >
      {prompt && (
        <div
          ref={promptRef}
          aria-hidden
          data-live-prompt-typing=""
          style={{
            gridArea: '1 / 1',
            pointerEvents: 'none',
            userSelect: 'none',
            ...(blank(initial) ? {} : { display: 'none' }),
          }}
        >
          {prompt}
        </div>
      )}
      <div
        key={version}
        ref={root}
        data-live-text=""
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline
        aria-label="Text der Folie"
        className="cursor-text outline-none"
        style={prompt ? { gridArea: '1 / 1' } : undefined}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={(event) => event.preventDefault()}
        // Composing a character: what the others type waits, so the composition is not drawn over.
        onCompositionStart={() => {
          // Composing again right away (some input methods do): what waits keeps waiting.
          if (released.current) clearTimeout(released.current);
          released.current = null;
          shared.current?.hold('composing');
        }}
        // After the browser's last input of the composition.
        onCompositionEnd={() => {
          released.current = setTimeout(() => {
            released.current = null;
            shared.current?.release('composing');
          }, 0);
        }}
        // Selecting with the mouse: what the others type waits, the text is not drawn anew under
        // the pointer.
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          shared.current?.hold('selecting');
          const up = () => {
            window.removeEventListener('pointerup', up, true);
            window.removeEventListener('pointercancel', up, true);
            shared.current?.release('selecting');
          };
          window.addEventListener('pointerup', up, true);
          window.addEventListener('pointercancel', up, true);
        }}
        onBeforeInput={(event) => {
          // The browser's own formatting (menus, shortcuts) would write markup the slide cannot hold.
          const type = (event.nativeEvent as InputEvent).inputType;
          if (type?.startsWith('format')) event.preventDefault();
          // The browser's own undo (Edit menu) knows nothing of what was drawn anew: ours.
          if (type === 'historyUndo' || type === 'historyRedo') {
            event.preventDefault();
            undoOrRedo(type === 'historyUndo' ? 'undo' : 'redo');
          }
        }}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Element && next.closest(`[${TEXT_TOOLBAR_ATTR}]`)) return;
          write();
        }}
      >
        {content}
      </div>
      {sharedText && <RemoteCarets text={sharedText} root={root} version={version} />}
    </div>
  );
}
