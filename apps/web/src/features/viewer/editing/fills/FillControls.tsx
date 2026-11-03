import {
  isCentredGradient,
  stopOpacity,
  type EditableElement,
  type FillLayer,
  type GradientKind,
  type GradientStop,
  type ImageFit,
  type PictureFocus,
} from '@slider/shared';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { useEditing } from '../editing-context';
import { accentColor } from '@/lib/accent';
import { cn, Icon, IconButton, NumberField, SegmentedControl, Select } from '@/ui';
import { NEW_BOX } from '../live/model';
import { FillFitControls } from '../ImageFitControls';
import { drawsFillsAtOnce, fillArea, pictureFit } from '../picture-fit';
import { PhotoCredit } from '../photos/PhotoCredit';
import { ColorField, ColorPalette, HexField, PercentField } from '../colors/ColorPalette';
import { layerBackground, pictureUrl } from './bake-fills';
import { cropBackground, squareOfCrop, usePictureAspect } from './picture-aspect';
import {
  defaultGradient,
  makeStop,
  sortedStops,
  stopAt,
  stopCss,
  type GradientLayer,
} from './gradient';
import { useShowGradientHandles, type GradientPlace } from './gradient-target';
import { useFillDraft, useUploadLayerPicture } from './useFills';

/*
 * The fill tab, as a design tool has it: a list of layers – the top one first – each a colour, a
 * gradient or a picture with its opacity, shown or hidden, dragged into order. A click on a
 * layer's swatch opens it below the list. No layers: not filled.
 */

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

type LayerType = FillLayer['type'];

const TYPES: { value: LayerType; label: string }[] = [
  { value: 'solid', label: 'Farbe' },
  { value: 'gradient', label: 'Verlauf' },
  { value: 'image', label: 'Bild' },
];

const FITS: { value: ImageFit; label: string }[] = [
  { value: 'fill', label: 'Füllen' },
  { value: 'fit', label: 'Einpassen' },
  { value: 'stretch', label: 'Strecken' },
  { value: 'tile', label: 'Kacheln' },
];

/** The colour a layer mostly has – what it keeps when it becomes another kind. */
function mainColor(layer: FillLayer): string {
  if (layer.type === 'solid') return layer.color;
  if (layer.type === 'gradient') return layer.stops[0]?.color ?? '#000000';
  return '#000000';
}

function layerLabel(layer: FillLayer): string {
  if (layer.type === 'solid') return layer.color.slice(1).toUpperCase();
  if (layer.type === 'gradient')
    return KINDS.find((kind) => kind.value === layer.kind)?.label ?? 'Verlauf';
  return FITS.find((fit) => fit.value === layer.fit)?.label ?? 'Bild';
}

export function FillControls({ element }: { element: EditableElement }) {
  const { fills, change } = useFillDraft(element);
  const editing = useEditing();
  const { slides } = useViewerData();
  const slideId = editing.selection?.slideId;
  // Layers with a picture go to the file as a picture of them all, drawn by LibreOffice: shown at
  // once over the shape (`FillsDrawn`) until its picture of them is on screen.
  const changeShown = (next: FillLayer[], coalesce?: string) => {
    if (slideId && drawsFillsAtOnce(next) && fillArea(element, editing.pageSize)) {
      const since = slides.find((slide) => slide.id === slideId)?.imageUrl ?? null;
      pictureFit.drawUntilNew(element.id, slideId, since, next);
    }
    change(next, coalesce);
  };
  return (
    <FillLayers
      fills={fills}
      change={changeShown}
      first={{ type: 'solid', color: NEW_BOX.fill, opacity: 1, visible: true }}
      label="Füllung"
      place={slideId ? { slideId, box: element.bbox, rotation: element.rotation } : null}
      cropFor={element.tilt ? undefined : element.id}
    />
  );
}

/**
 * The layers of a fill – an element's, a slide's background – with `change` setting them;
 * `first`: the layer added when there is none; `place`: where they lie on their slide (a gradient
 * opened shows its handles there).
 */
export function FillLayers({
  fills,
  change,
  first,
  label,
  place = null,
  cropFor,
}: {
  fills: FillLayer[];
  change: (fills: FillLayer[], coalesce?: string) => void;
  first: FillLayer;
  label: string;
  place?: GradientPlace | null;
  /**
   * The element they fill – or the slide whose background they are (`groundCrop`): a picture
   * layer then fills it as a picture element its frame („Füllen“/„Strecken“, its part chosen on
   * the slide). Left out (a tilted element): every way a picture fills.
   */
  cropFor?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  /** The layer dragged and where it would go: `slot`, a place between the layers (0 bottom). */
  const [dragged, setDragged] = useState<{ index: number; slot: number } | null>(null);
  const toast = useViewerToast();
  const { viewer } = useViewerData();
  const editing = useEditing();
  const picture = useUploadLayerPicture();
  const fileRef = useRef<HTMLInputElement>(null);
  /** The layer a picture picked goes into (`null`: a new one on top). */
  const pictureFor = useRef<number | null | undefined>(null);
  /** The layers and their setter as now – a picture uploads for a while. */
  const now = useRef({ fills, change });
  useEffect(() => {
    now.current = { fills, change };
  });

  const setLayer = (index: number, layer: FillLayer, coalesce?: string) =>
    change(
      fills.map((item, at) => (at === index ? layer : item)),
      coalesce && `${coalesce}:${index}`,
    );
  const add = () => {
    const layer: FillLayer =
      fills.length === 0 ? first : { type: 'solid', color: '#000000', opacity: 0.2, visible: true };
    change([...fills, layer]);
    setOpen(fills.length);
  };
  const remove = (index: number) => {
    if (pictureFor.current === index) pictureFor.current = undefined;
    else if (pictureFor.current != null && pictureFor.current > index) pictureFor.current -= 1;
    change(fills.filter((_, at) => at !== index));
    setOpen((current) =>
      current === null || current === index ? null : current > index ? current - 1 : current,
    );
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...fills];
    const [layer] = next.splice(from, 1);
    if (!layer) return;
    next.splice(to, 0, layer);
    change(next);
    const following = (index: number) => {
      if (index === from) return to;
      if (from < to && index > from && index <= to) return index - 1;
      if (from > to && index >= to && index < from) return index + 1;
      return index;
    };
    setOpen((current) => (current === null ? null : following(current)));
    if (pictureFor.current != null) pictureFor.current = following(pictureFor.current);
  };
  const pickPicture = (index: number | null) => {
    pictureFor.current = index;
    fileRef.current?.click();
  };
  const takePicture = async (file: File) => {
    try {
      const src = await picture.upload(file);
      const { fills, change } = now.current;
      const index = pictureFor.current;
      if (index === undefined) return;
      const old = index === null ? null : fills[index];
      const layer: FillLayer = {
        type: 'image',
        src,
        fit: old?.type === 'image' ? old.fit : 'fill',
        opacity: old?.opacity ?? 1,
        visible: true,
      };
      if (index === null || !old) {
        change([...fills, layer]);
        setOpen(fills.length);
      } else change(fills.map((item, at) => (at === index ? layer : item)));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Das Bild ging nicht hoch.', 'danger');
    }
  };

  // The proportions of what they fill (a swatch shows a picture's part as it fills it).
  const { width, height } = editing.pageSize;
  const box = place?.box ?? { w: 1, h: 1 };
  const frameAspect = box.h * height > 0 ? (box.w * width) / (box.h * height) : 1;
  // Shown top first, as they lie.
  const order = fills.map((_, index) => index).reverse();
  const opened = open !== null ? fills[open] : undefined;
  return (
    <div className="flex flex-col gap-1">
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_TYPES}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void takePicture(file);
        }}
      />
      <div className="flex items-center gap-1">
        <span className="mr-auto text-xs text-fg-subtle">{label}</span>
        <IconButton
          icon="image"
          label="Bild als Ebene"
          size="compact"
          disabled={picture.pending}
          onClick={() => pickPicture(null)}
        />
        <IconButton icon="add" label="Ebene hinzufügen" size="compact" onClick={add} />
      </div>
      {order.length > 0 && (
        // As the slide's layers (LayersPanel): the whole list takes the drop, above or below the
        // row under the pointer by its half, a line showing where.
        <ul
          className="flex flex-col gap-0.5"
          aria-label={`Ebenen: ${label}`}
          style={{ ['--layer-color' as string]: accentColor(viewer.author.color) }}
          onDragOver={(event) => {
            if (!dragged) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const row = (event.target as Element).closest<HTMLElement>('[data-fill-row]');
            if (!row) return;
            const at = Number(row.dataset.fillRow);
            const rect = row.getBoundingClientRect();
            const slot = event.clientY < rect.top + rect.height / 2 ? at + 1 : at;
            if (slot !== dragged.slot) setDragged({ ...dragged, slot });
          }}
          onDrop={(event) => {
            if (!dragged) return;
            event.preventDefault();
            event.stopPropagation();
            const { index, slot } = dragged;
            move(index, slot > index ? slot - 1 : slot);
            setDragged(null);
          }}
        >
          {order.map((index) => {
            const layer = fills[index] as FillLayer;
            // A line where the dragged layer would go – none where it already lies.
            const moves =
              dragged !== null &&
              dragged.slot !== dragged.index &&
              dragged.slot !== dragged.index + 1;
            return (
              <li
                key={index}
                data-fill-row={index}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move';
                  // Firefox starts no drag without data.
                  event.dataTransfer.setData('text/plain', layerLabel(layer));
                  setDragged({ index, slot: index });
                }}
                onDragEnd={() => setDragged(null)}
                className={cn(
                  'relative flex items-center gap-1 rounded-control-sm py-0.5 pr-0.5',
                  open === index && 'bg-selected',
                  dragged?.index === index && 'opacity-50',
                )}
              >
                {moves && dragged.slot === index + 1 && (
                  <span className="absolute inset-x-1 -top-px h-0.5 rounded-full bg-(--layer-color)" />
                )}
                {moves && index === 0 && dragged.slot === 0 && (
                  <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-(--layer-color)" />
                )}
                <span
                  className="flex w-4 shrink-0 cursor-grab justify-center text-fg-subtle active:cursor-grabbing"
                  title="Ziehen zum Ordnen"
                >
                  <Icon name="dragIndicator" size={14} />
                </span>
                <button
                  type="button"
                  aria-label="Ebene bearbeiten"
                  aria-expanded={open === index}
                  onClick={() => setOpen((current) => (current === index ? null : index))}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 rounded-control-sm text-left focus-visible:outline-2 focus-visible:outline-border-focus',
                    !layer.visible && 'opacity-40',
                  )}
                >
                  <Swatch layer={layer} frameAspect={frameAspect} />
                  <span className="truncate text-xs text-fg tabular-nums">{layerLabel(layer)}</span>
                </button>
                <PercentField
                  label="Deckkraft (%)"
                  value={layer.opacity}
                  onChange={(opacity) => setLayer(index, { ...layer, opacity }, 'opacity')}
                />
                <IconButton
                  icon={layer.visible ? 'visibility' : 'visibilityOff'}
                  label={layer.visible ? 'Ausblenden' : 'Einblenden'}
                  size="compact"
                  onClick={() => setLayer(index, { ...layer, visible: !layer.visible })}
                />
                <IconButton
                  icon="remove"
                  label="Ebene entfernen"
                  size="compact"
                  onClick={() => remove(index)}
                />
              </li>
            );
          })}
        </ul>
      )}
      {opened && open !== null && (
        <LayerEditor
          key={open}
          layer={opened}
          index={open}
          cropFor={cropFor}
          take={(index, focus) => {
            // Taken a while after it was opened: the layers as they are then.
            const { fills, change } = now.current;
            const layer = fills[index];
            if (layer?.type !== 'image') return;
            change(
              fills.map((item, at) => (at === index ? { ...layer, fit: 'fill', focus } : item)),
            );
          }}
          onChange={(layer, coalesce) => setLayer(open, layer, coalesce)}
          onPickPicture={() => pickPicture(open)}
          picking={picture.pending}
          place={place}
        />
      )}
    </div>
  );
}

/**
 * A layer small, as a square: a picture filling its frame (`frameAspect`) shows the part it shows
 * there („Ausschnitt“), not the whole picture.
 */
function Swatch({ layer, frameAspect }: { layer: FillLayer; frameAspect: number }) {
  const { deck } = useViewerData();
  const url = (src: string) => pictureUrl(deck.id, src);
  const filled = layer.type === 'image' && layer.fit === 'fill' ? layer : null;
  const aspect = usePictureAspect(filled ? url(filled.src) : null);
  const background =
    filled && aspect
      ? cropBackground(url(filled.src), squareOfCrop(aspect, frameAspect, filled.focus ?? null))
      : layerBackground(layer, url);
  return (
    <span
      className="checkerboard relative size-5 shrink-0 overflow-hidden rounded-[5px] ring-1 ring-border"
      aria-hidden
    >
      <span className="absolute inset-0" style={{ background, opacity: layer.opacity }} />
    </span>
  );
}

/** One layer opened: its kind and what it is of that kind. */
function LayerEditor({
  layer,
  index,
  cropFor,
  take,
  onChange,
  onPickPicture,
  picking,
  place,
}: {
  layer: FillLayer;
  index: number;
  cropFor: string | undefined;
  /** Takes the part chosen on the slide for the picture of layer `index`. */
  take: (index: number, focus: PictureFocus) => void;
  onChange: (layer: FillLayer, coalesce?: string) => void;
  onPickPicture: () => void;
  picking: boolean;
  place: GradientPlace | null;
}) {
  const { opacity, visible } = layer;
  const becomes = (type: LayerType) => {
    if (type === layer.type) return;
    const color = mainColor(layer);
    if (type === 'solid') onChange({ type, color, opacity, visible });
    else if (type === 'gradient') onChange(defaultGradient(color, opacity, visible));
    else onPickPicture();
  };
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-control-sm bg-surface-1 p-2">
      <SegmentedControl
        segments={TYPES}
        value={layer.type}
        onChange={becomes}
        label="Art der Ebene"
        size="xs"
        track="soft"
        fill
      />
      {/* The picker right here: one click on a shade or a swatch changes the colour – no dot
          that opens it in a panel of its own. */}
      {layer.type === 'solid' && (
        <ColorPalette
          value={layer.color}
          onChange={(color) => onChange({ ...layer, color }, 'color')}
          opacity={layer.opacity}
          onOpacity={(opacity) => onChange({ ...layer, opacity }, 'opacity')}
        />
      )}
      {layer.type === 'gradient' && (
        <GradientEditor layer={layer} onChange={onChange} place={place} />
      )}
      {layer.type === 'image' && (
        <div className="flex flex-col gap-2">
          {cropFor ? (
            <FillFitControls
              elementId={cropFor}
              fill={{
                layer: index,
                src: layer.src,
                fit: layer.fit,
                focus: layer.focus ?? null,
                take: (focus) => take(index, focus),
              }}
              onFit={(fit) => onChange({ ...layer, fit })}
            />
          ) : (
            <SegmentedControl
              segments={FITS}
              value={layer.fit}
              onChange={(fit) => onChange({ ...layer, fit })}
              label="Wie das Bild füllt"
              size="xs"
              track="soft"
              fill
            />
          )}
          <button
            type="button"
            disabled={picking}
            onClick={onPickPicture}
            className="rounded-control-sm px-2 py-1 text-xs text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
          >
            Anderes Bild …
          </button>
          {layer.credit && <PhotoCredit credit={layer.credit} />}
        </div>
      )}
    </div>
  );
}

const KINDS: { value: GradientKind; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'axial', label: 'Axial' },
  { value: 'radial', label: 'Radial' },
  { value: 'ellipsoid', label: 'Ellipsoid' },
  { value: 'square', label: 'Quadratisch' },
  { value: 'rectangular', label: 'Rechteckig' },
];

/** Most stops a gradient has (as the file's schema). */
const MAX_STOPS = 8;

/** Where a new stop goes: the middle of the widest gap between the stops. */
function gapForStop(stops: readonly GradientStop[]): number {
  const sorted = sortedStops(stops);
  let best = { at: 0.5, width: -1 };
  const edges = [{ at: 0 }, ...sorted, { at: 1 }];
  for (let i = 1; i < edges.length; i++) {
    const a = (edges[i - 1] as { at: number }).at;
    const b = (edges[i] as { at: number }).at;
    if (b - a > best.width) best = { at: (a + b) / 2, width: b - a };
  }
  return Math.round(best.at * 1000) / 1000;
}

/**
 * A gradient, as a design tool has it: its form (those LibreOffice draws) and direction, its
 * colours as stops on a bar – dragged along it, a click on the bar adds one – and listed below,
 * each with where it sits, its colour and how opaque it is. `place`: where it lies on its slide, which then shows
 * its line and colours over it, to be dragged there too.
 */
export function GradientEditor({
  layer,
  onChange,
  place,
}: {
  layer: GradientLayer;
  onChange: (layer: FillLayer, coalesce?: string) => void;
  place?: GradientPlace | null;
}) {
  const [pickedAt, setPicked] = useState(0);
  // Stops taken away elsewhere (undone, another person): the last one picked instead.
  const picked = Math.min(pickedAt, layer.stops.length - 1);
  const bar = useRef<HTMLDivElement>(null);
  useShowGradientHandles(
    place ? { ...place, layer, picked, change: onChange, pick: setPicked } : null,
  );
  const setStops = (stops: GradientStop[], coalesce?: string) =>
    onChange({ ...layer, stops }, coalesce);
  const setStop = (index: number, patch: Partial<GradientStop>, coalesce?: string) =>
    setStops(
      layer.stops.map((item, at) => (at === index ? { ...item, ...patch } : item)),
      coalesce,
    );
  const addStop = (at: number) => {
    if (layer.stops.length >= MAX_STOPS) return;
    setStops([...layer.stops, stopAt(layer.stops, at)]);
    setPicked(layer.stops.length);
  };
  const removeStop = (index: number) => {
    if (layer.stops.length <= 2) return;
    setStops(layer.stops.filter((_, at) => at !== index));
    setPicked((current) => (current === index ? 0 : current > index ? current - 1 : current));
  };
  const setKind = (kind: GradientKind) => {
    if (kind === layer.kind) return;
    const centred = isCentredGradient(kind);
    // A direction means something else out from a centre: started afresh there.
    const angle = centred === isCentredGradient(layer.kind) ? layer.angle : centred ? 0 : 180;
    const { center, ...rest } = layer;
    onChange({ ...rest, kind, angle, ...(centred && center ? { center } : {}) });
  };
  const atOf = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 1000) / 1000;
  };
  const drag = (index: number, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setPicked(index);
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => setStop(index, { at: atOf(move.clientX) }, 'stop');
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };
  const preview = `linear-gradient(90deg, ${sortedStops(layer.stops)
    .map((item) => `${stopCss(item)} ${item.at * 100}%`)
    .join(', ')})`;
  // Listed where they sit along the gradient, as on the bar.
  const order = layer.stops
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => a.stop.at - b.stop.at || a.index - b.index);
  const turns = layer.kind !== 'radial';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Select
          value={layer.kind}
          onChange={setKind}
          options={KINDS}
          size="sm"
          aria-label="Form des Verlaufs"
          className="min-w-0 flex-1"
        />
        {turns && (
          <>
            <NumberField
              label="Winkel"
              title="Winkel in Grad"
              unit="°"
              value={Math.round(layer.angle)}
              onChange={(angle) => onChange({ ...layer, angle }, 'angle')}
              min={0}
              max={360}
              step={1}
              bigStep={15}
              wrap={360}
            />
            <IconButton
              icon="refresh"
              label="Um 90° drehen"
              size="compact"
              onClick={() => onChange({ ...layer, angle: (layer.angle + 90) % 360 })}
            />
          </>
        )}
        <IconButton
          icon="compareArrows"
          label="Umkehren"
          size="compact"
          onClick={() =>
            // In place: the colour picked stays picked.
            setStops(layer.stops.map((item) => ({ ...item, at: 1 - item.at })))
          }
        />
      </div>
      <div className="px-2">
        <div
          ref={bar}
          role="presentation"
          title="Klicken: Farbe hinzufügen"
          className="checkerboard relative h-4 cursor-copy rounded-[4px] ring-1 ring-border"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) addStop(atOf(event.clientX));
          }}
        >
          <span
            className="pointer-events-none absolute inset-0 rounded-[4px]"
            style={{ background: preview }}
          />
          {layer.stops.map((item, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Farbe bei ${Math.round(item.at * 100)} %`}
              aria-pressed={index === picked}
              onPointerDown={(event) => drag(index, event)}
              onKeyDown={(event) => {
                if (event.key === 'Delete' || event.key === 'Backspace') {
                  event.preventDefault();
                  removeStop(index);
                  return;
                }
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const step = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 0.1 : 0.01);
                setStop(
                  index,
                  { at: Math.min(1, Math.max(0, Math.round((item.at + step) * 1000) / 1000)) },
                  'stop',
                );
              }}
              className={cn(
                'absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full ring-2 ring-white shadow-sm focus-visible:outline-2 focus-visible:outline-border-focus',
                index === picked && 'ring-[3px] ring-border-focus',
              )}
              style={{ left: `${item.at * 100}%`, background: item.color }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center">
          <span className="mr-auto text-xs text-fg-subtle">Farben</span>
          <IconButton
            icon="add"
            label="Farbe hinzufügen"
            size="compact"
            disabled={layer.stops.length >= MAX_STOPS}
            onClick={() => addStop(gapForStop(layer.stops))}
          />
        </div>
        <ul className="flex flex-col gap-0.5" aria-label="Farben des Verlaufs">
          {order.map(({ stop, index }) => (
            <li
              key={index}
              onFocusCapture={() => setPicked(index)}
              onPointerDownCapture={() => setPicked(index)}
              className={cn(
                'flex items-center gap-1.5 rounded-control-sm p-0.5',
                index === picked && 'bg-selected',
              )}
            >
              <PercentField
                label="Position (%)"
                value={stop.at}
                onChange={(at) => setStop(index, { at }, 'stop')}
              />
              <ColorField
                label="Farbe"
                value={stop.color}
                onChange={(color) => setStop(index, { color }, 'stop-color')}
                opacity={stopOpacity(stop)}
                onOpacity={(opacity) =>
                  setStops(
                    layer.stops.map((item, at) =>
                      at === index ? makeStop(item.color, item.at, opacity) : item,
                    ),
                    'stop-opacity',
                  )
                }
              />
              <HexField value={stop.color} onChange={(color) => setStop(index, { color })} />
              <PercentField
                label="Deckkraft (%)"
                value={stopOpacity(stop)}
                onChange={(opacity) =>
                  setStops(
                    layer.stops.map((item, at) =>
                      at === index ? makeStop(item.color, item.at, opacity) : item,
                    ),
                    'stop-opacity',
                  )
                }
              />
              <IconButton
                icon="remove"
                label="Farbe entfernen"
                size="compact"
                disabled={layer.stops.length <= 2}
                onClick={() => removeStop(index)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
