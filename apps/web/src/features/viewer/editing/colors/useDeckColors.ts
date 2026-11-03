import { useQueryClient } from '@tanstack/react-query';
import { PALETTE_MAX_COLORS, type Deck, type TemplateColor } from '@slider/shared';
import { queryKeys, useUpdateDeck } from '@/lib/api';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';

/**
 * A few general colours, light to dark and then a round of hues: what the pickers offer in a deck
 * whose template sets none (or that has no template).
 */
export const GENERAL_COLORS: readonly TemplateColor[] = [
  '#ffffff',
  '#e2e8f0',
  '#94a3b8',
  '#475569',
  '#1e293b',
  '#000000',
  '#dc2626',
  '#ea580c',
  '#facc15',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#4f46e5',
  '#9333ea',
  '#db2777',
].map((color) => ({ color, name: '' }));

export const sameColor = (a: string | null | undefined, b: string) =>
  a?.toLowerCase() === b.toLowerCase();

/**
 * What this deck's colour pickers offer: its template's colours – `fromTemplate` false when it
 * has none, then the general ones – and its own („Eigene“), which `addCustom` and `removeCustom`
 * change for everyone in the deck (shown at once, back as they were if saving fails).
 */
export function useDeckColors(): {
  colors: readonly TemplateColor[];
  fromTemplate: boolean;
  custom: readonly string[];
  addCustom: (color: string) => void;
  removeCustom: (color: string) => void;
} {
  const { deck } = useViewerData();
  const queryClient = useQueryClient();
  // One after the other, and only its own answer merged: a later change is not undone.
  const mutation = useUpdateDeck(deck.id, `colors:${deck.id}`);
  const toast = useViewerToast();
  const template = deck.colors?.template ?? null;
  const custom = deck.colors?.custom ?? [];

  const save = (next: string[]) => {
    const key = queryKeys.deck(deck.id);
    queryClient.setQueryData<Deck>(key, (current) =>
      current ? { ...current, colors: { template, ...current.colors, custom: next } } : current,
    );
    mutation.mutate(
      { customColors: next },
      {
        onError: (error) => {
          toast(error.message, 'danger');
          void queryClient.invalidateQueries({ queryKey: key });
        },
      },
    );
  };

  return {
    colors: template ?? GENERAL_COLORS,
    fromTemplate: template !== null,
    custom,
    // The newest first; one kept already moves to the front. The oldest give way at the limit.
    addCustom: (color) =>
      save(
        [color.toLowerCase(), ...custom.filter((kept) => !sameColor(kept, color))].slice(
          0,
          PALETTE_MAX_COLORS,
        ),
      ),
    removeCustom: (color) => save(custom.filter((kept) => !sameColor(kept, color))),
  };
}
