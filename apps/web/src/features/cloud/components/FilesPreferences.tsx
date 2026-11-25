import { useId } from 'react';
import { useSetShowExtensions } from '@/lib/api';
import { Section, SegmentedControl, Select, Toggle, type ShowToast } from '@/ui';
import { useShowExtensions } from '../hooks/useShowExtensions';
import { useStoredChoice } from '../hooks/useStoredChoice';
import { AppTag } from './AppMark';
import { CLOUD_SORTS, CLOUD_VIEWS, SIDEBAR_KEY, SIDEBAR_STATES, SORT_LABELS } from '../lib/kinds';

const SORT_OPTIONS = CLOUD_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }));
const VIEW_SEGMENTS = [
  { value: 'list', label: 'Liste' },
  { value: 'tiles', label: 'Kacheln' },
] as const;
const SIDEBAR_SEGMENTS = [
  { value: 'open', label: 'Ausgeklappt' },
  { value: 'icons', label: 'Eingeklappt' },
] as const;

/**
 * Cloud's part of `/einstellungen`, marked as Cloud's: how the files open – as rows or tiles, in which order (the
 * same choices as over every list, kept in this browser) and whether their names show the ending (the account's).
 */
export function FilesPreferences({ onNotify }: { onNotify: ShowToast }) {
  const [view, setView] = useStoredChoice('slider.cloud.view', CLOUD_VIEWS, 'list');
  const [sort, setSort] = useStoredChoice('slider.cloud.sort', CLOUD_SORTS, 'name');
  const [sidebar, setSidebar] = useStoredChoice(SIDEBAR_KEY, SIDEBAR_STATES, 'open');
  const extensions = useShowExtensions();
  const setExtensions = useSetShowExtensions();
  const viewId = useId();
  const sortId = useId();
  return (
    <Section
      id="dateien"
      title="Dateien"
      aside={<AppTag app="cloud" />}
      description="So öffnen sich die Dateien. Darstellung, Seitenleiste und Reihenfolge gelten für diesen Browser, über jeder Liste kannst du weiterhin umschalten."
    >
      <div className="flex flex-col divide-y divide-hairline">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <span id={viewId} className="text-sm text-fg">
            Darstellung
            <span className="block text-xs text-fg-subtle">Als Zeilen oder als Kacheln</span>
          </span>
          <SegmentedControl
            label="Darstellung"
            size="sm"
            track="soft"
            segments={VIEW_SEGMENTS}
            value={view}
            onChange={setView}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span className="text-sm text-fg">
            Seitenleiste
            <span className="block text-xs text-fg-subtle">Mit Namen oder nur als Symbole</span>
          </span>
          <SegmentedControl
            label="Seitenleiste"
            size="sm"
            track="soft"
            segments={SIDEBAR_SEGMENTS}
            value={sidebar}
            onChange={setSidebar}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-3">
          <span id={sortId} className="text-sm text-fg">
            Sortieren nach
            <span className="block text-xs text-fg-subtle">Die Reihenfolge in jedem Ordner</span>
          </span>
          <Select aria-labelledby={sortId} value={sort} onChange={setSort} options={SORT_OPTIONS} />
        </div>
        <Toggle
          className="pt-3"
          label="Dateiendungen zeigen"
          description="„Bericht.pdf“ statt „Bericht“, auf allen deinen Geräten"
          checked={extensions}
          onChange={(shown) =>
            setExtensions.mutate(shown, {
              onError: () => onNotify('Einstellung konnte nicht gespeichert werden.', 'danger'),
            })
          }
        />
      </div>
    </Section>
  );
}
