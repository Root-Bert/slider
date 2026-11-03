import type { LivePeer, LiveTextCaret } from '@slider/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { accentColor } from '@/lib/accent';
import { useLiveKey } from '../../live/lib/live-store';
import { domPoint } from './editor-dom';
import { PROBE, screenFrame, toLocal, type ScreenFrame } from './screen-frame';
import type { SharedRange, SharedText } from './shared-text';

/** Someone else's caret in this text, as the live stream has it. */
interface TextCaretOf {
  id: string;
  name: string;
  color: LivePeer['author']['color'];
  caret: LiveTextCaret;
}

/** A caret of someone else in the text: its line, their selection, their name. */
interface RemoteMark {
  id: string;
  name: string;
  color: string;
  caret: { x: number; y: number; h: number };
  selection: { x: number; y: number; w: number; h: number }[];
}

/**
 * The carets (and selections) of the others typing in the same text, in their colours with
 * their names – measured on the drawn text after every change, theirs or ours, and drawn in the
 * box's own pixels: on a turned box they turn with it.
 */
export function RemoteCarets({
  text,
  root,
  version,
}: {
  text: SharedText;
  root: { current: HTMLDivElement | null };
  version: number;
}) {
  // Only the carets in this text: the others' pointers move all the time, and each move would
  // render and measure this anew.
  const carets = useLiveKey((snapshot) => {
    const inText: TextCaretOf[] = [];
    for (const peer of snapshot.peers.values()) {
      if (peer.textCaret?.elementId !== text.elementId) continue;
      inText.push({
        id: peer.connectionId,
        name: peer.author.name,
        color: peer.author.color,
        caret: peer.textCaret,
      });
    }
    return inText.length > 0 ? JSON.stringify(inText) : '';
  });
  const [marks, setMarks] = useState<RemoteMark[]>([]);
  const probes = useRef<(HTMLSpanElement | null)[]>([]);
  // Typing moves their carets too: measured anew after every change of the text (also of one
  // made anew, which `SharedText` swaps in).
  const [typed, setTyped] = useState(0);
  useEffect(() => text.onChange(() => setTyped((n) => n + 1)), [text]);
  useLayoutEffect(() => {
    // None in this text: nothing to measure (and nothing shown, below).
    if (!carets) return;
    const peers = JSON.parse(carets) as TextCaretOf[];
    const frame = requestAnimationFrame(() => {
      const node = root.current;
      const frame = screenFrame(probes.current);
      if (!node || !frame) return setMarks([]);
      const next: RemoteMark[] = [];
      for (const peer of peers) {
        const range = text.rangeOf(peer.caret);
        if (!range) continue;
        const mark = measure(node, range, frame);
        if (!mark) continue;
        next.push({ id: peer.id, name: peer.name, color: accentColor(peer.color), ...mark });
      }
      setMarks((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    });
    return () => cancelAnimationFrame(frame);
  }, [carets, text, root, version, typed]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {/* Where the box's own pixels are on screen – turned, zoomed – read from three points. */}
      {[
        [0, 0],
        [PROBE, 0],
        [0, PROBE],
      ].map(([left, top], i) => (
        <span
          key={i}
          ref={(probe) => {
            probes.current[i] = probe;
          }}
          className="absolute size-0"
          style={{ left, top }}
        />
      ))}
      {(carets ? marks : []).map((mark) => (
        <div key={mark.id}>
          {mark.selection.map((part, i) => (
            <span
              key={i}
              className="absolute opacity-25"
              style={{
                left: part.x,
                top: part.y,
                width: part.w,
                height: part.h,
                background: mark.color,
              }}
            />
          ))}
          <span
            className="absolute w-0.5"
            style={{
              left: mark.caret.x,
              top: mark.caret.y,
              height: mark.caret.h,
              background: mark.color,
            }}
          />
          <span
            className="absolute rounded-sm px-1 text-[11px] leading-4 font-medium whitespace-nowrap text-white"
            style={{
              left: mark.caret.x,
              top: mark.caret.y,
              transform: 'translateY(-100%)',
              background: mark.color,
            }}
          >
            {mark.name}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Where a range of the text lies on the drawn text, in the box's own pixels. */
function measure(
  root: HTMLElement,
  range: SharedRange,
  frame: ScreenFrame,
): Pick<RemoteMark, 'caret' | 'selection'> | null {
  try {
    const [headNode, headOffset] = domPoint(root, range.end);
    const caret = root.ownerDocument.createRange();
    caret.setStart(headNode, headOffset);
    caret.collapse(true);
    // A collapsed range in an empty line has no box: its line's run has (its left edge).
    const line = caret.getClientRects()[0];
    const rect =
      line ??
      (headNode instanceof Element ? headNode : headNode.parentElement)?.getBoundingClientRect();
    if (!rect) return null;
    const head = toLocal(frame, rect, { caret: line !== undefined });
    const selection: RemoteMark['selection'] = [];
    const ordered =
      range.start.paragraph < range.end.paragraph ||
      (range.start.paragraph === range.end.paragraph && range.start.offset <= range.end.offset);
    const [from, to] = ordered ? [range.start, range.end] : [range.end, range.start];
    if (from.paragraph !== to.paragraph || from.offset !== to.offset) {
      const [startNode, startOffset] = domPoint(root, from);
      const [endNode, endOffset] = domPoint(root, to);
      const span = root.ownerDocument.createRange();
      span.setStart(startNode, startOffset);
      span.setEnd(endNode, endOffset);
      for (const part of span.getClientRects()) {
        if (part.width > 0) selection.push(toLocal(frame, part, { lineHeight: head.h }));
      }
    }
    return { caret: { x: head.x, y: head.y, h: head.h }, selection };
  } catch {
    return null;
  }
}
