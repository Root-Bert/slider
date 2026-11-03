import type { EditableElement } from '@slider/shared';
import { IconButton, type IconName } from '@/ui';
import { useSnapLines } from '../template/useSnapLines';
import { useEditing } from './editing-context';
import { useMoveElements, useSetBoxes, useShownBox } from './hooks/useMoveElements';
import {
  alignMoves,
  distributeMoves,
  growBoxes,
  SLIDE_RECT,
  type GroupAlign,
  type GroupMember,
  type GroupMoves,
} from './lib/group-layout';
import { Line } from './StyleControls';
import { canSize } from './live/model';

const ACROSS: { how: GroupAlign; icon: IconName; label: string }[] = [
  { how: 'left', icon: 'alignLeft', label: 'Links ausrichten' },
  { how: 'center', icon: 'alignCenter', label: 'Horizontal zentrieren' },
  { how: 'right', icon: 'alignRight', label: 'Rechts ausrichten' },
];
const DOWN: { how: GroupAlign; icon: IconName; label: string }[] = [
  { how: 'top', icon: 'alignTop', label: 'Oben ausrichten' },
  { how: 'middle', icon: 'alignMiddle', label: 'Vertikal zentrieren' },
  { how: 'bottom', icon: 'alignBottom', label: 'Unten ausrichten' },
];

/**
 * The format panel's „Anordnen“: one element lined up on the slide, several picked together on
 * the box round them – and, three or more, spread evenly across or down. Grown to the next lines
 * either way (the lines a box is caught at, `useSnapLines`): one its own box, several the box
 * round them.
 */
export function ArrangeControls({
  slideId,
  elements,
}: {
  slideId: string;
  elements: readonly EditableElement[];
}) {
  const editing = useEditing();
  const shownBox = useShownBox();
  const moveElements = useMoveElements();
  const setBoxes = useSetBoxes();
  const snapLines = useSnapLines(slideId);
  const aspect = editing.pageSize.width / editing.pageSize.height;
  const members: GroupMember[] = elements.map((element) => ({
    id: element.id,
    bbox: shownBox(element),
    rotation: element.rotation,
    tilt: element.tilt,
  }));
  const alone = elements.length === 1;
  const move = (moves: GroupMoves) => void moveElements(elements, moves);
  // Only what can be sized (not locked, not a group of the file); turned or tilted, it is not
  // caught at lines either (`growBoxes`).
  const sizable = elements.every(canSize);
  const grown = (axis: 'x' | 'y') => {
    const boxes = sizable ? growBoxes(members, axis, snapLines) : null;
    if (!boxes) return null;
    // Only that way: the other stays as in the file (a text growing with its text keeps its own
    // height across).
    return new Map(
      elements.flatMap((element) => {
        const box = boxes.get(element.id);
        if (!box) return [];
        const { bbox } = element;
        const next =
          axis === 'x' ? { ...bbox, x: box.x, w: box.w } : { ...bbox, y: box.y, h: box.h };
        return [[element.id, next] as const];
      }),
    );
  };
  const wider = grown('x');
  const higher = grown('y');
  const button = (item: { how: GroupAlign; icon: IconName; label: string }) => (
    <IconButton
      key={item.how}
      icon={item.icon}
      label={alone ? `${item.label} (an der Folie)` : item.label}
      size="compact"
      disabled={editing.busy}
      onClick={() => move(alignMoves(members, item.how, aspect, alone ? SLIDE_RECT : undefined))}
    />
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Line label={alone ? 'An der Folie ausrichten' : 'Ausrichten'}>
        {ACROSS.map(button)}
        <span aria-hidden className="mx-1 h-5 w-px bg-hairline" />
        {DOWN.map(button)}
      </Line>
      {elements.length > 2 && (
        <Line label="Verteilen">
          <IconButton
            icon="distributeHorizontal"
            label="Horizontal verteilen"
            size="compact"
            disabled={editing.busy}
            onClick={() => move(distributeMoves(members, 'x', aspect))}
          />
          <IconButton
            icon="distributeVertical"
            label="Vertikal verteilen"
            size="compact"
            disabled={editing.busy}
            onClick={() => move(distributeMoves(members, 'y', aspect))}
          />
        </Line>
      )}
      <Line label="Bis zur nächsten Linie">
        <IconButton
          icon="growWidth"
          label="Breite bis zur nächsten Linie"
          size="compact"
          disabled={editing.busy || !wider}
          onClick={() => wider && void setBoxes(elements, wider)}
        />
        <IconButton
          icon="growHeight"
          label="Höhe bis zur nächsten Linie"
          size="compact"
          disabled={editing.busy || !higher}
          onClick={() => higher && void setBoxes(elements, higher)}
        />
      </Line>
    </div>
  );
}
