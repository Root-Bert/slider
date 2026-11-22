import type {
  ENTRANCE_SIDES} from '@slider/shared';
import {
  type EditableElement,
  type ElementEntranceEffect,
  type Entrance,
} from '@slider/shared';
import { Select, SegmentedControl } from '@/ui';
import { useEditing } from './editing-context';
import { Line } from './StyleControls';

const EFFECTS = [
  { value: 'none', label: 'Ohne' },
  { value: 'appear', label: 'Erscheinen' },
  { value: 'fade', label: 'Einblenden' },
  { value: 'rise', label: 'Aufsteigen' },
  { value: 'fly', label: 'Hereinfliegen' },
  { value: 'zoom', label: 'Zoomen' },
  { value: 'wipe', label: 'Wischen' },
] as const satisfies readonly { value: ElementEntranceEffect | 'none'; label: string }[];

const STARTS = [
  { value: 'after', label: 'Nach dem vorigen' },
  { value: 'with', label: 'Mit dem vorigen' },
] as const;

const SIDES = [
  { value: 'left', label: 'Links' },
  { value: 'right', label: 'Rechts' },
  { value: 'top', label: 'Oben' },
  { value: 'bottom', label: 'Unten' },
] as const satisfies readonly { value: (typeof ENTRANCE_SIDES)[number]; label: string }[];

/**
 * The format panel's „Animation“: how the element comes in when the slide is presented – by
 * itself once the slide is there, after the one set before it or with it (no clicks), in the
 * order set. Into the file as LibreOffice's presets: LibreOffice and PowerPoint play it too.
 */
export function EntranceControls({ element }: { element: EditableElement }) {
  const editing = useEditing();
  const entrance = element.entrance;
  const set = (next: Entrance | null) =>
    void editing.apply([{ type: 'setEntrance', elementId: element.id, entrance: next }]);
  const start = entrance?.start === 'with' ? 'with' : 'after';
  return (
    <div className="flex flex-col gap-1.5">
      <Line label="Erscheinen">
        <Select
          value={entrance?.effect ?? 'none'}
          onChange={(effect) =>
            set(
              effect === 'none'
                ? null
                : {
                    effect,
                    start,
                    ...(effect === 'fly' && { from: entrance?.from ?? 'left' }),
                  },
            )
          }
          options={EFFECTS}
          size="sm"
          aria-label="Wie das Element beim Präsentieren erscheint"
        />
      </Line>
      {entrance && (
        <Line label="Beginn">
          <SegmentedControl
            segments={STARTS}
            value={start}
            onChange={(next) =>
              set({
                effect: entrance.effect,
                start: next,
                ...(entrance.from && { from: entrance.from }),
              })
            }
            label="Wann es erscheint"
            size="sm"
            track="soft"
          />
        </Line>
      )}
      {entrance?.effect === 'fly' && (
        <Line label="Von">
          <SegmentedControl
            segments={SIDES}
            value={entrance.from ?? 'left'}
            onChange={(from) => set({ effect: 'fly', start, from })}
            label="Woher es hereinfliegt"
            size="sm"
            track="soft"
          />
        </Line>
      )}
    </div>
  );
}
