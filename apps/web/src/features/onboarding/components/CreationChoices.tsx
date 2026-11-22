import { useId } from 'react';
import { DECK_KINDS, MAX_CREATED_SLIDES, MIN_CREATED_SLIDES, type DeckKind } from '@slider/shared';
import { Button, cn, Icon, NumberField, type IconName } from '@/ui';

const KIND_ICONS: Record<DeckKind, IconName> = {
  school: 'article',
  pitch: 'arrowUpward',
  consulting: 'compareArrows',
  brand: 'localOffer',
  sales: 'send',
  status: 'checkCircleOutline',
  training: 'draw',
  keynote: 'mic',
};

/**
 * „Art der Präsentation“: the 8 kinds as cards, one picked – on Neue Präsentation and in the
 * prompt on Folie 1 alike.
 */
export function KindChoice({
  kind,
  onChange,
  className,
}: {
  kind: DeckKind;
  onChange: (kind: DeckKind) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <fieldset className={cn('flex flex-col gap-2', className)} aria-describedby={id}>
      <legend className="mb-2 text-xs font-medium text-fg-muted">Art der Präsentation</legend>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {DECK_KINDS.map((each) => {
          const selected = each.id === kind;
          return (
            <label
              key={each.id}
              title={each.meaning}
              className={cn(
                'group relative flex h-10 cursor-pointer items-center gap-2 rounded-control bg-surface-1 px-2.5 text-body whitespace-nowrap text-fg-muted ring-2 ring-transparent transition-[box-shadow,background-color,color,scale] duration-150',
                'hover:bg-hover hover:text-fg has-focus-visible:ring-fg',
                selected && 'bg-selected! font-medium text-fg! ring-fg!',
              )}
            >
              <input
                type="radio"
                name={`${id}-kind`}
                checked={selected}
                onChange={() => onChange(each.id)}
                className="sr-only"
              />
              <Icon name={KIND_ICONS[each.id]} size={16} className="shrink-0" />
              <span>{each.label}</span>
            </label>
          );
        })}
      </div>
      <p id={id} className="sr-only">
        Die Art bestimmt Aufbau, Ton und Textmenge der Folien.
      </p>
    </fieldset>
  );
}

/**
 * „Seitenzahl“: „Automatisch“ (the default – as many slides as the content needs) or a number,
 * starting from the kind's suggestion.
 */
export function PagesChoice({
  pages,
  byAi,
  onPages,
  onByAi,
}: {
  pages: number;
  byAi: boolean;
  onPages: (pages: number) => void;
  onByAi: (byAi: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-xs font-medium text-fg-muted">
        Seitenzahl
        {!byAi && (
          <NumberField
            label="Seitenzahl"
            value={pages}
            onChange={(value) => onPages(Math.round(value))}
            min={MIN_CREATED_SLIDES}
            max={MAX_CREATED_SLIDES}
            step={1}
            decimals={0}
            size="md"
          />
        )}
      </label>
      <Button
        size="sm"
        variant={byAi ? 'secondary' : 'ghost'}
        icon="autoAwesome"
        aria-pressed={byAi}
        title={`Die KI wählt ${MIN_CREATED_SLIDES}–${MAX_CREATED_SLIDES} Folien, so viele der Inhalt braucht`}
        onClick={() => onByAi(!byAi)}
      >
        Automatisch
      </Button>
    </div>
  );
}
