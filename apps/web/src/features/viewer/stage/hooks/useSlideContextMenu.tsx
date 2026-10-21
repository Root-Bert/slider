import { hitTestShapes, type Anchor, type Point, type Slide } from '@slider/shared';
import { useState, type MouseEvent, type RefObject } from 'react';
import { ContextMenu, type MenuAction } from '@/ui';
import { focusCommentField } from '../../comments/lib/composer-focus';
import { toSlidePoint } from '../../lib/geometry';
import { useViewerDispatch } from '../../state/viewer-state';
import { useViewerToast } from '../../state/viewer-toast';
import { boxAnchor } from '../lib/box-anchor';

interface Options {
  slide: Slide;
  boxRef: RefObject<HTMLDivElement | null>;
  /** Comments may be placed here (not view-only, no drawing tool, not an older version). */
  canComment: boolean;
  /** Thumbnail-sized slides keep the browser's own menu. */
  disabled: boolean;
}

/**
 * Right click on a slide: on a PowerPoint box (with or without box mode) "Kommentar zur Box"
 * and "Text kopieren"; anywhere else on the slide "Kommentar hier" and "Kommentar zur Folie".
 * Pins, cards and text boxes keep their own menus; with nothing to offer the browser's shows.
 */
export function useSlideContextMenu({ slide, boxRef, canComment, disabled }: Options) {
  const dispatch = useViewerDispatch();
  const showToast = useViewerToast();
  const [menu, setMenu] = useState<{ x: number; y: number; actions: MenuAction[] } | null>(null);

  const place = (anchor: Anchor) => {
    dispatch({ type: 'activeSlideChanged', slideId: slide.id });
    dispatch({ type: 'anchorPlaced', slideId: slide.id, anchor });
    requestAnimationFrame(() => focusCommentField());
  };
  const copy = (text: string, done: string) =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => showToast(done),
        () => showToast('Kopieren hat nicht geklappt', 'danger'),
      );

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled || !boxRef.current) return;
    if ((event.target as Element).closest('button, textarea, input, [contenteditable]')) return;
    const point: Point = toSlidePoint(event, boxRef.current);
    const shape = hitTestShapes(slide.shapes, point);
    const actions: MenuAction[] = shape
      ? [
          ...(canComment
            ? [
                {
                  label: 'Kommentar zur Box',
                  icon: 'cropSquare',
                  onSelect: () => place(boxAnchor(shape)),
                } satisfies MenuAction,
              ]
            : []),
          ...(shape.text.trim()
            ? [
                {
                  label: 'Text kopieren',
                  icon: 'contentCopy',
                  onSelect: () => void copy(shape.text, 'Text kopiert'),
                } satisfies MenuAction,
              ]
            : []),
        ]
      : [
          ...(canComment
            ? ([
                {
                  label: 'Kommentar hier',
                  icon: 'addCircle',
                  onSelect: () => place({ type: 'point', point, shapeRef: null }),
                },
                {
                  label: 'Kommentar zur Folie',
                  icon: 'chatBubble',
                  onSelect: () => place({ type: 'slide' }),
                },
              ] satisfies MenuAction[])
            : []),
        ];
    if (actions.length === 0) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, actions });
  };

  const contextMenu = menu && (
    <ContextMenu
      label={`Aktionen für ${slide.title ? `„${slide.title}“` : 'diese Folie'}`}
      actions={menu.actions}
      at={{ x: menu.x, y: menu.y }}
      onClose={() => setMenu(null)}
    />
  );
  return { onContextMenu, contextMenu };
}
