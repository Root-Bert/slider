import { boardSchema, MATERIAL_CARD, type Board, type Material } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api } from '../api-client';
import { sendInParts } from '../upload-in-parts';
import { boardKeys, boardPath, deckBoard, type BoardRef } from './board-owner';
import { queryKeys } from './keys';

/*
 * A presentation's (or text document's) material: the files – and notes, links the AI apps put
 * there – the AI builds and answers from (`services/materials.ts`). Files come in at the prompt on
 * Folie 1; „Material“ lists all of it (`features/material`), the AI's chat names files as sources.
 */

/** The material of a presentation or a text document as the server has it. */
export const useMaterial = (owner: BoardRef, enabled = true) =>
  useQuery({
    queryKey: boardKeys.board(owner),
    queryFn: async () => boardSchema.parse(await api.get(boardPath(owner, '/board'))),
    networkMode: 'always',
    enabled,
  });

/** The deck's material as the server has it. */
export const useDeckMaterial = (deckId: string) => useMaterial(deckBoard(deckId));

/**
 * One thing of the material deleted – a file, a note, a link: gone from the list at once, back if
 * the server refuses, and said so (`onRefused` – here, not at `mutate`: it is said also when the
 * panel closed meanwhile or another delete followed). Read anew after: the notes that hung on it
 * alone go with it (`deleteBoardItem`).
 */
export function useDeleteMaterial(owner: BoardRef, onRefused: (message: string) => void) {
  const queryClient = useQueryClient();
  const key = boardKeys.board(owner);
  return useMutation({
    mutationFn: ({ id }: { id: string; title: string }) =>
      api.delete(boardPath(owner, `/board/${encodeURIComponent(id)}`)),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<Board>(key);
      queryClient.setQueryData<Board>(key, (current) =>
        current
          ? {
              materials: current.materials.filter((each) => each.id !== id),
              items: current.items.filter((each) => each.id !== id),
            }
          : current,
      );
      return {
        material: before?.materials.find((each) => each.id === id),
        item: before?.items.find((each) => each.id === id),
      };
    },
    onError: (error, { title }, context) => {
      // Only this one back, into the list as it is now: another delete meanwhile stays done.
      queryClient.setQueryData<Board>(key, (current) =>
        current
          ? {
              materials:
                context?.material &&
                !current.materials.some((each) => each.id === context.material!.id)
                  ? [...current.materials, context.material]
                  : current.materials,
              items:
                context?.item && !current.items.some((each) => each.id === context.item!.id)
                  ? [...current.items, context.item]
                  : current.items,
            }
          : current,
      );
      onRefused(
        error instanceof Error && error.message
          ? error.message
          : `„${title}“ konnte nicht gelöscht werden`,
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
}

/** A file sent up into the deck's material; known to `useDeckMaterial` once it is there. */
export function useAttachMaterial(deckId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (file: File): Promise<Material> => {
      const owner = deckBoard(deckId);
      const upload = await sendInParts(
        file,
        { purpose: 'material', deckId },
        () => undefined,
        new AbortController().signal,
      );
      // Where it lay on the old board: the server still keeps a frame per file.
      const saved = await api.post<Material>(boardPath(owner, '/materials'), {
        id: crypto.randomUUID(),
        upload,
        x: 0,
        y: 0,
        ...MATERIAL_CARD,
      });
      queryClient.setQueryData<Board>(queryKeys.board(deckId), (current) =>
        current && !current.materials.some((each) => each.id === saved.id)
          ? { ...current, materials: [...current.materials, saved] }
          : current,
      );
      return saved;
    },
    [deckId, queryClient],
  );
}
