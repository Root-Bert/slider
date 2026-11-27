import { useEffect, useId, useState } from 'react';
import type { AccentColor } from '@slider/shared';
import { useUpdateMe } from '@/lib/api';
import {
  AppMark,
  AppTag,
  cloudBridge,
  type AppWhere,
  type CloudApps,
  type PlacedApp,
} from '@/features/cloud';
import { loadStoredBoxMode, storeBoxMode } from '@/lib/preferences/box-mode';
import {
  loadWorkPreferences,
  storeWorkPreferences,
  type StatusFilter,
  type WorkPreferences,
} from '@/lib/preferences/work-preferences';
import { writeString } from '@/lib/storage';
import { readViewDefault, VIEW_DEFAULT_KEY, type ViewDefault } from '@/lib/view-choice';
import { ColorSwatches, Icon, Section, SegmentedControl, Toggle, type ShowToast } from '@/ui';

/** Sections of `/einstellungen`: your colour and how presentations open (Slider's part). */

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

const VIEW_DEFAULT_SEGMENTS = [
  { value: 'auto', label: 'Automatisch' },
  { value: 'list', label: 'Liste' },
  { value: 'tiles', label: 'Kacheln' },
] as const satisfies readonly { value: ViewDefault; label: string }[];

/**
 * How every page with „Liste“ / „Kacheln“ opens, in this browser (`useViewChoice`): as one had it
 * there last, or always as rows or tiles – switched on a page, it stays so until one leaves it.
 */
export function ViewDefaultChoice() {
  const [choice, setChoice] = useState(readViewDefault);
  const pick = (next: ViewDefault) => {
    setChoice(next);
    writeString(VIEW_DEFAULT_KEY, next);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <span className="text-sm text-fg">
        Liste oder Kacheln
        <span className="block text-xs text-fg-subtle">
          Wie sich jede Seite öffnet, in diesem Browser – automatisch so, wie du sie dort zuletzt
          hattest
        </span>
      </span>
      <SegmentedControl
        label="Liste oder Kacheln"
        size="sm"
        track="soft"
        segments={VIEW_DEFAULT_SEGMENTS}
        value={choice}
        onChange={pick}
      />
    </div>
  );
}

// ── Präsentationen ────────────────────────────────────────────────────────────────

// ── Apps ────────────────────────────────────────────────────────────────────

const APP_ROWS: { app: PlacedApp; name: string; what: string }[] = [
  { app: 'slider', name: 'Slider', what: 'Präsentationen' },
  { app: 'writer', name: 'Writer', what: 'Dokumente' },
  { app: 'reader', name: 'Reader', what: 'PDFs' },
  { app: 'sender', name: 'Sender', what: 'Nachrichten' },
];

/**
 * Cloud's app only: where each app's pages open – in Cloud, a tab of that window with the whole
 * app in it, or in the app of its own, where that is installed (desktop/cloud/main.mjs keeps
 * it, per computer). Without the app there is nothing to pick: its pages open in Cloud.
 */
export function AppsSection() {
  const [apps, setApps] = useState<CloudApps | null>(null);
  useEffect(() => {
    let live = true;
    void cloudBridge()
      ?.apps?.()
      .then((said) => {
        if (live && said) setApps(said);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!apps) return null;
  const pick = (app: PlacedApp, where: AppWhere) => {
    const now = apps[app];
    if (now) setApps({ ...apps, [app]: { ...now, where } });
    void cloudBridge()
      ?.setApp?.(app, where)
      .then((said) => {
        if (said) setApps(said);
      })
      .catch(() => undefined);
  };
  return (
    <Section
      id="apps"
      title="Apps"
      aside={<AppTag app="cloud" />}
      description="Wo sich Präsentationen, Dokumente, PDFs und Nachrichten öffnen. In Cloud heißt in einem Tab dieses Fensters, mit allem, was die App kann. Gilt für diesen Computer."
    >
      <div className="flex flex-col divide-y divide-hairline">
        {APP_ROWS.flatMap(({ app, name, what }) => {
          const placed = apps[app];
          // An older Cloud app does not place this one yet: nothing to pick.
          if (!placed) return [];
          return [
            <div
              key={app}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <AppMark app={app} width={18} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm text-fg">{what}</span>
                  <span className="text-xs text-fg-subtle">
                    {placed.installed
                      ? `In Cloud oder in ${name}`
                      : `Öffnen sich in Cloud, ${name} ist nicht installiert`}
                  </span>
                </span>
              </span>
              {placed.installed && (
                <SegmentedControl<AppWhere>
                  label={`${what} öffnen`}
                  size="sm"
                  track="soft"
                  segments={[
                    { value: 'tab', label: 'In Cloud' },
                    { value: 'own', label: `In ${name}` },
                  ]}
                  value={placed.where}
                  onChange={(where) => pick(app, where)}
                />
              )}
            </div>,
          ];
        })}
      </div>
    </Section>
  );
}

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
      id="arbeiten"
      title="Präsentationen"
      aside={<AppTag app="slider" />}
      description="So öffnet sich jede Präsentation. Gilt für diesen Browser – in der Präsentation selbst kannst du alles weiterhin umschalten."
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
          description="Folien, die in der Präsentation ausgeblendet sind, samt ihren Kommentaren"
          checked={preferences.showHiddenSlides}
          onChange={(showHiddenSlides) => update({ showHiddenSlides })}
        />
        <Toggle
          className="py-3"
          label="Box-Modus"
          icon="gridViewFill"
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
            size="sm"
            track="soft"
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
