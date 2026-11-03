import type { OdpSlide } from '@slider/odp';
import { withChildren, type LiveParagraph, type SlideOperation, type Viewer } from '@slider/shared';
import { typedParagraphs } from '@slider/shared/live-text';
import type { AppDeps } from '../../deps';
import { badRequest } from '../../http/errors';
import { isOdpKey } from '../../import/odp-deck';
import { fileSlides } from './file-slides';
import { editTarget } from './target';

/*
 * The deck's file and the texts typed in together (`LiveTexts`): typing starts from the file's
 * text, and a step that changes a text being typed in writes its text there.
 */

/**
 * The deck got a new current file another way than an edit (synced from its source): texts being
 * typed in get what changed in theirs (`syncLiveTexts`), as after a step – else the editors there
 * would write the old text, and their typing, back over the new file. Best effort: a failure is
 * logged, the revision stands.
 */
export async function newRevisionToLiveTexts(
  deps: Pick<AppDeps, 'storage' | 'liveTexts' | 'log'>,
  deckId: string,
  previousKey: string | null,
  nextKey: string | null,
): Promise<void> {
  if (!deps.liveTexts?.elementsOf(deckId).length) return;
  if (!previousKey || !nextKey || !isOdpKey(previousKey) || !isOdpKey(nextKey)) return;
  try {
    const [before, after] = await Promise.all([
      fileSlides(deps, previousKey),
      fileSlides(deps, nextKey),
    ]);
    syncLiveTexts(deps, deckId, [], before.slides, after.slides);
  } catch (error) {
    deps.log.warn(`Deck ${deckId}: texts typed in together not brought to the new revision`, error);
  }
}

/**
 * The text of a live element as the deck's file has it now – typing in it together starts from
 * this (an empty placeholder as one empty paragraph, as the editor starts it).
 */
export async function liveParagraphsOf(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  elementId: string,
): Promise<LiveParagraph[]> {
  const { revision } = await editTarget(deps, viewer, deckId);
  const { slides } = await fileSlides(deps, revision.pptxKey);
  const paragraphs = liveParagraphsIn(slides, elementId);
  if (!paragraphs) throw badRequest('In diesem Element lässt sich kein Text tippen.');
  return paragraphs;
}

/** {@link liveParagraphsOf} in a file's slides; `null` when the element has no live text there. */
function liveParagraphsIn(slides: readonly OdpSlide[], elementId: string): LiveParagraph[] | null {
  // One in a group too (typed in once the group is entered).
  const live = withChildren(slides.flatMap((slide) => slide.elements)).find(
    (item) => item.id === elementId,
  )?.live;
  return live ? typedParagraphs(live) : null;
}

/**
 * Texts being typed in together whose text a step changed get the file's text written into
 * their shared text (`LiveTexts.fileChanged`) – else the editors there would keep showing theirs
 * and save it back over the undo, the format panel's or the AI's change. Not for a text the step
 * wrote with a `typed` `setRichText`: that is the live editor saving the typing – the shared text
 * may be ahead of it by what was typed since the save went out, which must not be taken back.
 * Not for a text the step left alone either, for the same reason. `operations`: the step's own,
 * none for one gone back to (undo, redo of the AI).
 */
export function syncLiveTexts(
  deps: Pick<AppDeps, 'liveTexts'>,
  deckId: string,
  operations: readonly SlideOperation[],
  before: readonly OdpSlide[],
  after: readonly OdpSlide[],
): void {
  const texts = deps.liveTexts;
  const typing = texts?.elementsOf(deckId) ?? [];
  if (!texts || typing.length === 0) return;
  const saved = new Set(
    operations.flatMap((operation) =>
      operation.type === 'setRichText' && operation.typed ? [operation.elementId] : [],
    ),
  );
  for (const elementId of typing) {
    if (saved.has(elementId)) continue;
    const now = liveParagraphsIn(after, elementId);
    // The element went (or holds no text to type any more): its editors find out from the slides.
    if (!now) continue;
    const was = liveParagraphsIn(before, elementId);
    if (was && JSON.stringify(was) === JSON.stringify(now)) continue;
    texts.fileChanged(deckId, elementId, was, now);
  }
}
