import { useEffect, useRef, useState } from 'react';
import { usePanelForCalls } from '@/features/calls';
import { cn } from '@/ui';
import { useBoardOwner } from './board-owner';
import { MaterialBoard } from './MaterialBoard';

/** Room round the board, as round the slides (`TRACK_PAD_X`, `TRACK_PAD_TOP`). */
const PAD = 16;

/**
 * The material page: the board of a presentation or a text document (`BoardOwner`) over the whole
 * screen, beside it – it slides in from the left while the presentation slides out to the right
 * (`Viewer`; a document: Writer's `Editor`), no slide overview and no comments here. The paperclip
 * left of the slide overview (above a document's pages) or M opens it; „Präsentation →“ or M goes
 * back. Mounted once first opened, then kept: the board stays where it was looked at. A template
 * has none.
 */
export function MaterialPage() {
  const { open: materialOpen, setOpen, template, canComment } = useBoardOwner();
  // Shown, the call stays in its AI's side panel (✨ in the board's bar), open or closed.
  usePanelForCalls(materialOpen && !template && canComment);
  const [mounted, setMounted] = useState(materialOpen);
  if (materialOpen && !mounted) setMounted(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !mounted) return;
    const measure = () => setSize({ w: box.clientWidth, h: box.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [mounted]);

  // Opened: the board takes the keys (Esc, ⌘V, Entf are its own).
  const measured = size !== null;
  useEffect(() => {
    if (!materialOpen) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>('[data-material-board] [tabindex]')
        ?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [materialOpen, measured]);

  if (template) return null;
  return (
    <div
      data-material-page
      inert={!materialOpen}
      aria-hidden={!materialOpen}
      className={cn(
        'fixed inset-0 bg-canvas text-fg transition-[translate,visibility] duration-300 ease-sheet',
        materialOpen ? 'visible translate-x-0' : 'invisible -translate-x-full',
      )}
    >
      <div ref={boxRef} className="absolute" style={{ inset: PAD }}>
        {mounted && size && <MaterialBoard w={size.w} h={size.h} onLeave={() => setOpen(false)} />}
      </div>
    </div>
  );
}
