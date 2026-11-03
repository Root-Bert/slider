import {
  CENTRED,
  type EditableElement,
  type ElementPicture,
  type ImageFit,
  type PictureFit,
  type PictureFocus,
} from '@slider/shared';
import { Button, NumberField, SegmentedControl } from '@/ui';
import { groundCrop, pictureFit, useFitPicture, usePictureFit, type FillCrop } from './picture-fit';
import { useEditing } from './editing-context';
import { Line } from './StyleControls';

const FITS = [
  { value: 'fill', label: 'Füllen', title: 'Auf den Rahmen zugeschnitten, ohne Verzerrung' },
  { value: 'stretch', label: 'Strecken', title: 'Das ganze Bild auf den Rahmen gezogen' },
] as const satisfies readonly { value: PictureFit; label: string; title: string }[];

/** Fits a picture fill of a file may have besides (read from it): shown while it has one. */
const OTHER_FITS: Record<Exclude<ImageFit, PictureFit>, { label: string; title: string }> = {
  fit: { label: 'Einpassen', title: 'Das ganze Bild im Rahmen, ohne Verzerrung' },
  tile: { label: 'Kacheln', title: 'Das Bild in seiner Größe wiederholt' },
};

/**
 * How a picked picture fills its frame, in its panel: „Füllen“ (cut to the frame) or „Strecken“
 * (all of it, stretched) – the one it has picked from the start –, and „Ausschnitt“: the part a
 * filled picture shows, chosen on the slide (`PictureFitLayer`), its zoom here too.
 */
export function ImageFitControls({
  element,
  picture,
  slideId,
}: {
  element: EditableElement;
  picture: ElementPicture;
  slideId: string;
}) {
  const fit = useFitPicture(slideId);
  const { cropping } = usePictureFit();
  // A placeholder's drawing (no picture yet) has nothing to fit.
  if (!picture.src || picture.src.endsWith('.svg')) return null;
  const choosing = cropping?.elementId === element.id && !cropping.fill;
  return (
    <PictureFitChoice
      fit={picture.fit}
      focus={picture.focus}
      chosen={choosing ? cropping.focus : undefined}
      onFit={(next) => fit(element, next)}
      onCrop={() => pictureFit.crop(element.id)}
      hint="Bild ziehen, mit dem Mausrad zoomen (Doppelklick aufs Bild)"
    />
  );
}

/**
 * The same for a shape filled with a picture (a layer of its fill, `fill`): its part chosen on the
 * slide as a picture's – one behaviour for both.
 */
export function FillFitControls({
  elementId,
  fill,
  onFit,
  hint = elementId.startsWith(groundCrop(''))
    ? 'Bild ziehen, mit dem Mausrad zoomen'
    : 'Bild ziehen, mit dem Mausrad zoomen (Doppelklick auf die Form, wenn sie keinen Text hat)',
}: {
  /** The element filled – or the slide whose background it is (`groundCrop`). */
  elementId: string;
  fill: FillCrop;
  onFit: (fit: PictureFit) => void;
  /** How the part is chosen (the button's title). */
  hint?: string;
}) {
  const editing = useEditing();
  const { cropping } = usePictureFit();
  const choosing = cropping?.elementId === elementId && cropping.fill?.layer === fill.layer;
  return (
    <PictureFitChoice
      fit={fill.fit}
      focus={fill.focus}
      chosen={choosing ? cropping.focus : undefined}
      onFit={onFit}
      onCrop={() => {
        // Chosen on the slide in Bearbeiten (the background's panel opens in Besprechen too).
        if (!editing.active) editing.setActive(true);
        pictureFit.crop(elementId, fill);
      }}
      hint={hint}
    />
  );
}

/**
 * „Rahmen füllen“ and „Ausschnitt“: `chosen` – the part chosen on the slide so far while it is
 * (`null`: none yet), `undefined` while not.
 */
function PictureFitChoice({
  fit,
  focus,
  chosen,
  onFit,
  onCrop,
  hint,
}: {
  fit: ImageFit;
  focus: PictureFocus | null;
  chosen: PictureFocus | null | undefined;
  onFit: (fit: PictureFit) => void;
  onCrop: () => void;
  /** How the part is chosen (the button's title). */
  hint: string;
}) {
  const choosing = chosen !== undefined;
  const zoom = (chosen ?? focus ?? CENTRED).zoom;
  const segments =
    fit === 'fill' || fit === 'stretch' ? FITS : [...FITS, { value: fit, ...OTHER_FITS[fit] }];
  return (
    <div className="flex flex-col gap-2">
      <Line label="Rahmen füllen">
        <SegmentedControl<ImageFit>
          segments={segments}
          value={fit}
          onChange={(next) => {
            if (choosing) pictureFit.crop(null);
            if (next !== fit && (next === 'fill' || next === 'stretch')) onFit(next);
          }}
          label="Wie das Bild den Rahmen füllt"
          size="sm"
          track="soft"
        />
      </Line>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={choosing ? 'primary' : 'secondary'}
          icon="crop"
          aria-pressed={choosing}
          title={choosing ? 'Ausschnitt übernehmen (↵)' : `Ausschnitt wählen: ${hint}`}
          onClick={() => {
            if (choosing) pictureFit.finish();
            else onCrop();
          }}
          className="flex-1"
        >
          {choosing ? 'Ausschnitt übernehmen' : 'Ausschnitt'}
        </Button>
        {choosing && (
          <NumberField
            label="Zoom"
            value={Math.round(zoom * 100)}
            unit="%"
            min={100}
            max={2000}
            step={5}
            onChange={(percent) =>
              pictureFit.focus({
                ...(chosen ?? (fit === 'fill' ? focus : null) ?? CENTRED),
                zoom: percent / 100,
              })
            }
            className="w-20"
          />
        )}
      </div>
    </div>
  );
}
