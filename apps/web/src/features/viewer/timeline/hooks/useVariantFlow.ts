import { useEffect, useEffectEvent, useState } from 'react';
import { useAiProposals, useCreateProposal } from '@/lib/api';
import { useEditing } from '../../editing/editing-context';
import { newEditId } from '../../editing/new-id';
import { useStageRegistry } from '../../state/stage-registry';
import { useViewerData } from '../../state/viewer-data';
import { useViewerDispatch } from '../../state/viewer-state';
import { useViewerToast } from '../../state/viewer-toast';
import {
  openVariantWhenThere,
  setVariantAsker,
  setVariantPrompt,
  setVariantRequest,
  setVariantSheet,
  useOpeningVariant,
  useVariantRequests,
} from '../lib/variant-requests';

/**
 * „Kopie erstellen“ – on the tile, in its field, from the right-click menu: a variant of slide
 * `slideId` at once, opened for editing once it is there (`useVariantFlow`).
 */
export function useVariantCopy(): (slideId: string) => void {
  const editing = useEditing();
  const toast = useViewerToast();
  return (slideId) => {
    const pageId = editing.state?.slides.find((item) => item.slideId === slideId)?.pageId;
    if (pageId === undefined) return;
    const newPageId = newEditId();
    openVariantWhenThere(newPageId);
    void editing.apply([{ type: 'addVariant', pageId, newPageId }]).then((ok) => {
      if (ok) toast('Variante erstellt');
      else openVariantWhenThere(null);
    });
  };
}

/**
 * The field of „Variante erstellen“ for slide `slideId` – on its tile, in the phone's sheet: what
 * is typed, and `submit` – words to the AI (the request kept until it is done; refused, the words
 * come back into the field), nothing typed a copy at once (`useVariantCopy`). `submit` returns what
 * it did: `'copy'` or `'ai'`.
 */
export function useVariantAsk(slideId: string) {
  const { deck } = useViewerData();
  const toast = useViewerToast();
  const create = useCreateProposal(deck.id);
  const copy = useVariantCopy();
  const [prompt, setPrompt] = useState('');
  const submit = (): 'copy' | 'ai' => {
    const words = prompt.trim();
    setPrompt('');
    if (!words) {
      copy(slideId);
      return 'copy';
    }
    create.mutate(
      { variantOf: slideId, prompt: words },
      {
        onSuccess: (proposal) =>
          setVariantRequest(slideId, { proposalId: proposal.id, prompt: words }),
        onError: (error) => {
          // Not lost: back in the field unless something new was typed meanwhile.
          setPrompt((current) => current || words);
          toast(error.message, 'danger');
        },
      },
    );
    return 'ai';
  };
  return { prompt, setPrompt, typed: prompt.trim().length > 0, submit, pending: create.isPending };
}

/**
 * The timeline's part in „Variante erstellen“, wherever it is asked for – always there, while
 * tiles come and go with the tracks shown:
 *
 * - the right-click menu's: the slide's tile brought into view (its track shown, the slide
 *   active) with its field open, as a click on the tile – on a phone (no variant tracks) the
 *   same field in a sheet (`VariantSheet`);
 * - a copy just made: shown on its track, the active slide, in „Bearbeiten“ – to work on by hand
 *   (a phone has no variant track: only the toast);
 * - the AI done with a variant: a toast, and its note open on the variant (`VariantBadge`) – or
 *   the toast says why not.
 */
export function useVariantFlow(go: (track: number) => void, tracks: boolean): void {
  const { deck, variantsOf } = useViewerData();
  const editing = useEditing();
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const toast = useViewerToast();

  const ask = useEffectEvent((slideId: string) => {
    dispatch({ type: 'activeSlideChanged', slideId });
    registry.revealSlide(slideId);
    go(-((variantsOf.get(slideId)?.length ?? 0) + 1));
    setVariantPrompt(slideId);
  });
  useEffect(
    () => setVariantAsker((slideId) => (tracks ? ask(slideId) : setVariantSheet(slideId))),
    [tracks],
  );

  const opening = useOpeningVariant();
  const open = useEffectEvent((pageId: string) => {
    // A phone has no variant track to show it on: the toast says it is there.
    if (!tracks) {
      openVariantWhenThere(null);
      return;
    }
    const slideId = editing.state?.slides.find((item) => item.pageId === pageId)?.slideId;
    if (!slideId) return;
    for (const variants of variantsOf.values()) {
      const at = variants.findIndex((variant) => variant.id === slideId);
      if (at < 0) continue;
      openVariantWhenThere(null);
      go(-(at + 1));
      dispatch({ type: 'activeSlideChanged', slideId });
      if (!editing.active) editing.setActive(true);
      return;
    }
  });
  useEffect(() => {
    if (opening) open(opening);
  }, [opening, editing.state, variantsOf]);

  const requests = useVariantRequests();
  const { data: proposals } = useAiProposals(deck.id, requests.size > 0);
  const settle = useEffectEvent(() => {
    for (const [slideId, request] of requests) {
      const status = proposals?.find((item) => item.id === request.proposalId);
      if (!status || status.status === 'running') continue;
      setVariantRequest(slideId, null);
      if (status.status === 'applied') {
        toast('Variante erstellt');
      } else if (status.status === 'failed') {
        toast(status.error ?? 'Die Variante ließ sich nicht erstellen.', 'danger');
      }
    }
  });
  useEffect(() => settle(), [requests, proposals]);
}
