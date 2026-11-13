import { withChildren, type Anchor, type Point, type Shape, type Slide } from '@slider/shared';
import { useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { ContextMenu, type MenuAction } from '@/ui';
import { focusCommentField } from '../../comments/lib/composer-focus';
import { useEditing } from '../../editing/editing-context';
import { useSlideActions } from '../../editing/hooks/useSlideActions';
import { richFromLive } from '../../editing/live/model';
import { toSlidePoint } from '../../lib/geometry';
import { useViewerDispatch } from '../../state/viewer-state';
import { useViewerToast } from '../../state/viewer-toast';
import { acceptWord } from '../../spelling/accepted-words';
import { fixWord } from '../../spelling/fix-word';
import { suggestionsFor } from '../../spelling/spell-checker';
import {
  MISSPELT_AT_ATTR,
  MISSPELT_ELEMENT_ATTR,
  MISSPELT_WORD_ATTR,
} from '../../spelling/underlinable';
import { useKnowsWord } from '../../spelling/useMisspellings';
import { misspelledWords } from '../../spelling/words';
import { boxAnchor } from '../lib/box-anchor';
import { shapeOfBox, slideBoxAt, useSlideBoxes } from './useSlideBoxes';

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
 * and "Text kopieren"; anywhere else on the slide "Kommentar hier" and "Kommentar zur Folie" –
 * and on editable decks, in „Bearbeiten“ as in review, "Hintergrund", "Folie ausblenden" and
 * "Folie löschen". With the guides shown, on a misspelt word underlined (`MisspeltWords`) only what
 * may have been meant – a pick puts it in its place – and the word itself, kept; on a box with misspelt words
 * named under it (`GuideLayer`), „„…“ passt so“ for each first.
 * Pins, cards and text boxes keep their own menus; with nothing to offer the browser's shows.
 */
export function useSlideContextMenu({ slide, boxRef, canComment, disabled }: Options) {
  const dispatch = useViewerDispatch();
  const showToast = useViewerToast();
  const slideActions = useSlideActions();
  // The boxes hovering marks, in review and while editing alike.
  const boxes = useSlideBoxes(slide);
  const knows = useKnowsWord(false);
  const editing = useEditing();
  // A suggestion picked reads the text as it is then, not as it was at the right click.
  const latest = useRef({ editing, knows });
  useLayoutEffect(() => {
    latest.current = { editing, knows };
  });
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
    if (disabled || !boxRef.current || event.defaultPrevented) return;
    const target = event.target as Element;
    if (target.closest('textarea, input, [contenteditable]')) return;
    // A misspelt word underlined (over an element of Bearbeiten, a button, too): its menu alone.
    const onWord = misspeltWordAt(boxRef.current, event);
    if (onWord) {
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY, actions: spellingActions(onWord) });
      return;
    }
    if (target.closest('button')) return;
    const point: Point = toSlidePoint(event, boxRef.current);
    const box = slideBoxAt(slide, boxes, point);
    const shape = box && shapeOfBox(slide, box);
    const actions: MenuAction[] = misspeltWordsOf(boxRef.current, shape).map((word) => ({
      label: `„${word}“ passt so`,
      icon: 'check',
      onSelect: () => acceptWord(word),
    }));
    actions.push(
      ...(shape
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
          ]),
    );
    actions.push(...slideActions(slide));
    if (actions.length === 0) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, actions });
  };

  /** The misspelt word underlined where a right click is (`MisspeltWords`), with the guides shown. */
  function misspeltWordAt(frame: HTMLElement, { clientX: x, clientY: y }: MouseEvent) {
    if (!frame.querySelector('[data-guide-layer]')) return null;
    for (const mark of frame.querySelectorAll<HTMLElement>(`[${MISSPELT_WORD_ATTR}]`)) {
      const rect = mark.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return mark;
    }
    return null;
  }

  /** On a misspelt word: what may have been meant, each put in its place by a pick, and the word kept. */
  function spellingActions(mark: HTMLElement): MenuAction[] {
    const word = mark.getAttribute(MISSPELT_WORD_ATTR)!;
    const elementId = mark.getAttribute(MISSPELT_ELEMENT_ATTR)!;
    const occurrence = Number(mark.getAttribute(MISSPELT_AT_ATTR));
    const element = withChildren(editing.elementsOf(slide.id)).find(({ id }) => id === elementId);
    const live = element?.live;
    const fixes = live && knows ? suggestionsFor(word) : [];
    return [
      ...fixes.map((fix): MenuAction => ({
        label: fix,
        icon: 'autoFixHigh',
        onSelect: () => {
          const now = latest.current;
          const text = withChildren(now.editing.elementsOf(slide.id)).find(
            ({ id }) => id === elementId,
          )?.live;
          const paragraphs =
            text && now.knows && fixWord(text.paragraphs, word, occurrence, fix, now.knows);
          if (!paragraphs) {
            showToast('Der Text hat sich inzwischen geändert', 'danger');
            return;
          }
          void now.editing.apply([
            { type: 'setRichText', elementId, paragraphs: richFromLive(paragraphs) },
          ]);
        },
      })),
      // The word as it is, last: kept, and no longer marked.
      { label: `„${word}“`, icon: 'check', onSelect: () => acceptWord(word) },
    ];
  }

  /**
   * The misspelt words named under a box (`GuideLayer`, its words not underlined in place) – read
   * at the right click, not on every render of every slide (thumbnails too).
   */
  function misspeltWordsOf(frame: HTMLElement, shape: Shape | null | undefined): string[] {
    if (!shape?.text || !knows) return [];
    if (!frame.querySelector(`[data-misspelt="${CSS.escape(shape.id)}"]`)) return [];
    return misspelledWords(shape.text, knows);
  }

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
