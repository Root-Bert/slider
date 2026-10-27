import type { LiveElement, LiveParagraph, LiveRun, LiveTextStyle } from '@slider/shared';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { useEditing } from '../editing-context';
import {
  alignRange,
  formatRange,
  normalizeRuns,
  richFromLive,
  styleAt,
  styleOf,
  type TextPoint,
  TEXT_TOOLBAR_ATTR,
  type TextRange,
} from './model';
import { paragraphCss, textCss } from './css';
import { fontsLoaded, loadFonts } from './fonts';
import { Bullet } from './render';

/*
 * Typing in a live element on its slide (the live editor). The text is the browser's while one
 * types (input methods, spell checking and the caret work as everywhere); after each change it
 * is read back into paragraphs of runs. When the browser made something the slide cannot hold –
 * a paragraph split or joined, a bullet lost, text outside a run – the paragraphs are drawn
 * anew and the caret put back. Formatting works on that model too. What was typed is written
 * when one leaves the text (or stops typing for a while).
 */

const IDLE_WRITE_MS = 2500;
/** Typing after a pause this long (ms) is a step of its own for ⌘Z. */
const TYPING_STEP_MS = 1000;

/** The text and where the caret was – one step back or forth for ⌘Z / ⇧⌘Z. */
interface TextStep {
  paragraphs: LiveParagraph[];
  range: TextRange | null;
}

const ZWSP = new RegExp(String.fromCharCode(0x200b), 'g');

const readStyle = (node: HTMLElement): LiveTextStyle | null => {
  const raw = node.dataset.style;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LiveTextStyle;
  } catch {
    return null;
  }
};

const isBlock = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement && ['P', 'DIV'].includes(node.tagName);

interface Parsed {
  paragraphs: LiveParagraph[];
  /** The browser changed the structure: draw the paragraphs anew. */
  dirty: boolean;
}

/** The editor's DOM read back into paragraphs, each on the look of the paragraph it came from. */
function parse(root: HTMLElement, templates: readonly LiveParagraph[]): Parsed {
  const paragraphs: LiveParagraph[] = [];
  let dirty = false;
  const blocks: Node[][] = [];
  let loose: Node[] = [];
  for (const child of root.childNodes) {
    if (isBlock(child)) {
      if (loose.length > 0) blocks.push(loose);
      loose = [];
      blocks.push([child]);
    } else {
      loose.push(child);
      dirty = true;
    }
  }
  if (loose.length > 0) blocks.push(loose);
  let lastTemplate = 0;
  for (const nodes of blocks) {
    const block = nodes.length === 1 && isBlock(nodes[0]!) ? (nodes[0] as HTMLElement) : null;
    const index = block?.dataset.p !== undefined ? Number(block.dataset.p) : lastTemplate;
    if (block?.dataset.p === undefined) dirty = true;
    lastTemplate = index;
    const template = templates[Math.min(index, templates.length - 1)] as LiveParagraph;
    const runs: LiveRun[] = [];
    let style: LiveTextStyle = template.mark;
    let lastStyle: LiveTextStyle | null = null;
    let bullets = 0;
    let breaks = 0;
    const walk = (node: Node, current: LiveTextStyle, inRun: boolean) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').replace(ZWSP, '');
        if (!text) return;
        if (!inRun) dirty = true;
        runs.push({ ...current, text });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.dataset.liveBullet !== undefined) {
        bullets += 1;
        return;
      }
      if (node.tagName === 'BR') {
        if (node.dataset.sentinel === undefined) {
          runs.push({ ...current, text: '\n' });
          breaks += 1;
        }
        return;
      }
      if (isBlock(node)) dirty = true;
      const own = readStyle(node);
      if (own) lastStyle = own;
      for (const child of node.childNodes) walk(child, own ?? current, inRun || own !== null);
    };
    for (const node of nodes) walk(node, style, false);
    if (lastStyle) style = lastStyle;
    // The browser keeps an empty line open with a <br> of its own.
    const last = runs.at(-1);
    if (last?.text === '\n' && breaks > 0) {
      runs.pop();
      if (runs.length > 0) dirty = true;
    }
    if (bullets !== (template.bullet ? 1 : 0)) dirty = true;
    const normalized = normalizeRuns(runs);
    paragraphs.push({
      ...template,
      align: (block?.dataset.align as LiveParagraph['align'] | undefined) ?? template.align,
      runs: normalized,
      mark: normalized.at(-1) ?? style,
    });
  }
  if (paragraphs.length === 0) {
    const template = templates[0] as LiveParagraph;
    paragraphs.push({ ...template, runs: [] });
    dirty = true;
  }
  return { paragraphs, dirty };
}

/** Characters before a DOM position inside a paragraph (line breaks count one). */
function charsBefore(paragraph: Node, target: Node, offset: number): number {
  let count = 0;
  let found = false;
  const visit = (node: Node) => {
    if (found) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        count += (node.textContent ?? '').slice(0, offset).replace(ZWSP, '').length;
      } else {
        for (const child of [...node.childNodes].slice(0, offset)) visit(child);
      }
      found = true;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      count += (node.textContent ?? '').replace(ZWSP, '').length;
      return;
    }
    if (!(node instanceof HTMLElement) || node.dataset.liveBullet !== undefined) return;
    if (node.tagName === 'BR') {
      if (node.dataset.sentinel === undefined) count += 1;
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const child of paragraph.childNodes) visit(child);
  return count;
}

function pointOf(root: HTMLElement, node: Node, offset: number): TextPoint | null {
  if (!root.contains(node)) return null;
  if (node === root) {
    const paragraph = Math.min(offset, Math.max(0, root.childNodes.length - 1));
    return { paragraph, offset: 0 };
  }
  let block: Node | null = node;
  while (block && block.parentNode !== root) block = block.parentNode;
  if (!block) return null;
  const paragraph = [...root.childNodes].indexOf(block as ChildNode);
  return { paragraph, offset: charsBefore(block, node, offset) };
}

function rangeOf(root: HTMLElement): TextRange | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const start = pointOf(root, range.startContainer, range.startOffset);
  const end = pointOf(root, range.endContainer, range.endOffset);
  return start && end ? { start, end } : null;
}

/** The DOM position of a text point in the drawn paragraphs. */
function domPoint(root: HTMLElement, point: TextPoint): [Node, number] {
  const block = root.children[Math.min(point.paragraph, root.children.length - 1)];
  if (!block) return [root, 0];
  let left = point.offset;
  let result: [Node, number] | null = null;
  const visit = (node: Node) => {
    if (result) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.textContent ?? '').length;
      if (left <= length) result = [node, left];
      else left -= length;
      return;
    }
    if (!(node instanceof HTMLElement) || node.dataset.liveBullet !== undefined) return;
    if (node.tagName === 'BR') {
      if (node.dataset.sentinel !== undefined) return;
      if (left === 0) {
        result = [node.parentNode as Node, [...(node.parentNode as Node).childNodes].indexOf(node)];
        return;
      }
      left -= 1;
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const child of block.childNodes) visit(child);
  if (result) return result;
  // Past the end or an empty line: into its last run.
  const runs = block.querySelectorAll('[data-style]');
  const last = runs[runs.length - 1];
  return last
    ? [
        last,
        last.childNodes.length > 0 && last.lastChild?.nodeName === 'BR'
          ? 0
          : last.childNodes.length,
      ]
    : [block, block.childNodes.length];
}

function select(root: HTMLElement, range: TextRange): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const [startNode, startOffset] = domPoint(root, range.start);
  const [endNode, endOffset] = domPoint(root, range.end);
  try {
    selection.setBaseAndExtent(startNode, startOffset, endNode, endOffset);
  } catch {
    // A position the DOM no longer has: the caret stays where the browser put it.
  }
}

/** Puts the caret at a point of the screen, if that is in the text. */
function caretAt(root: HTMLElement, point: { x: number; y: number }): boolean {
  // On the nearest line's middle, like PowerPoint: beside or below the text (the box is larger)
  // and at a line's edge the browser would put the caret at the very end.
  const lines = linesOf(root);
  const distance = (line: DOMRect) =>
    point.y < line.top ? line.top - point.y : point.y > line.bottom ? point.y - line.bottom : 0;
  // Lines set close overlap: then the one whose middle is nearer.
  const off = (line: DOMRect) => Math.abs(line.top + line.height / 2 - point.y);
  const nearest = lines.reduce<Line | null>((best, line) => {
    if (!best) return line;
    const d = distance(line.rect) - distance(best.rect);
    return d < 0 || (d === 0 && off(line.rect) < off(best.rect)) ? line : best;
  }, null);
  if (!nearest) return caretAtPoint(root, point);
  if (nearest.empty) {
    // An empty line has no text to hit: the caret goes into its run.
    root.ownerDocument.getSelection()?.collapse(nearest.empty, 0);
    return true;
  }
  const box = root.getBoundingClientRect();
  return caretAtPoint(root, {
    x: Math.min(Math.max(point.x, box.left + 1), box.right - 1),
    y: nearest.rect.top + nearest.rect.height / 2,
  });
}

type Line = { rect: DOMRect; empty: HTMLElement | null };

/**
 * The text's lines on screen: one box per line of each text node (a range over the whole text
 * would also give each paragraph's box, as high as all its lines), and each empty line's run.
 */
function linesOf(root: HTMLElement): Line[] {
  const lines: Line[] = [];
  const range = root.ownerDocument.createRange();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('[data-live-bullet]')) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width > 0) lines.push({ rect, empty: null });
    }
  }
  for (const run of root.querySelectorAll<HTMLElement>('[data-style]')) {
    if (run.textContent) continue;
    const rect = run.getBoundingClientRect();
    if (rect.height > 0) lines.push({ rect, empty: run });
  }
  return lines;
}

function caretAtPoint(root: HTMLElement, point: { x: number; y: number }): boolean {
  const doc = root.ownerDocument;
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(point.x, point.y);
    node = position?.offsetNode ?? null;
    offset = position?.offset ?? 0;
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(point.x, point.y);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }
  const selection = doc.getSelection();
  // In a text only: a hit on the box or a paragraph's padding is beside the text.
  if (!node || node.nodeType !== Node.TEXT_NODE || !selection || !root.contains(node)) return false;
  selection.collapse(node, offset);
  return true;
}

function EditableParagraph({ paragraph, index }: { paragraph: LiveParagraph; index: number }) {
  const runs = paragraph.runs.filter((run) => run.text);
  const endsWithBreak = runs.at(-1)?.text.endsWith('\n') ?? false;
  return (
    <p
      data-live-paragraph=""
      data-p={index}
      data-align={paragraph.align}
      style={paragraphCss(paragraph, index === 0)}
    >
      <Bullet paragraph={paragraph} />
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

export function InlineTextEditor({ elementId, live }: { elementId: string; live: LiveElement }) {
  const editing = useEditing();
  const { apply, setTextEditor } = editing;
  // Where the click that started typing was: the caret goes there.
  const [startAt] = useState(editing.textCaret);
  // The text as typing began: its fonts are waited for.
  const [begun] = useState(live);
  // The look of each paragraph, as it was when typing began.
  const templates = useRef(live.paragraphs.length > 0 ? live.paragraphs : []);
  const initial = live.placeholder
    ? live.paragraphs.slice(0, 1).map((p) => ({ ...p, runs: [] }))
    : live.paragraphs;
  // The paragraphs as typed (read back after each change) …
  const model = useRef<LiveParagraph[]>(initial);
  // … and as last drawn: typing changes the DOM, not this.
  const [drawn, setDrawn] = useState({ version: 0, paragraphs: initial });
  const version = drawn.version;
  const written = useRef<string | null>(null);
  const restore = useRef<TextRange | null>(null);
  // Drawn anew from the panel's fields (font, colour): the focus stays there.
  const refocus = useRef(true);
  const range = useRef<TextRange | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What typing and formatting changed, for ⌘Z / ⇧⌘Z; `typedAt`: when typing last added to a step.
  const history = useRef({ undo: [] as TextStep[], redo: [] as TextStep[], typedAt: 0 });

  const write = () => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = null;
    const next = serialize(model.current);
    if (written.current === null || next === written.current) return;
    written.current = next;
    void apply([{ type: 'setRichText', elementId, paragraphs: richFromLive(model.current) }], {
      coalesce: `text:${elementId}`,
    });
  };
  const writeRef = useRef(write);

  const redraw = (paragraphs: LiveParagraph[]) => {
    refocus.current = document.activeElement === root.current;
    model.current = paragraphs;
    restore.current = range.current;
    setDrawn((current) => ({ version: current.version + 1, paragraphs }));
    publishRef.current();
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => writeRef.current(), IDLE_WRITE_MS);
  };

  /**
   * Keeps the text as it is before a change, as a step for ⌘Z. Typing goes on in the same step
   * until it pauses; formatting is a step of its own.
   */
  const remember = (typing: boolean) => {
    const steps = history.current;
    const now = Date.now();
    steps.redo = [];
    if (typing && now - steps.typedAt < TYPING_STEP_MS) {
      steps.typedAt = now;
      return;
    }
    steps.typedAt = typing ? now : 0;
    steps.undo.push({ paragraphs: model.current, range: range.current });
  };

  /** One step back (⌘Z) or forth (⇧⌘Z); `false` when there is none. */
  const step = (direction: 'undo' | 'redo'): boolean => {
    const steps = history.current;
    const [from, to] = direction === 'undo' ? [steps.undo, steps.redo] : [steps.redo, steps.undo];
    const target = from.pop();
    if (!target) return false;
    to.push({ paragraphs: model.current, range: range.current });
    steps.typedAt = 0;
    range.current = target.range;
    redraw(target.paragraphs);
    return true;
  };

  /**
   * ⌘Z / ⇧⌘Z while typing: a step of the text; with none left, the editor's own undo – the text
   * lets go first, so it shows what that brings back.
   */
  const undoOrRedo = (direction: 'undo' | 'redo') => {
    if (step(direction)) return;
    const can = direction === 'undo' ? editing.state?.canUndo : editing.state?.canRedo;
    if (!can) return;
    editing.select(null);
    if (direction === 'undo') editing.undo();
    else editing.redo();
  };

  /** A change from the panel or a shortcut: a step of its own. */
  const change = (paragraphs: LiveParagraph[]) => {
    remember(false);
    redraw(paragraphs);
  };

  /** Tells the panel what the caret's text looks like, and how to change it. */
  const publish = () => {
    const at = range.current?.start ?? { paragraph: 0, offset: 0 };
    setTextEditor({
      style: styleAt(model.current, at),
      align: model.current[at.paragraph]?.align ?? 'left',
      format: (patch) => change(formatRange(model.current, range.current, patch)),
      alignText: (align) => change(alignRange(model.current, range.current, align)),
    });
  };
  const publishRef = useRef(publish);
  useLayoutEffect(() => {
    writeRef.current = write;
    publishRef.current = publish;
  });

  // Drawn anew (keyed by `version`): focus and the caret come back.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    written.current ??= serialize(model.current);
    if (!refocus.current && version > 0) {
      // The selection is kept for the next change from the panel.
      range.current = restore.current ?? range.current;
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
  }, [version, startAt, begun]);

  // The caret's style for the panel; what was typed is written when the editor goes.
  useEffect(() => {
    const onSelection = () => {
      const node = root.current;
      if (!node || !node.contains(node.ownerDocument.getSelection()?.anchorNode ?? null)) return;
      range.current = rangeOf(node);
      publishRef.current();
    };
    document.addEventListener('selectionchange', onSelection);
    publishRef.current();
    return () => {
      document.removeEventListener('selectionchange', onSelection);
      writeRef.current();
      setTextEditor(null);
    };
  }, [setTextEditor]);

  const onInput = () => {
    const node = root.current;
    if (!node) return;
    const parsed = parse(node, templates.current);
    // The step before: the text as it was, the caret where it was before this input.
    remember(true);
    range.current = rangeOf(node);
    if (parsed.dirty) redraw(parsed.paragraphs);
    else {
      model.current = parsed.paragraphs;
      publish();
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => writeRef.current(), IDLE_WRITE_MS);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
      document.execCommand('insertText', false, '\t');
      return;
    }
    if (mod && (key === 'b' || key === 'i' || key === 'u')) {
      event.preventDefault();
      const at = range.current?.start ?? { paragraph: 0, offset: 0 };
      const style = styleAt(model.current, at);
      const name = key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline';
      change(formatRange(model.current, range.current, { [name]: !style[name] }));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
    if (text) document.execCommand('insertText', false, text);
  };

  // Drawn once per version: React leaves what the browser typed alone in between.
  const content = useMemo(
    () =>
      drawn.paragraphs.map((paragraph, i) => (
        <EditableParagraph key={i} paragraph={paragraph} index={i} />
      )),
    [drawn],
  );

  return (
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
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onDrop={(event) => event.preventDefault()}
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
  );
}
