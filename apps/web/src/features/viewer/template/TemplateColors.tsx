import { PALETTE_MAX_COLORS, type TemplateColor } from '@slider/shared';
import { useEffect, useRef, useState } from 'react';
import { Button, cn, IconButton, usePopover } from '@/ui';
import { ColorPalette, FloatingPanel } from '../editing/colors/ColorPalette';
import { useTemplate } from './useTemplate';

/**
 * „Farben“ of a template being designed, in its controls row: the colours decks made from it
 * offer – the only ones besides each deck's own. Each with what it is for, if one likes
 * („Primär“, „Text“, „Hintergrund“). Rows as a fill's layers: a click on one opens the picker
 * under the list; + („Farbe hinzufügen“) adds one and opens it.
 */
export function TemplateColors() {
  const { template, update } = useTemplate();
  const { open, triggerProps, triggerRef, wrapperRef, panelRef, panelId } = usePopover({
    hasPopup: 'dialog',
  });
  /** The colour whose picker is open. */
  const [picking, setPicking] = useState<number | null>(null);
  // While the picker is dragged: shown at once, saved once it rests.
  const [draft, setDraft] = useState<TemplateColor[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<TemplateColor[] | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) update({ colors: pending.current });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flushes once, on unmount
    [],
  );
  if (!template) return null;
  const saved = template.colors ?? [];
  const colors = draft ?? saved;
  const save = (next: TemplateColor[]) => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    setDraft(null);
    update({ colors: next });
  };
  const saveSoon = (next: TemplateColor[]) => {
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), 300);
  };
  const replace = (index: number, patch: Partial<TemplateColor>) =>
    colors.map((entry, at) => (at === index ? { ...entry, ...patch } : entry));

  return (
    <span ref={wrapperRef} className="flex">
      <Button
        variant="ghost"
        size="sm"
        weight="normal"
        icon="formatColorFill"
        {...triggerProps}
        title="Farben der Vorlage"
      >
        Farben
        {saved.length > 0 && (
          <span className="flex -space-x-1" aria-hidden>
            {saved.slice(0, 5).map(({ color }, index) => (
              <span
                key={index}
                className="size-3 rounded-full ring-1 ring-glass-solid"
                style={{ backgroundColor: color }}
              />
            ))}
          </span>
        )}
      </Button>
      {open && (
        <FloatingPanel
          anchorRef={triggerRef}
          panelRef={panelRef}
          panelId={panelId}
          label="Farben der Vorlage"
          className="w-80 gap-3"
        >
          <header className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <h2 className="mr-auto text-sm font-medium text-fg">Farben der Vorlage</h2>
              {colors.length < PALETTE_MAX_COLORS && (
                <IconButton
                  icon="add"
                  label="Farbe hinzufügen"
                  size="compact"
                  onClick={() => {
                    save([...colors, { color: '#2563eb', name: '' }]);
                    setPicking(colors.length);
                  }}
                />
              )}
            </div>
            <p className="text-xs leading-4 text-fg-subtle">
              Präsentationen aus dieser Vorlage bieten nur diese Farben an – dazu ihre eigenen.
            </p>
          </header>
          {colors.length === 0 ? (
            <p className="text-xs text-fg-subtle">Noch keine – + fügt eine hinzu.</p>
          ) : (
            // As a fill's layers: a row per colour, the one picked highlighted, its picker under
            // the list.
            <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto" aria-label="Farben">
              {colors.map((entry, index) => (
                <li
                  key={index}
                  className={cn(
                    'flex items-center gap-1 rounded-control-sm py-0.5 pr-0.5 pl-1',
                    picking === index && 'bg-selected',
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Farbe ${index + 1} wählen`}
                    title={`Farbe ${index + 1} wählen`}
                    aria-expanded={picking === index}
                    onClick={() => setPicking((open) => (open === index ? null : index))}
                    className="flex w-24 shrink-0 items-center gap-2 rounded-control-sm text-left focus-visible:outline-2 focus-visible:outline-border-focus"
                  >
                    <span
                      className="size-5 shrink-0 rounded-[5px] ring-1 ring-border"
                      style={{ backgroundColor: entry.color }}
                      aria-hidden
                    />
                    <span className="truncate text-xs text-fg tabular-nums">
                      {entry.color.slice(1).toUpperCase()}
                    </span>
                  </button>
                  <input
                    key={`${index}:${entry.name}`}
                    aria-label={`Wofür Farbe ${index + 1} ist`}
                    placeholder="Wofür, z. B. Primär"
                    defaultValue={entry.name}
                    maxLength={60}
                    onBlur={(event) => {
                      const name = event.target.value.trim();
                      if (name !== entry.name) save(replace(index, { name }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                    className="field-well focus-field h-7 min-w-0 flex-1 rounded-control-sm px-2 text-xs"
                  />
                  <IconButton
                    icon="delete"
                    label="Farbe löschen"
                    size="compact"
                    onClick={() => {
                      save(colors.filter((_, at) => at !== index));
                      setPicking((open) =>
                        open === null || open === index ? null : open > index ? open - 1 : open,
                      );
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          {picking !== null && colors[picking] && (
            <div className="rounded-control-sm bg-surface-1 p-2">
              <ColorPalette
                value={colors[picking].color}
                onChange={(color) => saveSoon(replace(picking, { color }))}
              />
            </div>
          )}
        </FloatingPanel>
      )}
    </span>
  );
}
