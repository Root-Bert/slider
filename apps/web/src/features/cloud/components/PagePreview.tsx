import { useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_PREFIX, cloudPaths, type CloudNode } from '@slider/shared';
import { api } from '@/lib/api-client';
import { cn, Icon, type IconName } from '@/ui';

const pagePath = (nodeId: string, page: number | null, versionId: string | null) =>
  `/cloud/nodes/${encodeURIComponent(nodeId)}/pages${page ? `/${page}` : ''}${
    versionId ? `?v=${encodeURIComponent(versionId)}` : ''
  }`;

/** Whether the file has pages to show: a PDF, or an office file already drawn (its small picture). */
export const hasPagePreview = (node: CloudNode) =>
  node.kind === 'file' && !node.deleted && (node.fileType === 'pdf' || node.thumbnail);

/**
 * The file's pages at the top of its details, one at a time – swiped, scrolled sideways, stepped
 * with the arrows beside it or ← → once in it. The first page is the small picture the list
 * already shows, the sharp one drawn over it; the box takes that picture's shape, so nothing
 * jumps.
 */
export function PagePreview({ node }: { node: CloudNode }) {
  const pages = useQuery({
    queryKey: ['cloud', 'pages', node.id, node.versionId],
    queryFn: () => api.get<{ pages: number }>(pagePath(node.id, null, node.versionId)),
    staleTime: Infinity,
    retry: false,
  });
  const strip = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  // Until the small picture says otherwise: a slide's shape, else an upright page's.
  const [ratio, setRatio] = useState(node.fileType === 'presentation' ? 16 / 9 : 210 / 297);
  const count = pages.data?.pages ?? 1;
  const thumbnail = `${API_PREFIX}${cloudPaths.thumbnail(node.id, node.versionId)}`;

  const go = (index: number) => {
    const box = strip.current;
    if (!box) return;
    const to = Math.max(0, Math.min(count - 1, index));
    box.scrollTo({ left: to * box.clientWidth, behavior: 'smooth' });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step || event.metaKey || event.altKey || event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    go(current + step);
  };

  return (
    <section aria-label="Vorschau" className="flex flex-col gap-2">
      <div className="group relative">
        <div
          ref={strip}
          tabIndex={0}
          aria-roledescription="Seiten"
          aria-label={`Seite ${current + 1} von ${count}`}
          onKeyDown={onKeyDown}
          onScroll={(event) => {
            const box = event.currentTarget;
            setCurrent(Math.round(box.scrollLeft / Math.max(1, box.clientWidth)));
          }}
          className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-thumb bg-surface-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-focus"
          style={{ aspectRatio: ratio }}
        >
          {Array.from({ length: count }, (_, index) => (
            <Page
              key={index}
              src={
                pages.data ? `${API_PREFIX}${pagePath(node.id, index + 1, node.versionId)}` : null
              }
              under={index === 0 ? thumbnail : null}
              label={`Seite ${index + 1}`}
              onShape={index === 0 ? setRatio : undefined}
            />
          ))}
        </div>
        {count > 1 && (
          <>
            <Step
              icon="chevronLeft"
              label="Vorige Seite"
              disabled={current === 0}
              onClick={() => go(current - 1)}
              className="left-2"
            />
            <Step
              icon="chevronRight"
              label="Nächste Seite"
              disabled={current === count - 1}
              onClick={() => go(current + 1)}
              className="right-2"
            />
          </>
        )}
      </div>
      {count > 1 && (
        <p className="text-center text-xs text-fg-subtle tabular-nums">
          Seite {current + 1} von {count}
        </p>
      )}
    </section>
  );
}

/** An arrow over the page, on its scrim as everything over a slide (light in either theme). */
function Step({
  icon,
  label,
  disabled,
  onClick,
  className,
}: {
  icon: IconName;
  label: string;
  disabled: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      tabIndex={-1}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'glass-dark absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-fg opacity-0 transition-opacity group-hover:opacity-100 hover:bg-scrim-strong disabled:invisible pointer-coarse:hidden',
        className,
      )}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

/** One page: its picture once drawn, over the small one (the first page) or a quiet ground. */
function Page({
  src,
  under,
  label,
  onShape,
}: {
  src: string | null;
  under: string | null;
  label: string;
  onShape?: ((ratio: number) => void) | undefined;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div
      className={cn('relative h-full w-full shrink-0 snap-center', !under && !shown && 'skeleton')}
    >
      {under && (
        <img
          src={under}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight) {
              onShape?.(image.naturalWidth / image.naturalHeight);
            }
          }}
          className="absolute inset-0 size-full object-contain"
        />
      )}
      {src && (
        <img
          src={src}
          alt={label}
          loading="lazy"
          draggable={false}
          onLoad={() => setShown(true)}
          className={cn(
            'absolute inset-0 size-full object-contain transition-opacity duration-200',
            shown ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  );
}
