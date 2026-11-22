import { useEffect, useRef, useState } from 'react';
import { cn } from '@/ui';
import { drawPage, type PageSize, type PDFDocumentProxy } from '../lib/pdf';

const THUMB_WIDTH = 104;
/** Side by side, the pages small are all this tall, as Slider's film strip. */
const THUMB_HEIGHT = 58;

export type Flow = 'down' | 'across';

/** One small page: drawn once it comes near. */
function Thumb({
  doc,
  index,
  size,
  current,
  filled,
  onShow,
  flow,
}: {
  doc: PDFDocumentProxy;
  index: number;
  size: PageSize;
  current: boolean;
  filled: boolean;
  onShow: (index: number) => void;
  flow: Flow;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(index < 8);
  const across = flow === 'across';
  const width = across ? Math.round((size.width / size.height) * THUMB_HEIGHT) : THUMB_WIDTH;
  const height = across ? THUMB_HEIGHT : Math.round((size.height / size.width) * THUMB_WIDTH);

  useEffect(() => {
    const element = button.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: across ? '0px 400px' : '400px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, across]);
  useEffect(() => {
    if (!near) return;
    let task: { cancel: () => void } | null = null;
    let cancelled = false;
    void doc.getPage(index + 1).then((page) => {
      if (cancelled || !canvas.current) return;
      const drawing = drawPage(page, canvas.current, width / size.width, { forms: true });
      task = drawing;
      drawing.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, near, size.width, width]);
  useEffect(() => {
    if (current) button.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  return (
    <li className={cn('flex items-center', across ? 'relative' : 'flex-col gap-1')}>
      <button
        ref={button}
        type="button"
        aria-label={`Seite ${index + 1}`}
        aria-current={current ? 'page' : undefined}
        onClick={() => onShow(index)}
        className={cn(
          'focus-ring relative overflow-hidden rounded-[3px] bg-white transition-shadow',
          current
            ? 'shadow-[0_0_0_2px_var(--selection)]'
            : 'shadow-[0_0_0_1px_rgb(0_0_0/0.1)] hover:shadow-[0_0_0_1px_var(--color-fg-subtle)]',
        )}
        style={{ width, height }}
      >
        <canvas ref={canvas} aria-hidden className="size-full" />
        {filled && (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-2 rounded-full bg-(--selection)"
            title="Hier ist etwas ausgefüllt"
          />
        )}
      </button>
      <span
        className={cn(
          'text-caption tabular-nums',
          across
            ? 'pointer-events-none absolute right-1 bottom-1 rounded-full bg-black/55 px-1.5 text-[10px] leading-4 text-white'
            : current
              ? 'text-fg'
              : 'text-fg-subtle',
        )}
      >
        {index + 1}
      </span>
    </li>
  );
}

/**
 * The pages small – one under the other beside portrait pages, as Writer's; in a row under
 * pages lying side by side, as Slider's film strip. A click leads to the page.
 */
export function PageStrip({
  doc,
  sizes,
  current,
  filledPages,
  onShow,
  flow = 'down',
}: {
  doc: PDFDocumentProxy;
  sizes: readonly PageSize[];
  current: number;
  filledPages: ReadonlySet<number>;
  onShow: (index: number) => void;
  flow?: Flow;
}) {
  const across = flow === 'across';
  return (
    <nav
      aria-label="Seiten"
      className={
        across ? 'scrollbar-none overflow-x-auto p-1' : 'h-full overflow-y-auto px-4 pt-16 pb-20'
      }
    >
      <ol className={cn('flex gap-2.5', across ? 'w-max items-center' : 'flex-col items-center')}>
        {sizes.map((size, index) => (
          <Thumb
            key={index}
            doc={doc}
            index={index}
            size={size}
            current={index === current}
            filled={filledPages.has(index)}
            onShow={onShow}
            flow={flow}
          />
        ))}
      </ol>
    </nav>
  );
}
