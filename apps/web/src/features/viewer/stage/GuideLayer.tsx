import { guideOverflows, type Guide, type Slide } from '@slider/shared';
import { useMemo } from 'react';
import { GUIDE_COLORS } from '@/lib/palette';
import { cn } from '@/ui';
import { useEditing } from '../editing/editing-context';
import { MisspeltWords } from '../spelling/MisspeltWords';
import { underlinable } from '../spelling/underlinable';
import { useKnowsWord, useMisspellings } from '../spelling/useMisspellings';
import { ShapeOutline } from './ShapeOutline';

const { guide: GUIDE_COLOR, overflow: OVERFLOW_COLOR, spelling: SPELLING_COLOR } = GUIDE_COLORS;

/**
 * "Hilfslinien zeigen": PowerPoint's drawing guides over the slide image, and the boxes that
 * stick out over the outer guides (the margins) – outlined, with the part beyond the guide
 * hatched; the guides button in the tool bar glows while any does (`ToolBar`). The same check
 * finds misspelt words (`useMisspellings`): underlined where they stand when the deck's texts are
 * there to lay out (`MisspeltWords`, right click on one: „Passt so“) – else, the slide a picture,
 * their box outlined in another colour and the words named under it. Never a pointer target. `guides` instead of the slide's own: a template being designed keeps its guides itself
 * (`Deck.template`).
 */
export function GuideLayer({ slide, guides: own }: { slide: Slide; guides?: readonly Guide[] }) {
  const guides = useMemo(() => own ?? slide.guides ?? [], [own, slide.guides]);
  const overflows = useMemo(() => guideOverflows(slide.shapes, guides), [slide.shapes, guides]);
  const misspellings = useMisspellings(slide.shapes, true);
  const crossing = useMemo(() => new Set(overflows.map(({ shape }) => shape.id)), [overflows]);
  const knows = useKnowsWord(true);
  const editing = useEditing();
  // The text being typed is the browser's to check: it underlines as it goes, Slider's marks
  // would stand on the old words until the server has the new ones.
  const typing = editing.available ? editing.textEditing : null;
  const found = underlinable(
    editing.available ? editing.elementsOf(slide.id) : [],
    misspellings,
  ).filter(({ id }) => id !== typing);
  // The same texts, the same list: the editor reads its elements anew each time.
  const foundKey = JSON.stringify(found.map(({ id, bbox, live }) => [id, bbox, live]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const underlined = useMemo(() => found, [foundKey]);
  const inPlace = useMemo(() => new Set(underlined.map(({ id }) => id)), [underlined]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-guide-layer>
      {guides.map((guide) => {
        const horizontal = guide.orientation === 'horizontal';
        return (
          <div
            key={`${guide.orientation}:${guide.position}`}
            className={cn(
              'absolute opacity-80',
              horizontal ? 'inset-x-0 h-px -translate-y-1/2' : 'inset-y-0 w-px -translate-x-1/2',
            )}
            style={{
              [horizontal ? 'top' : 'left']: `${guide.position * 100}%`,
              backgroundColor: GUIDE_COLOR,
            }}
          />
        );
      })}
      {knows && underlined.length > 0 && (
        <MisspeltWords elements={underlined} pageSize={editing.pageSize} knows={knows} />
      )}
      {misspellings
        .filter(({ shape }) => !inPlace.has(shape.id) && shape.id !== typing)
        .map(({ shape, words }) => (
          <div key={shape.id} data-misspelt={shape.id}>
            {/* Over the guides too: that outline stands, the words are named all the same. */}
            {!crossing.has(shape.id) && (
              <ShapeOutline shape={shape} variant="emphasis" color={SPELLING_COLOR} />
            )}
            <div
              className="absolute mt-0.5 max-w-[45%] truncate rounded-chip px-1.5 py-0.5 text-caption font-medium text-black underline decoration-wavy decoration-1 underline-offset-2"
              style={{
                left: `${shape.bbox.x * 100}%`,
                top: `${(shape.bbox.y + shape.bbox.h) * 100}%`,
                backgroundColor: SPELLING_COLOR,
              }}
            >
              {words.join(', ')}
            </div>
          </div>
        ))}
      {overflows.map(({ shape, overflow }) => (
        <div key={shape.id}>
          <ShapeOutline shape={shape} variant="emphasis" color={OVERFLOW_COLOR} />
          {overflow.map((rect, index) => (
            <div
              key={index}
              className="absolute"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
                backgroundImage: `repeating-linear-gradient(135deg, color-mix(in srgb, ${OVERFLOW_COLOR} 45%, transparent) 0 3px, transparent 3px 7px)`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
