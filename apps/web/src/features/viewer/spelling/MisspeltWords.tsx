import type { EditableElement, LiveElement } from '@slider/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/ui';
import { liveLayerStyle, PT_PER_CM } from '../editing/live/css';
import { loadFonts } from '../editing/live/fonts';
import { LiveElementView } from '../editing/live/render';
import '../editing/live/office-fonts.css';
import { MISSPELT_AT_ATTR, MISSPELT_ELEMENT_ATTR, MISSPELT_WORD_ATTR } from './underlinable';
import { misspeltAt, type KnowsWord } from './words';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WordMark {
  key: string;
  word: string;
  elementId: string;
  /** The how-manyth time the word is misspelt in its element's text, from 0. */
  occurrence: number;
  /** Of the slide, 0–1: one per line a hyphenated word is broken over. */
  rects: Rect[];
}

/** The text nodes of a laid out text, each with where it starts in the text read whole. */
function textOf(node: Element): { text: string; nodes: { node: Text; start: number }[] } {
  const nodes: { node: Text; start: number }[] = [];
  let text = '';
  let paragraph: Element | null = null;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let next = walker.nextNode(); next; next = walker.nextNode()) {
    const textNode = next as Text;
    // Only the runs' text, as `fixWord` reads it: a bullet's label („q“ of Wingdings) would run
    // into the first word and count its occurrences apart from the text's.
    if (!textNode.parentElement?.closest('[data-live-run]')) continue;
    // A paragraph ends a word: its last one does not run on into the next.
    const own = textNode.parentElement?.closest('p') ?? null;
    if (own !== paragraph && text) text += '\n';
    paragraph = own;
    nodes.push({ node: textNode, start: text.length });
    text += textNode.data;
  }
  return { text, nodes };
}

/** Where the characters `start` to `end` of a text read whole (`textOf`) stand, as a range. */
function rangeOf(nodes: { node: Text; start: number }[], start: number, end: number): Range | null {
  const at = (offset: number, last: boolean) =>
    nodes.find(
      ({ node, start: from }) =>
        offset >= from && (last ? offset <= from + node.length : offset < from + node.length),
    );
  const from = at(start, false);
  const to = at(end, true);
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, start - from.start);
  range.setEnd(to.node, end - to.start);
  return range;
}

function measure(layer: HTMLElement, knows: KnowsWord): WordMark[] {
  const box = layer.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return [];
  const marks: WordMark[] = [];
  for (const element of layer.querySelectorAll<HTMLElement>('[data-live-element]')) {
    const text = element.querySelector('[data-live-text]');
    if (!text) continue;
    const { text: whole, nodes } = textOf(text);
    const elementId = element.dataset.liveElement!;
    const counted = new Map<string, number>();
    for (const { word, start, end } of misspeltAt(whole, knows)) {
      const occurrence = counted.get(word) ?? 0;
      counted.set(word, occurrence + 1);
      const range = rangeOf(nodes, start, end);
      if (!range) continue;
      const rects = [...range.getClientRects()]
        .filter((rect) => rect.width > 0)
        .map((rect) => ({
          x: (rect.left - box.left) / box.width,
          y: (rect.top - box.top) / box.height,
          w: rect.width / box.width,
          h: rect.height / box.height,
        }));
      if (rects.length > 0)
        marks.push({ key: `${elementId}:${start}`, word, elementId, occurrence, rects });
    }
  }
  return marks;
}

/**
 * Misspelt words underlined where they stand on the slide: the texts laid out unseen as
 * Bearbeiten draws them over LibreOffice's picture (`LiveElementView`), the words found in them
 * and a line in Slider's orange drawn under each. The pointer over one (the layer takes no pointer:
 * found by where it is) grows the line into a box around the word – a right click there:
 * the word kept or a suggestion (`useSlideContextMenu`), in review as in Bearbeiten, its elements over this layer.
 */
export function MisspeltWords({
  elements,
  pageSize,
  knows,
}: {
  elements: readonly (EditableElement & { live: LiveElement })[];
  pageSize: { width: number; height: number };
  knows: KnowsWord;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<WordMark[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);

  // Over the elements of Bearbeiten too: the pointer watched wherever it is, before they take it.
  // The layer is measured once per move, the marks found by their rects of it (the marks stand
  // in the same box).
  useEffect(() => {
    if (marks.length === 0) return;
    const onMove = ({ clientX, clientY }: PointerEvent) => {
      const box = layerRef.current?.getBoundingClientRect();
      if (!box || box.width === 0 || box.height === 0) return;
      const x = (clientX - box.left) / box.width;
      const y = (clientY - box.top) / box.height;
      const under = marks.find(({ rects }) =>
        rects.some(
          (rect) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h,
        ),
      );
      setHovered(under?.key ?? null);
    };
    const onLeave = () => setHovered(null);
    window.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('scroll', onLeave, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', onLeave, true);
    };
  }, [marks]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const update = () => setMarks(measure(layer, knows));
    update();
    // Laid out anew as the fonts come in and the slide is resized.
    let gone = false;
    void Promise.all(elements.map((element) => loadFonts(element.live))).then(
      () => !gone && update(),
    );
    const observer = new ResizeObserver(update);
    observer.observe(layer);
    return () => {
      gone = true;
      observer.disconnect();
    };
  }, [elements, knows]);

  return (
    <>
      <div
        className="invisible absolute inset-0"
        style={liveLayerStyle(pageSize.width * PT_PER_CM, pageSize.height * PT_PER_CM)}
        ref={layerRef}
      >
        {elements.map((element) => (
          <LiveElementView key={element.id} element={element} live={element.live} textOnly />
        ))}
      </div>
      <div className="contents">
        {marks.flatMap(({ key, word, elementId, occurrence, rects }) =>
          rects.map((rect, index) => (
            <div
              key={`${key}:${index}`}
              {...{
                [MISSPELT_WORD_ATTR]: word,
                [MISSPELT_ELEMENT_ATTR]: elementId,
                [MISSPELT_AT_ATTR]: occurrence,
              }}
              data-mark={key}
              className={cn('absolute')}
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
              }}
            >
              {/* The line grows into a box around the word under the pointer. */}
              <span
                className={cn(
                  'absolute bottom-0 rounded-[3px] transition-[height,inset,background-color,box-shadow] duration-200 ease-(--ease-overshoot)',
                  hovered === key
                    ? '-inset-x-1 h-[calc(100%+2px)] bg-logo/15 ring-2 ring-logo'
                    : 'inset-x-0 h-[2px] bg-logo',
                )}
              />
            </div>
          )),
        )}
      </div>
    </>
  );
}
