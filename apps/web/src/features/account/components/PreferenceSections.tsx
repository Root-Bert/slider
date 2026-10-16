import { useId, useState } from 'react';
import { ACCENT_COLORS, type AccentColor } from '@slider/shared';
import { ACCENT_COLOR_NAMES, accentColor, isLightAccent } from '@/lib/accent';
import { useUpdateMe } from '@/lib/api';
import { loadStoredBoxMode, storeBoxMode } from '@/lib/preferences/box-mode';
import {
  loadWorkPreferences,
  storeWorkPreferences,
  type StatusFilter,
  type WorkPreferences,
} from '@/lib/preferences/work-preferences';
import { cn, Icon, Section, SegmentedControl, Toggle, type ShowToast } from '@/ui';

/** Sections of `/einstellungen`: your colour and how decks open ("Arbeiten"). */

// ── Colour ──────────────────────────────────────────────────────────────────

/**
 * "Deine Farbe": pins, lines and drawings of your comments. Saved to the account (also the
 * comments you already wrote), the same as the picker on your avatar in the viewer.
 */
export function ColorPicker({ color, onNotify }: { color: AccentColor; onNotify: ShowToast }) {
  const updateMe = useUpdateMe();
  const labelId = useId();
  const shown = updateMe.isPending ? updateMe.variables.color : color;
  const pick = (next: AccentColor) => {
    if (next === shown) return;
    updateMe.mutate(
      { color: next },
      { onError: () => onNotify('Farbe konnte nicht gespeichert werden.', 'danger') },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm text-fg">
        Deine Farbe
        <span className="block text-xs text-fg-subtle">
          Für deine Markierungen, Linien und Zeichnungen – alle sehen sie so.
        </span>
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="flex flex-wrap items-center gap-3"
      >
        {ACCENT_COLORS.map((option) => {
          const selected = option === shown;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={ACCENT_COLOR_NAMES[option]}
              title={ACCENT_COLOR_NAMES[option]}
              disabled={updateMe.isPending}
              onClick={() => pick(option)}
              className={cn(
                'flex size-8 items-center justify-center rounded-full outline-offset-2 transition-transform hover:scale-110 disabled:cursor-wait disabled:hover:scale-100',
                selected && 'ring-2 ring-white/90 ring-offset-2 ring-offset-black/40',
              )}
              style={{ backgroundColor: accentColor(option) }}
            >
              {selected && (
                <Icon
                  name="check"
                  size={16}
                  className={isLightAccent(option) ? 'text-black' : 'text-white'}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Arbeiten ────────────────────────────────────────────────────────────────

/**
 * How every deck opens. Per browser (like the split): the switches in the viewer change only the
 * open deck.
 */
export function WorkSection() {
  const [preferences, setPreferences] = useState(loadWorkPreferences);
  const [boxMode, setBoxMode] = useState(loadStoredBoxMode);

  const update = (patch: Partial<WorkPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    storeWorkPreferences(next);
  };

  return (
    <Section
      title="Arbeiten"
      description="So öffnet sich jedes Review. Gilt für diesen Browser – im Review selbst kannst du alles weiterhin umschalten."
    >
      <div className="flex flex-col divide-y divide-hairline">
        <Toggle
          className="pb-3"
          label="Hilfslinien zeigen"
          description="PowerPoint-Hilfslinien und Boxen, die darüber ragen (G)"
          checked={preferences.showGuides}
          onChange={(showGuides) => update({ showGuides })}
        />
        <Toggle
          className="py-3"
          label="Ausgeblendete Folien zeigen"
          description="Folien, die in PowerPoint ausgeblendet sind, samt ihren Kommentaren (H)"
          checked={preferences.showHiddenSlides}
          onChange={(showHiddenSlides) => update({ showHiddenSlides })}
        />
        <Toggle
          className="py-3"
          label="Box-Modus"
          description="Ein Klick kommentiert die PowerPoint-Box unter dem Zeiger (B)"
          checked={boxMode}
          onChange={(on) => {
            setBoxMode(on);
            storeBoxMode(on);
          }}
        />
        <Toggle
          className="py-3"
          label="Änderungen markieren"
          description="Folien, die sich in der neuesten Version geändert haben"
          checked={preferences.showChanges}
          onChange={(showChanges) => update({ showChanges })}
        />
        <div className="flex items-center justify-between gap-4 pt-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm text-fg">Kommentare</span>
            <span className="text-xs text-fg-subtle">Welche beim Öffnen sichtbar sind</span>
          </span>
          <SegmentedControl<StatusFilter>
            label="Kommentare beim Öffnen"
            value={preferences.statusFilter}
            onChange={(statusFilter) => update({ statusFilter })}
            segments={[
              { value: 'open', label: 'Offen' },
              { value: 'all', label: 'Alle' },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}
