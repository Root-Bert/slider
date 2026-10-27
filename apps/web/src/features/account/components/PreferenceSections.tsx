import { useId, useState } from 'react';
import type { AccentColor } from '@slider/shared';
import { useUpdateMe } from '@/lib/api';
import { loadStoredBoxMode, storeBoxMode } from '@/lib/preferences/box-mode';
import {
  loadWorkPreferences,
  storeWorkPreferences,
  type StatusFilter,
  type WorkPreferences,
} from '@/lib/preferences/work-preferences';
import { ColorSwatches, Icon, Section, SegmentedControl, Toggle, type ShowToast } from '@/ui';

/** Sections of `/einstellungen`: your colour and how decks open ("Arbeiten"). */

// ── Colour ──────────────────────────────────────────────────────────────────

/**
 * "Deine Farbe": pins, lines and drawings of your comments. Saved to the account (also the
 * comments you already wrote), the same as the picker on your avatar in the viewer.
 */
export function ColorPicker({ color, onNotify }: { color: AccentColor; onNotify: ShowToast }) {
  const updateMe = useUpdateMe();
  const labelId = useId();
  const shown = updateMe.isPending ? (updateMe.variables.color ?? color) : color;
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
      <ColorSwatches
        value={shown}
        onChange={pick}
        labelledBy={labelId}
        disabled={updateMe.isPending}
        size={32}
        className="flex-wrap gap-3"
      />
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
      description="So öffnet sich jede Review. Gilt für diesen Browser – in der Review selbst kannst du alles weiterhin umschalten."
    >
      <div className="flex flex-col divide-y divide-hairline">
        <Toggle
          className="pb-3"
          label="Hilfslinien zeigen"
          icon="guides"
          description="Hilfslinien der Präsentation und Boxen, die darüber ragen (G)"
          checked={preferences.showGuides}
          onChange={(showGuides) => update({ showGuides })}
        />
        <Toggle
          className="py-3"
          label="Ausgeblendete Folien zeigen"
          icon="visibilityOff"
          description="Folien, die in der Präsentation ausgeblendet sind, samt ihren Kommentaren (H)"
          checked={preferences.showHiddenSlides}
          onChange={(showHiddenSlides) => update({ showHiddenSlides })}
        />
        <Toggle
          className="py-3"
          label="Box-Modus"
          icon="boxSelect"
          description="Ein Klick kommentiert die Box unter dem Zeiger (B)"
          checked={boxMode}
          onChange={(on) => {
            setBoxMode(on);
            storeBoxMode(on);
          }}
        />
        <Toggle
          className="py-3"
          label="Änderungshinweise"
          icon="difference"
          description="„Neu“, „Geändert“ und „Verschoben“ an den Folien der neuesten Version"
          checked={preferences.showChanges}
          onChange={(showChanges) => update({ showChanges })}
        />
        <Toggle
          className="py-3"
          label="Folienübersicht ausblenden"
          icon="minimap"
          description="Die Miniaturen unter den Folien – der Knopf neben der Seitenzahl blendet sie wieder ein"
          checked={preferences.hideMinimap}
          onChange={(hideMinimap) => update({ hideMinimap })}
        />
        <Toggle
          className="py-3"
          label="Kleine Elemente heranzoomen"
          icon="openInFull"
          description="Beim Bearbeiten zoomt die Folie an zu kleine Elemente heran und danach wieder heraus"
          checked={preferences.autoZoom}
          onChange={(autoZoom) => update({ autoZoom })}
        />
        <Toggle
          className="py-3"
          label="An Kommentare heranzoomen"
          icon="openInFull"
          description="Ein geöffneter Kommentar zu einer kleinen Markierung zoomt die Folie heran, beim Schließen wieder heraus"
          checked={preferences.commentZoom}
          onChange={(commentZoom) => update({ commentZoom })}
        />
        <div className="flex items-center justify-between gap-4 pt-3">
          {/* Laid out like a `Toggle` row with its icon. */}
          <span className="flex min-w-0 items-center gap-3">
            <Icon name="chatBubble" size={20} className="shrink-0 text-fg-muted" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm text-fg">Kommentare</span>
              <span className="text-xs text-fg-subtle">Welche beim Öffnen sichtbar sind</span>
            </span>
          </span>
          <SegmentedControl<StatusFilter>
            label="Kommentare beim Öffnen"
            value={preferences.statusFilter}
            onChange={(statusFilter) => update({ statusFilter })}
            segments={[
              { value: 'open', label: 'Offen' },
              { value: 'all', label: 'Alle' },
              { value: 'hidden', label: 'Keine' },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}
