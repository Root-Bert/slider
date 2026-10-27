import {
  stockLink,
  STOCK_HOME,
  stockPhotoUrl,
  type EditableElement,
  type StockPhoto,
} from '@slider/shared';
import { useState } from 'react';
import { usePickStockPhoto, useStockSearch } from '@/lib/api';
import { cn, Spinner, TextField, useDebounced } from '@/ui';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { useEditing } from '../editing-context';
import { photoPreviews } from './photo-previews';

/**
 * Searching Unsplash for a picture frame (in the format bar): the photos found, small – each
 * with its photographer – and a click puts one into the frame, cut to its proportions. The
 * photo shows in the frame at once; the slide is drawn anew behind.
 */
export function StockPhotoSearch({
  element,
  slideId,
  large,
  onPicked,
}: {
  element: EditableElement;
  slideId: string;
  /** The panel is made big: more photos a row, and taller. */
  large: boolean;
  onPicked: () => void;
}) {
  const editing = useEditing();
  const { deck } = useViewerData();
  const toast = useViewerToast();
  const [query, setQuery] = useState('');
  const settled = useDebounced(query, 400);
  const search = useStockSearch(deck.id, settled);
  const pickPhoto = usePickStockPhoto(deck.id);
  const [picking, setPicking] = useState<string | null>(null);
  const { w, h } = element.bbox;
  const aspect = h > 0 ? (w * editing.pageSize.width) / (h * editing.pageSize.height) : undefined;

  const pick = async (photo: StockPhoto) => {
    if (picking) return;
    setPicking(photo.id);
    const key = photoPreviews.show(
      slideId,
      element.bbox,
      stockPhotoUrl(photo, Math.max(400, Math.min(1600, w * 1600)), aspect),
    );
    try {
      const image = await pickPhoto.mutateAsync({ photoId: photo.id, aspect });
      const ok = await editing.apply([
        { type: 'replaceImage', elementId: element.id, imageId: image.imageId },
      ]);
      if (!ok) {
        photoPreviews.clear(slideId, key);
        return;
      }
      photoPreviews.settle(slideId, key);
      onPicked();
    } catch (error) {
      photoPreviews.clear(slideId, key);
      toast(error instanceof Error ? error.message : 'Das Foto ließ sich nicht holen.', 'danger');
    } finally {
      setPicking(null);
    }
  };

  const photos = search.data?.photos ?? [];
  return (
    <div className="flex flex-col gap-2" data-stock-search="">
      <TextField
        icon="search"
        autoFocus
        aria-label="Fotos suchen"
        placeholder="Fotos suchen, z. B. Teamarbeit"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        trailing={search.isFetching ? <Spinner size="sm" /> : undefined}
      />
      {search.isError && (
        <p className="text-caption text-danger">
          {search.error instanceof Error ? search.error.message : 'Die Suche ging nicht.'}
        </p>
      )}
      {settled.trim().length >= 2 && search.isSuccess && photos.length === 0 && (
        <p className="text-caption text-fg-subtle">Nichts gefunden – andere Wörter?</p>
      )}
      {photos.length > 0 && (
        <div
          className={cn(
            'grid content-start gap-2 overflow-y-auto pr-0.5',
            large ? 'max-h-[min(560px,60vh)] grid-cols-4' : 'max-h-80 grid-cols-2',
          )}
        >
          {photos.map((photo) => (
            <div
              key={photo.id}
              // 4:3 by its padding, not `aspect-ratio`: in the scrolling grid that gave way and
              // the tiles slid over each other.
              className="group relative h-0 overflow-hidden rounded-thumb pb-[75%]"
              style={{ backgroundColor: photo.color ?? undefined }}
            >
              <button
                type="button"
                title={photo.description ?? `Foto von ${photo.credit.name}`}
                aria-label={`Foto von ${photo.credit.name} nehmen`}
                disabled={picking !== null}
                onClick={() => void pick(photo)}
                className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-fg/60 focus-visible:ring-inset"
              >
                <img
                  src={photo.thumbUrl}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className={cn(
                    'size-full object-cover transition-opacity',
                    picking && picking !== photo.id && 'opacity-40',
                  )}
                />
              </button>
              {/* Who took it, linked – on hover, like Unsplash itself shows it. */}
              <a
                href={stockLink(photo.credit.profileUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-x-0 bottom-0 truncate bg-scrim px-1.5 py-0.5 text-tiny leading-4 text-fg opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
              >
                {photo.credit.name}
              </a>
              {picking === photo.id && (
                <span className="absolute inset-0 flex items-center justify-center bg-scrim">
                  <Spinner size="sm" label="Foto wird geholt" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-caption text-fg-subtle">
        Fotos von{' '}
        <a
          href={stockLink(STOCK_HOME)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-fg-subtle/50 underline-offset-2 hover:text-fg"
        >
          Unsplash
        </a>
      </p>
    </div>
  );
}
