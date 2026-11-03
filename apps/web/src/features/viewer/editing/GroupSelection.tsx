import type { EditableElement, Point, Rect, SlideOperation } from '@slider/shared';
import { useRef, useState, type MouseEvent } from 'react';
import { EditableFrame } from '../stage/EditableFrame';
import type { SnapLines } from '../stage/lib/rect-edit';
import { ShapeOutline } from '../stage/ShapeOutline';
import { useMoveElements } from './hooks/useMoveElements';
import { useEditing } from './editing-context';
import { canSize } from './live/model';
import {
  scaledFrames,
  shownRect,
  turnedFrames,
  unionRect,
  type GroupFrame,
  type GroupMember,
  type GroupMemberFrame,
} from './lib/group-layout';

/**
 * Elements of a slide picked together (`Editing.group`): each outlined as a picked one is, one
 * frame round all of them with the handles one element has – dragged, they all move; by a corner,
 * they are scaled with it; by the turning handle, turned round its centre (as Figma) – drawn where
 * they go (`SlideCompositor`), one step on release. A click in it picks the element there alone (a
 * text: typed in), ⇧-click takes it out. What can be done with them is the format panel's, as for
 * one (`FormatBar`).
 */
export function GroupSelection({
  slideId,
  color,
  boxOf,
  elementAt,
  onAlone,
  onToggle,
  snapLines,
}: {
  slideId: string;
  color: string;
  /** Where an element shows (a text growing with its text as high as it is drawn). */
  boxOf: (element: EditableElement) => Rect;
  /** The element under a point of the slide, as a click there would pick it. */
  elementAt: (point: Point) => EditableElement | null;
  /** A click on one of them: that one alone, as a click on it picks it. */
  onAlone: (element: EditableElement, event: MouseEvent) => void;
  /** ⇧-click: in the group or out of it. */
  onToggle: (element: EditableElement) => void;
  snapLines?: SnapLines | null;
}) {
  const editing = useEditing();
  const moveElements = useMoveElements();
  // Being dragged: where each shows (of the slide) – moved, scaled or turned.
  const [shownFrames, setShownFrames] = useState<ReadonlyMap<string, GroupFrame> | null>(null);
  const previewSurface = useRef({}).current;
  const group = editing.group;
  if (!group || group.slideId !== slideId) return null;
  const ids = new Set(group.elementIds);
  const members = editing.elementsOf(slideId).filter((element) => ids.has(element.id));
  if (members.length < 2) return null;
  const aspect = editing.pageSize.width / editing.pageSize.height;
  const shown: GroupMember[] = members.map((element) => ({
    id: element.id,
    bbox: boxOf(element),
    rotation: element.rotation,
    tilt: element.tilt,
  }));
  const all = unionRect(shown.map((member) => shownRect(member, aspect)))!;
  // Dragged, the slide draws them where they go (`SlideCompositor`), as one element dragged: this one
  // leads, the others follow it (`ElementPreview.group`).
  // Locked ones (picked together in the list of layers) stay where they are.
  const movers = members.filter((element) => !element.locked);
  const lead = movers.find((element) => element.movable) ?? movers[0];
  // What a corner or the turning handle changes of each: groups of the file only move.
  const frameMembers: GroupMemberFrame[] = movers.map((element) => ({
    id: element.id,
    bbox: boxOf(element),
    rotation: element.rotation,
    tilt: element.tilt,
    sizes: canSize(element),
    turns: canSize(element),
  }));
  /** Where each goes for the frame at `rect` turned by `rotation` – only moved: `null`. */
  const framesFor = (rect: Rect, rotation: number): Map<string, GroupFrame> | null => {
    if (rotation !== 0) return turnedFrames(frameMembers, all, rotation, aspect);
    // A move comes back rounded (`useRectEdit`): within that, the size is the same.
    const resized = Math.abs(rect.w - all.w) > 5e-4 || Math.abs(rect.h - all.h) > 5e-4;
    return resized ? scaledFrames(frameMembers, all, rect) : null;
  };
  const drag = (next: { rect: Rect; rotation: number } | null) => {
    if (!lead) return;
    const frames = next && framesFor(next.rect, next.rotation);
    const dx = next && !frames ? next.rect.x - all.x : 0;
    const dy = next && !frames ? next.rect.y - all.y : 0;
    setShownFrames(
      !next
        ? null
        : (frames ??
            new Map(
              frameMembers.map((member) => [
                member.id,
                {
                  rect: { ...member.bbox, x: member.bbox.x + dx, y: member.bbox.y + dy },
                  rotation: member.rotation ?? 0,
                },
              ]),
            )),
    );
    const leadFrame = frames?.get(lead.id);
    editing.setPreview(
      next && {
        elementId: lead.id,
        rect: leadFrame?.rect ?? { ...lead.bbox, x: lead.bbox.x + dx, y: lead.bbox.y + dy },
        rotation: leadFrame?.rotation ?? lead.rotation,
        group: {
          elementIds: movers.map((element) => element.id),
          dx,
          dy,
          ...(frames && { frames }),
        },
      },
      lead.id,
      previewSurface,
    );
  };
  /** Each one's new box (and turn, turned) – one step; `done` once it is stored. */
  const commitFrames = (
    frames: ReadonlyMap<string, GroupFrame>,
    turned: boolean,
    done: () => void,
  ) => {
    const operations: SlideOperation[] = [];
    for (const element of movers) {
      const frame = frames.get(element.id);
      if (!frame) continue;
      const sizes = canSize(element);
      // Groups of the file keep their size.
      const box = sizes ? frame.rect : { ...frame.rect, w: element.bbox.w, h: element.bbox.h };
      operations.push({
        type: 'setBox',
        elementId: element.id,
        box,
        ...(turned && sizes && { rotation: frame.rotation }),
      });
    }
    const applied = operations.length > 0 ? editing.apply(operations) : Promise.resolve(true);
    void applied.finally(() => {
      drag(null);
      done();
    });
  };
  const pointOf = (event: MouseEvent): Point | null => {
    const layer = (event.currentTarget as HTMLElement).closest('[data-edit-layer]');
    const box = layer?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
  };

  return (
    <>
      {members.map((element) => {
        const frame = shownFrames?.get(element.id);
        return (
          <ShapeOutline
            key={element.id}
            shape={{
              bbox: frame?.rect ?? boxOf(element),
              rotation: frame?.rotation ?? element.rotation,
              tilt: element.tilt,
            }}
            variant="target"
            color={color}
          />
        );
      })}
      <EditableFrame
        rect={all}
        color={color}
        handles
        elementEdge
        emphasized
        offSlide
        snapLines={snapLines}
        onPreview={(next, rotation) => drag(next && { rect: next, rotation: rotation ?? 0 })}
        onCommit={(next, done) => {
          const frames = framesFor(next, 0);
          if (frames) {
            commitFrames(frames, false, done);
            return;
          }
          const dx = next.x - all.x;
          const dy = next.y - all.y;
          const moves = new Map(movers.map((element) => [element.id, { dx, dy }]));
          void moveElements(movers, moves).finally(() => {
            drag(null);
            done();
          });
        }}
        onRotate={(rotation, done) =>
          commitFrames(turnedFrames(frameMembers, all, rotation, aspect), true, done)
        }
        onActivate={(event) => {
          const point = pointOf(event);
          const element = point && elementAt(point);
          if (!element) {
            editing.select(null);
            return;
          }
          if (event.shiftKey) onToggle(element);
          else onAlone(element, event);
        }}
      />
    </>
  );
}
