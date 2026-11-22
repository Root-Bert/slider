import type { WriterBlock } from '@slider/shared';
import { type RefObject, useEffect, useLayoutEffect, useState } from 'react';
import type { WriterEngine } from './engine';
import { blockLabel } from './labels';

/** A block of the page shown, as „Ebenen“ lists it and outlines it on the page. */
export interface LayerRow {
  id: string;
  /** Its index in the text: where `moveBlockTo` puts things. */
  index: number;
  block: WriterBlock;
  label: { name: string; kind: string };
  box: { left: number; top: number; width: number; height: number } | null;
  /** A picture's own image, for its thumbnail. */
  src?: string;
}

/**
 * The blocks that begin on page `page` – measured once the text is laid out again (after every
 * change, every new page break), as a slide's layers are listed top first: here first first.
 */
export function useLayerRows(
  engine: WriterEngine,
  host: RefObject<HTMLElement | null>,
  page: number,
  blocks: readonly WriterBlock[],
  on: boolean,
  layout: unknown,
): LayerRow[] {
  const [rows, setRows] = useState<LayerRow[]>([]);
  // A picture done loading moves what follows it: measured again then.
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    const root = host.current;
    if (!on || !root) return;
    const onLoad = () => setLoaded((count) => count + 1);
    root.addEventListener('load', onLoad, true);
    return () => root.removeEventListener('load', onLoad, true);
  }, [host, on]);
  useLayoutEffect(() => {
    const root = host.current;
    if (!on || !root) return;
    const frame = requestAnimationFrame(() => {
      // In the pixels of the pages' own layer, as the guides and the marks are placed.
      const origin = root.getBoundingClientRect();
      const zoom = engine.scale;
      const boxOf = (id: string) => {
        const element = engine.view.elementOf(id);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          left: (box.left - origin.left) / zoom,
          top: (box.top - origin.top) / zoom,
          width: box.width / zoom,
          height: box.height / zoom,
        };
      };
      const index = new Map(blocks.map((block, at) => [block.id, at]));
      const next = engine
        .blocksByPage()
        .filter((each) => each.page === page)
        .flatMap(({ id }) => {
          const at = index.get(id);
          const block = at === undefined ? undefined : blocks[at];
          if (!block || at === undefined) return [];
          const picture =
            block.type === 'paragraph' && block.pictures?.length
              ? engine.view.pictureElement(id, null)?.src
              : undefined;
          return [
            {
              id,
              index: at,
              block,
              label: blockLabel(block),
              box: boxOf(id),
              ...(picture && { src: picture }),
            },
          ];
        });
      setRows(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [engine, host, page, blocks, on, layout, loaded]);
  return on ? rows : [];
}
