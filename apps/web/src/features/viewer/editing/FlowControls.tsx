import type { EditableElement, ElementFlow } from '@slider/shared';
import { IconButton, NumberField, SegmentedControl, type IconName } from '@/ui';
import { useEditing } from './editing-context';
import { inferredFlow } from './lib/flow';
import { shownRect } from './lib/group-layout';
import { Line } from './StyleControls';

type FlowWay = 'free' | ElementFlow['direction'];

const WAYS: { value: FlowWay; label: string; icon: IconName }[] = [
  { value: 'free', label: 'Frei platziert', icon: 'flowFree' },
  { value: 'row', label: 'Nebeneinander', icon: 'flowRow' },
  { value: 'column', label: 'Untereinander', icon: 'flowColumn' },
];
const ACROSS_ROW: { value: ElementFlow['align']; label: string; icon: IconName }[] = [
  { value: 'start', label: 'Oben', icon: 'alignTop' },
  { value: 'center', label: 'Mittig', icon: 'alignMiddle' },
  { value: 'end', label: 'Unten', icon: 'alignBottom' },
];
const ACROSS_COLUMN: { value: ElementFlow['align']; label: string; icon: IconName }[] = [
  { value: 'start', label: 'Links', icon: 'alignLeft' },
  { value: 'center', label: 'Mittig', icon: 'alignCenter' },
  { value: 'end', label: 'Rechts', icon: 'alignRight' },
];

/** The gap a flow spread over its length shows now (cm, a tenth): kept once „Automatisch“ goes. */
function gapNow(
  group: EditableElement,
  flow: ElementFlow,
  aspect: number,
  pageSize: { width: number; height: number },
): number {
  const rects = group.children!.map((child) => shownRect(child, aspect));
  return inferredFlow(rects, pageSize, flow.direction).gap as number;
}

/**
 * The „Anordnen“ tab's „Fluss“ (Figma's auto layout): a group's elements placed freely, in a row
 * or in a column, so far apart or spread over the whole length („Automatisch“), lined up across
 * – laid out again after every edit of them (`flowed`). Its corners set the area they flow in
 * (Figma's fixed size); „An Inhalt anpassen“ makes it as large as they are again. Several picked
 * together: grouped so at once (⇧A).
 */
export function FlowControls({ elements }: { elements: readonly EditableElement[] }) {
  const editing = useEditing();
  const group = elements.length === 1 ? elements[0]! : null;
  if (!group) {
    return (
      <Line label="Fluss">
        <IconButton
          icon="flowRow"
          label="Mit Fluss gruppieren (⇧A)"
          size="compact"
          disabled={editing.busy}
          onClick={() => editing.flowPicked()}
        />
      </Line>
    );
  }
  if (group.kind !== 'group' || !group.children) return null;
  const { flow } = group;
  const pageSize = editing.pageSize;
  const aspect = pageSize.width / pageSize.height;
  const set = (next: ElementFlow | null, coalesce?: string) =>
    void editing.apply(
      [{ type: 'setFlow', elementId: group.id, flow: next }],
      coalesce ? { coalesce: `${coalesce}:${group.id}` } : {},
    );
  return (
    <div className="flex flex-col gap-1.5">
      <Line label="Fluss">
        <SegmentedControl<FlowWay>
          segments={WAYS}
          value={flow?.direction ?? 'free'}
          onChange={(way) => {
            if (way === (flow?.direction ?? 'free')) return;
            if (way === 'free') return set(null);
            const rects = group.children!.map((child) => shownRect(child, aspect));
            set(flow ? { ...flow, direction: way } : inferredFlow(rects, pageSize, way));
          }}
          label="Wie die Elemente der Gruppe stehen"
          size="sm"
          track="soft"
          iconOnly
        />
      </Line>
      {flow && (
        <>
          <Line label="Abstand">
            <IconButton
              icon={flow.direction === 'row' ? 'distributeHorizontal' : 'distributeVertical'}
              label={
                flow.gap === 'auto'
                  ? 'Abstand automatisch (über die ganze Länge verteilt)'
                  : 'Abstand automatisch: über die ganze Länge verteilen'
              }
              size="compact"
              active={flow.gap === 'auto'}
              disabled={editing.busy}
              onClick={() =>
                set({
                  ...flow,
                  gap: flow.gap === 'auto' ? gapNow(group, flow, aspect, pageSize) : 'auto',
                })
              }
            />
            <NumberField
              label="Abstand"
              value={flow.gap === 'auto' ? null : flow.gap}
              unit="cm"
              min={0}
              max={100}
              step={0.1}
              onChange={(gap) => set({ ...flow, gap }, 'flow-gap')}
              className="w-20"
            />
          </Line>
          {flow.frame && (
            <Line label="Größe">
              <IconButton
                icon="fitSize"
                label="An Inhalt anpassen"
                size="compact"
                disabled={editing.busy}
                onClick={() => {
                  const { frame: _frame, ...hug } = flow;
                  set(hug);
                }}
              />
            </Line>
          )}
          <Line
            label={flow.direction === 'row' ? 'Ausrichten (senkrecht)' : 'Ausrichten (waagrecht)'}
          >
            <SegmentedControl<ElementFlow['align']>
              segments={flow.direction === 'row' ? ACROSS_ROW : ACROSS_COLUMN}
              value={flow.align}
              onChange={(align) => align !== flow.align && set({ ...flow, align })}
              label="Wie die Elemente quer zum Fluss stehen"
              size="sm"
              track="soft"
              iconOnly
            />
          </Line>
        </>
      )}
    </div>
  );
}
