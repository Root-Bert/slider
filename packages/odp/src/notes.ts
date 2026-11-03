import type { NotesParagraph, NotesRun, TextList } from '@slider/shared';
import { newListStyle, type StyleSink } from './live-write';
import type { StyleIndex } from './styles';
import { inlineNodes } from './text';
import { attr, childrenOf, element, tagOf, textOf, type XmlNode } from './xml';

/*
 * Speaker notes with their formatting: bold, italic, underlined, struck through, in lists. Read
 * from the notes frame's text as LibreOffice and PowerPoint write it, written back as spans with
 * automatic text styles and lists in Slider's list styles – the notes page's font stays.
 */

type Look = Omit<NotesRun, 'text'>;
const LOOKS = ['bold', 'italic', 'underline', 'strike'] as const;

const PARAGRAPH = new Set(['text:p', 'text:h']);
const LIST_ITEMS = new Set(['text:list-item', 'text:list-header']);
/** Inline elements whose text is not part of the paragraph's. */
const NO_TEXT = new Set([
  'text:note',
  'office:annotation',
  'office:annotation-end',
  'text:ruby-text',
]);

/** What a text style says of the looks notes have (only what it sets). */
function lookOf(index: StyleIndex, family: 'text' | 'paragraph', name: string | undefined): Look {
  const style = index.style(family, name);
  if (!style) return {};
  const props = index.propertiesOf(style, 'text');
  const look: Look = {};
  const weight = props['fo:font-weight'];
  if (weight) look.bold = weight === 'bold' || Number(weight) >= 600;
  const posture = props['fo:font-style'];
  if (posture) look.italic = posture === 'italic' || posture === 'oblique';
  const underline = props['style:text-underline-style'];
  if (underline) look.underline = underline !== 'none';
  const strike = props['style:text-line-through-style'];
  if (strike) look.strike = strike !== 'none';
  return look;
}

/** Only the looks that are on – so equal runs compare equal. */
const onlyOn = (look: Look): Look =>
  Object.fromEntries(LOOKS.filter((key) => look[key]).map((key) => [key, true]));

const sameLook = (a: Look, b: Look) => LOOKS.every((key) => !!a[key] === !!b[key]);

function runsOf(index: StyleIndex, paragraph: XmlNode): NotesRun[] {
  const runs: NotesRun[] = [];
  const add = (text: string, look: Look) => {
    if (!text) return;
    const last = runs.at(-1);
    if (last && sameLook(last, look)) last.text += text;
    else runs.push({ text, ...onlyOn(look) });
  };
  const walk = (node: XmlNode, look: Look) => {
    for (const child of childrenOf(node)) {
      const text = textOf(child);
      if (text !== null) {
        add(text, look);
        continue;
      }
      const tag = tagOf(child);
      if (!tag || NO_TEXT.has(tag) || !tag.startsWith('text:')) continue;
      if (tag === 'text:s')
        add(' '.repeat(Math.max(1, Number(attr(child, 'text:c') ?? 1) || 1)), look);
      else if (tag === 'text:tab') add('\t', look);
      else if (tag === 'text:line-break') add('\n', look);
      else if (tag === 'text:span')
        walk(child, { ...look, ...lookOf(index, 'text', attr(child, 'text:style-name')) });
      else walk(child, look);
    }
  };
  walk(paragraph, lookOf(index, 'paragraph', attr(paragraph, 'text:style-name')));
  return runs;
}

/** Bullets or numbers, as the list style draws that level (bullets when it cannot be told). */
function kindAt(list: XmlNode | undefined, level: number): TextList['kind'] {
  const levels = list
    ? childrenOf(list).filter((child) => tagOf(child)?.startsWith('text:list-level-style'))
    : [];
  const own =
    levels.find((child) => Number(attr(child, 'text:level')) === level) ??
    levels.filter((child) => Number(attr(child, 'text:level')) <= level).at(-1);
  return own && tagOf(own) === 'text:list-level-style-number' ? 'number' : 'bullet';
}

/** The notes' paragraphs with their formatting; trailing empty ones left out. */
export function readNotesRich(index: StyleIndex, box: XmlNode): NotesParagraph[] {
  const out: NotesParagraph[] = [];
  const walk = (node: XmlNode, level: number, style: XmlNode | undefined) => {
    for (const child of childrenOf(node)) {
      const tag = tagOf(child);
      if (!tag) continue;
      if (PARAGRAPH.has(tag)) {
        const runs = runsOf(index, child);
        out.push(level > 0 ? { runs, list: { kind: kindAt(style, level), level } } : { runs });
      } else if (tag === 'text:list') {
        const own = index.list(attr(child, 'text:style-name')) ?? style;
        for (const item of childrenOf(child))
          if (LIST_ITEMS.has(tagOf(item) ?? '')) walk(item, Math.min(9, level + 1), own);
      }
    }
  };
  walk(box, 0, undefined);
  while (out.length > 0 && out.at(-1)!.runs.every((run) => !run.text.trim()) && !out.at(-1)!.list)
    out.pop();
  return out;
}

/** The text style of a run's looks, `null` for plain text. */
function runStyle(sink: StyleSink, run: NotesRun): string | null {
  const props: Record<string, string> = {};
  if (run.bold)
    Object.assign(props, {
      'fo:font-weight': 'bold',
      'style:font-weight-asian': 'bold',
      'style:font-weight-complex': 'bold',
    });
  if (run.italic)
    Object.assign(props, {
      'fo:font-style': 'italic',
      'style:font-style-asian': 'italic',
      'style:font-style-complex': 'italic',
    });
  if (run.underline)
    Object.assign(props, {
      'style:text-underline-style': 'solid',
      'style:text-underline-width': 'auto',
      'style:text-underline-color': 'font-color',
    });
  if (run.strike)
    Object.assign(props, {
      'style:text-line-through-style': 'solid',
      'style:text-line-through-type': 'single',
    });
  if (Object.keys(props).length === 0) return null;
  return sink.add(
    element('style:style', { 'style:family': 'text' }, [element('style:text-properties', props)]),
  );
}

function paragraphNode(sink: StyleSink, paragraph: NotesParagraph): XmlNode {
  const nodes = paragraph.runs.flatMap((run) => {
    const style = runStyle(sink, run);
    const inline = inlineNodes(run.text);
    return style ? [element('text:span', { 'text:style-name': style }, inline)] : inline;
  });
  return element('text:p', {}, nodes);
}

/**
 * The notes frame's text box `box` given `paragraphs`: neighbouring list paragraphs of one kind in
 * one list, a deeper level nested in it.
 */
export function writeNotesRich(
  sink: StyleSink,
  box: XmlNode,
  paragraphs: readonly NotesParagraph[],
): void {
  const styles = new Map<TextList['kind'], string>();
  const styleOf = (kind: TextList['kind']) => {
    const name = styles.get(kind) ?? newListStyle(sink, kind);
    styles.set(kind, name);
    return name;
  };
  const blocks: XmlNode[] = [];
  let open: { kind: TextList['kind']; list: XmlNode } | null = null;
  for (const paragraph of paragraphs) {
    const node = paragraphNode(sink, paragraph);
    const list = paragraph.list;
    if (!list) {
      blocks.push(node);
      open = null;
      continue;
    }
    if (!open || open.kind !== list.kind) {
      open = {
        kind: list.kind,
        list: element('text:list', { 'text:style-name': styleOf(list.kind) }),
      };
      blocks.push(open.list);
    }
    let item = element('text:list-item');
    childrenOf(open.list).push(item);
    for (let level = 1; level < list.level; level += 1) {
      const inner = element('text:list-item');
      childrenOf(item).push(element('text:list', {}, [inner]));
      item = inner;
    }
    childrenOf(item).push(node);
  }
  const children = childrenOf(box);
  children.splice(0, children.length, ...blocks);
}
