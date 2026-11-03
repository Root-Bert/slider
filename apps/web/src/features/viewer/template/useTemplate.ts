import { useQueryClient } from '@tanstack/react-query';
import {
  layoutGuidesOf,
  withLayoutGuides,
  type Deck,
  type DeckTemplate,
  type Guide,
  type UpdateDeckTemplateInput,
} from '@slider/shared';
import { queryKeys, useUpdateDeckTemplate } from '@/lib/api';
import { useEditing } from '../editing/editing-context';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';

/**
 * The template being designed in this deck (`Deck.template`), `null` for a review – with
 * `update`, which shows a change at once and sends it after (back as it was if it fails), and
 * `pageIdOf`, a slide's id in the file (what layout names are kept by).
 */
export function useTemplate(): {
  template: DeckTemplate | null;
  update: (input: UpdateDeckTemplateInput) => void;
  pageIdOf: (slideId: string) => string | null;
} {
  const { deck } = useViewerData();
  const editing = useEditing();
  const update = useUpdateTemplate();
  const template = deck.template ?? null;
  const pageIdOf = (slideId: string) =>
    editing.state?.slides.find((slide) => slide.slideId === slideId)?.pageId ?? null;
  return { template, update, pageIdOf };
}

/**
 * The guides of the layout on `slideId` of the template being designed – each layout has its own –
 * with `set`, which changes them (shown at once, sent after) and no other layout's. `null` for a
 * review.
 */
export function useLayoutGuides(
  slideId: string,
): { guides: Guide[]; set: (next: Guide[]) => void } | null {
  const { template, update, pageIdOf } = useTemplate();
  const editing = useEditing();
  if (!template) return null;
  const pageId = pageIdOf(slideId);
  return {
    guides: layoutGuidesOf(template, pageId),
    set: (next) => {
      // Not known yet which layout it is (the editor still loading): nothing to change.
      if (pageId === null) return;
      const pageIds = editing.state?.slides.map((slide) => slide.pageId) ?? [];
      update(withLayoutGuides(template, pageIds, pageId, next));
    },
  };
}

/**
 * Changes the template being designed in this deck: shown at once, sent after (back as it was if
 * it fails). Without the editing context – the editor itself uses it (a placeholder copied).
 */
export function useUpdateTemplate(): (input: UpdateDeckTemplateInput) => void {
  const { deck } = useViewerData();
  const queryClient = useQueryClient();
  const mutation = useUpdateDeckTemplate(deck.id);
  const toast = useViewerToast();
  return (input) => {
    const key = queryKeys.deck(deck.id);
    queryClient.setQueryData<Deck>(key, (current) =>
      current?.template ? { ...current, template: { ...current.template, ...input } } : current,
    );
    mutation.mutate(input, {
      onError: (error) => {
        toast(error.message, 'danger');
        void queryClient.invalidateQueries({ queryKey: key });
      },
    });
  };
}
