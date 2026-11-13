import type { FillLayer, ImageCredit, StockPhoto } from '@slider/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { usePickStockPhoto } from '@/lib/api';
import { Button, cn, Icon, IconButton, SegmentedControl, useFileDrop } from '@/ui';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';
import { useEditing } from './editing-context';
import { FillFitControls } from './ImageFitControls';
import { cropKey, groundCrop, pictureFit } from './picture-fit';
import { layerBackground, pictureUrl } from './fills/bake-fills';
import { filledBackground, usePictureAspect } from './fills/picture-aspect';
import { FillLayers, GradientEditor } from './fills/FillControls';
import { defaultGradient } from './fills/gradient';
import { useUploadLayerPicture } from './fills/useFills';
import { useBackgroundDraft } from './fills/useSlideBackground';
import { PhotoCredit } from './photos/PhotoCredit';
import { PhotoSearch } from './photos/StockPhotoSearch';
import { ColorPalette } from './colors/ColorPalette';

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

type Tab = 'solid' | 'gradient' | 'image' | 'layers';

const TABS: { value: Tab; label: string }[] = [
  { value: 'solid', label: 'Farbe' },
  { value: 'gradient', label: 'Verlauf' },
  { value: 'image', label: 'Bild' },
  { value: 'layers', label: 'Ebenen' },
];

/** The tab a background opens in: what it is made of. */
function tabOf(fills: readonly FillLayer[]): Tab {
  const [first, ...rest] = fills;
  if (!first) return 'solid';
  if (first.type === 'image' && rest.every(isTint)) return 'image';
  if (rest.length > 0) return 'layers';
  return first.type;
}

/** A black layer over a picture: the picture darkened, so text on it reads. */
const isTint = (layer: FillLayer) => layer.type === 'solid' && layer.color === '#000000';

/**
 * The slide's background, from its right-click menu „Hintergrund“, in the side panel where the
 * thread would be: a colour, a gradient or a picture (uploaded or a photo found) of its own –
 * or layers of them, as a shape's fill has them – for this slide or every one, or the master's
 * again. Esc or ✕ closes it; it goes by itself when its slide does.
 */
export function SlideBackgroundPanel() {
  const { backgroundPanelPageId: pageId } = useViewerState();
  const dispatch = useViewerDispatch();
  const editing = useEditing();
  const slide = pageId && editing.state?.slides.find((item) => item.pageId === pageId);
  const gone = !!pageId && !!editing.state && !slide;
  useEffect(() => {
    if (gone) dispatch({ type: 'backgroundPanelSet', pageId: null });
  }, [gone, dispatch]);
  if (!pageId || !slide) return null;
  // Remounted per slide: what was picked for one does not show on the next.
  return <SlideBackgroundPanelView key={pageId} pageId={pageId} slideId={slide.slideId} />;
}

function SlideBackgroundPanelView({ pageId, slideId }: { pageId: string; slideId: string }) {
  const editing = useEditing();
  const dispatch = useViewerDispatch();
  const toast = useViewerToast();
  const { deck, slideIndex } = useViewerData();
  const panelRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const number = (slideIndex.get(slideId) ?? 0) + 1;
  const slides = editing.state?.slides ?? [];
  const slide = slides.find((item) => item.pageId === pageId);
  const { fills, change } = useBackgroundDraft(slide?.backgroundFills ?? [], pageId);
  const [tab, setTab] = useState<Tab>(() => tabOf(fills));
  const picture = useUploadLayerPicture();
  const pickPhoto = usePickStockPhoto(deck.id);
  const stock = (editing.state?.stockPhotos ?? false) && !editing.offline;
  const { width, height } = editing.pageSize;
  const aspect = height > 0 ? width / height : 16 / 9;

  const registry = useStageRegistry();
  useRestoreFocus();
  // Its slide comes clear of the panel, as a thread's does.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    registry.revealSlide(slideId, { align: 'nearest' });
  }, [registry, slideId]);
  // The layers as they are now: a part chosen on the slide is taken a while after it began.
  const now = useRef({ fills, change });
  useEffect(() => {
    now.current = { fills, change };
  });
  // Closed (or another slide's) while its picture's part is chosen on the slide: taken as it is.
  useEffect(
    () => () => {
      if (pictureFit.croppingKey()?.startsWith(cropKey(groundCrop(slideId)))) pictureFit.finish();
    },
    [slideId],
  );

  const [only] = fills;
  const single = fills.length === 1 ? only : undefined;
  const image = only?.type === 'image' ? only : undefined;
  const tint = image ? (fills.slice(1).find(isTint)?.opacity ?? 0) : 0;

  /** A picture (its id or path) as the background, keeping how the last one filled and its tint. */
  const setPicture = (src: string, credit?: ImageCredit) => {
    const layer: FillLayer = {
      type: 'image',
      src,
      fit: image?.fit ?? 'fill',
      opacity: 1,
      visible: true,
      ...(credit ? { credit } : {}),
    };
    change(tint > 0 ? [layer, tintLayer(tint)] : [layer]);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!IMAGE_TYPES.split(',').includes(file.type)) {
      toast('Nur Bilder (PNG, JPEG, GIF, WebP).', 'danger');
      return;
    }
    try {
      setPicture(await picture.upload(file));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Das Bild ging nicht hoch.', 'danger');
    }
  };
  const takePhoto = async (photo: StockPhoto) => {
    const image = await pickPhoto.mutateAsync({ photoId: photo.id, aspect });
    setPicture(image.imageId, photo.credit);
  };
  const drop = useFileDrop((files) => void upload(files[0]));

  const own = fills.length > 0;
  const allPageIds = slides.map((item) => item.pageId);
  return (
    <SidePanel ref={panelRef} data-background-panel aria-labelledby={titleId}>
      <SidePanelHeader gap="sm">
        <div className="flex items-center gap-2">
          <Icon name="formatColorFill" size={20} className="shrink-0 text-fg-muted" />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Hintergrund · Folie {number}
          </h2>
          <IconButton
            icon="close"
            label="Schließen (Esc)"
            size="sm"
            onClick={() => dispatch({ type: 'backgroundPanelSet', pageId: null })}
          />
        </div>
        <p className="text-xs leading-4 text-fg-subtle">
          Farbe, Verlauf oder Bild nur für diese Folie – oder wieder der des Masters.
        </p>
      </SidePanelHeader>
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pt-4 pb-6"
        {...drop.handlers}
      >
        <BackgroundPreview fills={fills} aspect={aspect} dragOver={drop.dragOver} />
        <SegmentedControl
          segments={TABS}
          value={tab}
          onChange={(next) => {
            setTab(next);
            // As in a design tool: the fill becomes a gradient at once, of its colour.
            if (next === 'gradient' && fills.length <= 1 && single?.type !== 'gradient')
              change([defaultGradient(baseColor(fills))]);
          }}
          label="Art des Hintergrunds"
          mode="tabs"
          size="sm"
          track="soft"
          fill
        />

        {tab === 'solid' && (
          <section aria-label="Farben">
            <ColorPalette
              value={single?.type === 'solid' ? single.color : null}
              onChange={(color) => change([solidLayer(color)], 'color')}
            />
          </section>
        )}

        {tab === 'gradient' && (
          <section className="flex flex-col gap-3" aria-label="Verlauf">
            {single?.type === 'gradient' ? (
              <GradientEditor
                layer={single}
                onChange={(layer, coalesce) => change([layer], coalesce)}
                place={{ slideId, box: WHOLE_SLIDE, rotation: 0 }}
              />
            ) : (
              <>
                <p className="text-xs text-fg-subtle">
                  Der Hintergrund hat mehrere Ebenen – ein Verlauf ersetzt sie.
                </p>
                <Button
                  size="sm"
                  variant="soft"
                  icon="formatColorFill"
                  onClick={() => change([defaultGradient(baseColor(fills))])}
                >
                  Verlauf statt der Ebenen
                </Button>
              </>
            )}
          </section>
        )}

        {tab === 'image' && (
          <section className="flex flex-col gap-3" aria-label="Bild">
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_TYPES}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                void upload(file);
              }}
            />
            <Button
              size="sm"
              variant="soft"
              icon="upload"
              disabled={picture.pending}
              onClick={() => fileRef.current?.click()}
            >
              {image ? 'Anderes Bild hochladen …' : 'Bild hochladen …'}
            </Button>
            {image && (
              <div className="flex flex-col gap-3 rounded-control-sm bg-surface-1 p-2">
                {/* As a picture fills its frame – the slide is the frame here. */}
                <FillFitControls
                  elementId={groundCrop(slideId)}
                  fill={{
                    layer: 0,
                    src: image.src,
                    fit: image.fit,
                    focus: image.focus ?? null,
                    take: (focus) => {
                      const { fills, change } = now.current;
                      const [first, ...rest] = fills;
                      if (first?.type === 'image')
                        change([{ ...first, fit: 'fill', focus }, ...rest]);
                    },
                  }}
                  onFit={(fit) => change([{ ...image, fit }, ...fills.slice(1)])}
                />
                <label className="flex items-center gap-2 text-xs text-fg-muted">
                  Abdunkeln
                  <input
                    type="range"
                    min={0}
                    max={0.8}
                    step={0.05}
                    value={tint}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      change(next > 0 ? [image, tintLayer(next)] : [image], 'tint');
                    }}
                    className="min-w-0 flex-1 accent-fg"
                  />
                  <span className="w-8 text-right tabular-nums">{Math.round(tint * 100)} %</span>
                </label>
                {image.credit && <PhotoCredit credit={image.credit} />}
              </div>
            )}
            {stock && <PhotoSearch large={false} autoFocus={false} columns={3} take={takePhoto} />}
          </section>
        )}

        {tab === 'layers' && (
          <section className="flex flex-col gap-2" aria-label="Ebenen">
            <p className="text-xs text-fg-subtle">
              Farben, Verläufe und Bilder übereinander, jede Ebene mit eigener Deckkraft.
            </p>
            <FillLayers
              fills={fills}
              change={change}
              first={solidLayer('#ffffff')}
              label="Hintergrund"
              place={{ slideId, box: WHOLE_SLIDE, rotation: 0 }}
              cropFor={groundCrop(slideId)}
            />
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button
            size="sm"
            variant="ghost"
            icon="formatColorReset"
            disabled={!own}
            onClick={() => change([])}
          >
            Wie im Master
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="contentCopy"
            disabled={allPageIds.length < 2}
            className="ml-auto"
            onClick={() => {
              change(fills, undefined, allPageIds);
              toast(
                own
                  ? `Hintergrund auf alle ${allPageIds.length} Folien gesetzt.`
                  : `Alle ${allPageIds.length} Folien wieder wie im Master.`,
              );
            }}
          >
            Auf alle Folien
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}

/** The background as it will look, at the slide's proportions – the master's shows as such. */
function BackgroundPreview({
  fills,
  aspect,
  dragOver,
}: {
  fills: readonly FillLayer[];
  aspect: number;
  dragOver: boolean;
}) {
  const { deck } = useViewerData();
  return (
    <div
      className={cn(
        'checkerboard relative w-full overflow-hidden rounded-thumb ring-1 ring-border',
        dragOver && 'ring-2 ring-border-focus',
      )}
      style={{ aspectRatio: aspect }}
    >
      {fills.map((layer, index) =>
        layer.visible ? (
          <PreviewLayer
            key={index}
            layer={layer}
            url={(src) => pictureUrl(deck.id, src)}
            aspect={aspect}
          />
        ) : null,
      )}
      {(fills.length === 0 || dragOver) && (
        <span className="absolute inset-0 flex items-center justify-center bg-scrim dark-ink text-xs text-fg">
          {dragOver ? 'Bild loslassen' : 'Wie im Master'}
        </span>
      )}
    </div>
  );
}

/** A layer, its picture placed as the file draws it – filling the slide, its part („Ausschnitt“). */
function PreviewLayer({
  layer,
  url,
  aspect,
}: {
  layer: FillLayer;
  url: (src: string) => string;
  aspect: number;
}) {
  const src = layer.type === 'image' ? url(layer.src) : null;
  const pictureAspect = usePictureAspect(
    layer.type === 'image' && layer.fit === 'fill' ? src : null,
  );
  const background =
    layer.type !== 'image'
      ? layerBackground(layer, url, aspect)
      : layer.fit === 'fill'
        ? filledBackground(src!, pictureAspect, aspect, layer.focus)
        : `${
            {
              fit: 'center / contain no-repeat',
              stretch: 'center / 100% 100% no-repeat',
              tile: 'top left / auto repeat',
            }[layer.fit]
          } url("${src}")`;
  return <span className="absolute inset-0" style={{ background, opacity: layer.opacity }} />;
}

const solidLayer = (color: string): FillLayer => ({
  type: 'solid',
  color,
  opacity: 1,
  visible: true,
});

const tintLayer = (opacity: number): FillLayer => ({
  type: 'solid',
  color: '#000000',
  opacity,
  visible: true,
});

/** The whole slide, as a box of it. */
const WHOLE_SLIDE = { x: 0, y: 0, w: 1, h: 1 };

/** The colour a gradient made of the background starts from: its colour, else white. */
function baseColor(fills: readonly FillLayer[]): string {
  const [first] = fills;
  if (first?.type === 'solid') return first.color;
  if (first?.type === 'gradient') return first.stops[0]?.color ?? '#ffffff';
  return '#ffffff';
}
