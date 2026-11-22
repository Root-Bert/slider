import { useLayoutEffect, useState } from 'react';
import { accentColor } from '@/lib/accent';
import { isCollapsed, ordered, paragraphOf, type Blocks } from '../lib/model';
import type { WriterEngine } from './engine';
import type { RemoteCursor } from './presence';

interface Mark {
  id: string;
  name: string;
  color: string;
  caret: { left: number; top: number; height: number };
  selection: { left: number; top: number; width: number; height: number }[];
}

/**
 * The others' carets in the text, in their colours with their names, and what they have
 * selected – as on a slide's text box (`RemoteCarets`). Measured on the drawn text after every
 * change, in the sheets' own px.
 */
export function RemoteCursors({
  engine,
  cursors,
  blocks,
  layout,
  zoom,
}: {
  engine: WriterEngine;
  cursors: ReadonlyMap<string, RemoteCursor>;
  blocks: Blocks;
  layout: number;
  zoom: number;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  useLayoutEffect(() => {
    const next: Mark[] = [];
    for (const { author, sel } of cursors.values()) {
      // A paragraph that is gone (deleted here meanwhile): not shown till they move.
      if (!paragraphOf(blocks, sel.anchor.id) || !paragraphOf(blocks, sel.focus.id)) continue;
      const caret = engine.caretOf(sel.focus);
      if (!caret) continue;
      const { from, to } = ordered(blocks, sel);
      next.push({
        id: author.id,
        name: author.name,
        color: accentColor(author.color),
        caret,
        selection: isCollapsed(sel) ? [] : engine.rectsOf(from, to),
      });
    }
    let stale = false;
    queueMicrotask(() => {
      if (!stale) setMarks(next);
    });
    return () => {
      stale = true;
    };
  }, [engine, cursors, blocks, layout, zoom]);
  if (cursors.size === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-1">
      {marks.map((mark) => (
        <div key={mark.id}>
          {mark.selection.map((part, index) => (
            <span
              key={index}
              className="absolute opacity-25"
              style={{ ...part, background: mark.color }}
            />
          ))}
          <span
            className="absolute"
            style={{
              left: mark.caret.left,
              top: mark.caret.top,
              width: 2 / zoom,
              height: mark.caret.height,
              background: mark.color,
            }}
          />
          <span
            className="absolute origin-top-left rounded-sm px-1 text-[11px] leading-4 font-medium whitespace-nowrap text-white"
            style={{
              left: mark.caret.left,
              top: mark.caret.top,
              transform: `scale(${1 / zoom}) translateY(-100%)`,
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
