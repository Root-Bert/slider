import type { Slide } from '@slider/shared';
import type { MenuAction } from '@/ui';
import { useViewerData } from '../../state/viewer-data';
import { useViewerDispatch } from '../../state/viewer-state';
import { useViewerToast } from '../../state/viewer-toast';
import { useVariantCopy } from '../../timeline/hooks/useVariantFlow';
import { askVariant } from '../../timeline/lib/variant-requests';
import { useEditing } from '../editing-context';
import { newEditId } from '../new-id';
import { useAskAi } from './useAskAi';

/**
 * „Variante erstellen“, „Folie duplizieren“, „Hintergrund“, „Folie ausblenden/einblenden“ and „Folie löschen“ for a
 * slide's right-click menu – „Variante verwenden“ and „Variante löschen“ for a variant's
 * – on its thumbnail and on the slide itself, in „Bearbeiten“ as in review. Nothing on decks this
 * viewer cannot edit. „Hintergrund“ opens the slide's background in the side panel
 * (`SlideBackgroundPanel`). In a template, „Layout umbenennen“ first – the only way to rename a
 * layout once it has a name (`TemplateControls`). „Variante erstellen“ does what a click on the
 * slide's „Variante erstellen“ tile does: with the AI, the tile shown with its field open (words →
 * the AI makes it; empty → a copy, opened for editing) – on a phone, without variant tracks, the
 * same field in a sheet (`VariantSheet`); without the AI the copy at once.
 */
export function useSlideActions(): (slide: Slide) => MenuAction[] {
  const editing = useEditing();
  const dispatch = useViewerDispatch();
  const toast = useViewerToast();
  const { slides, deck } = useViewerData();
  const ai = useAskAi();
  const copyVariant = useVariantCopy();

  return (slide) => {
    const pageId = editing.state?.slides.find((item) => item.slideId === slide.id)?.pageId;
    if (!editing.available || pageId === undefined) return [];
    const busy = editing.busy ? 'Die letzte Änderung läuft noch.' : null;
    // A variant (above its slide): taken into the deck in its slide's place, or deleted.
    if (slide.variantOf)
      return [
        {
          label: 'Variante verwenden',
          icon: 'compareArrows',
          disabled: !!busy,
          title: busy ?? undefined,
          onSelect: () =>
            void editing
              .apply([{ type: 'useVariant', pageId }])
              .then((ok) => ok && toast('Variante verwendet')),
        },
        {
          label: 'Variante löschen',
          icon: 'delete',
          tone: 'danger',
          disabled: !!busy,
          title: busy ?? undefined,
          onSelect: () =>
            void editing
              .apply([{ type: 'deleteSlide', pageId }])
              .then((ok) => ok && toast('Variante gelöscht')),
        },
      ];
    return [
      ...(deck.template
        ? [
            {
              label: 'Layout umbenennen',
              icon: 'edit',
              onSelect: () => dispatch({ type: 'layoutRenameSet', pageId }),
            } satisfies MenuAction,
          ]
        : []),
      // A template's slides are its layouts: no variants of them.
      ...(deck.template
        ? []
        : [
            {
              label: 'Variante erstellen',
              icon: 'difference',
              disabled: !!busy,
              title: busy ?? undefined,
              onSelect: () => {
                if (!ai.available || !askVariant(slide.id)) copyVariant(slide.id);
              },
            } satisfies MenuAction,
          ]),
      // Right after it, shown at once (`pending-slides`), one undo takes it back.
      {
        label: 'Folie duplizieren',
        icon: 'contentCopy',
        disabled: !!busy,
        title: busy ?? undefined,
        onSelect: () =>
          void editing
            .apply([{ type: 'duplicateSlide', pageId, newPageId: newEditId(), after: pageId }])
            .then((ok) => ok && toast('Folie dupliziert')),
      },
      {
        label: 'Hintergrund',
        icon: 'formatColorFill',
        onSelect: () => dispatch({ type: 'backgroundPanelSet', pageId }),
      },
      {
        label: slide.hidden ? 'Folie einblenden' : 'Folie ausblenden',
        icon: slide.hidden ? 'visibility' : 'visibilityOff',
        disabled: !!busy,
        title: busy ?? undefined,
        onSelect: () =>
          void editing.apply([{ type: 'setSlideHidden', pageId, hidden: !slide.hidden }]),
      },
      {
        label: 'Folie löschen',
        icon: 'delete',
        tone: 'danger',
        disabled: !!busy || slides.length <= 1,
        title: busy ?? (slides.length <= 1 ? 'Die letzte Folie bleibt.' : undefined),
        onSelect: () =>
          void editing
            .apply([{ type: 'deleteSlide', pageId }])
            .then((ok) => ok && toast('Folie gelöscht')),
      },
    ];
  };
}
