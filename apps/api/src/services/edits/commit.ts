import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { OdpDocument, OdpSlide } from '@slider/odp';
import {
  withAddedLayouts,
  type DeckEditSource,
  type Guide,
  type SlideOperation,
} from '@slider/shared';
import type { Executor } from '../../db/client';
import { deckEdits, decks, revisions, slideVersions, slides } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { ApiError } from '../../http/errors';
import { toShape } from '../../import/common';
import { odpParsedSlide, odpPreviewSvg } from '../../import/odp-deck';
import { storeSlideRender } from '../../import/office-pages';
import { blobKeys } from '../../storage/blob-storage';
import { scheduleTemplateSave } from '../workspace-masters';
import {
  dropUnusedImages,
  drawSlides,
  sharpenLater,
  type DrawnSlide,
  type QuickDrawing,
} from './drawing';
import { describeFile, knownFileSlides } from './file-slides';
import { syncLiveTexts } from './live-texts';
import { openFile, type EditTarget } from './target';

/*
 * Committing a step: the file becomes the revision's, the slides that differ from the file before
 * are drawn, and the revision's slide versions follow – each slide staying the slide it was
 * (comments and all), wherever it moved; one that went keeps its slide row, so it comes back as
 * itself on undo.
 */

/** A step to commit: a new one made of operations, or one of the history gone back to. */
export type Step =
  | {
      kind: 'new';
      /** Its row's id (`deck_edits.id`), picked ahead so whoever made the step knows it. */
      id: string;
      operations: readonly SlideOperation[];
      /** What it left out (`FileChange.dropped`), kept for the same edit sent again. */
      dropped: number;
      source: Exclude<DeckEditSource, 'original'>;
      authorId: string | null;
      /** The editor's own id for the edit (`deck_edits.client_edit_id`). */
      clientEditId?: string;
    }
  | { kind: 'move'; seq: number; fileKey: string };

/** How the slides of the current file and of the next one are the same slides. */
export interface SlidePairing {
  /** For each slide of the next file, by position, the current file's position of it; `null`: new. */
  source: (number | null)[];
  /** Positions in the current file of the slides the next one no longer has. */
  removed: number[];
  /** Positions in the next file of the slides to draw: new, or changed in what they show. */
  changed: Set<number>;
}

/**
 * Pairs the slides of two files of a deck: by page id (`byPage`) – it stays with a slide that
 * moves, comes or goes –, else by position, for files from before page ids, whose steps never
 * moved slides. A slide is changed when what LibreOffice draws of it (its fingerprint) or
 * whether it is hidden differs.
 */
export function pairSlides(
  before: readonly OdpSlide[],
  after: readonly OdpSlide[],
  byPage: boolean,
): SlidePairing {
  const beforeOf = new Map(before.map((slide) => [slide.pageId, slide.index]));
  const source = after.map((slide) =>
    byPage
      ? (beforeOf.get(slide.pageId) ?? null)
      : slide.index < before.length
        ? slide.index
        : null,
  );
  const kept = new Set(source.filter((index): index is number => index !== null));
  const removed = before.filter((slide) => !kept.has(slide.index)).map((slide) => slide.index);
  const changed = new Set<number>();
  after.forEach((slide, index) => {
    const from = source[index];
    const old = from === null || from === undefined ? undefined : before[from];
    if (!old || old.fingerprint !== slide.fingerprint || old.hidden !== slide.hidden) {
      changed.add(slide.index);
    }
  });
  return { source, removed, changed };
}

/**
 * Makes `bytes` the revision's file: stores it (a new step) or points at a step's file (undo,
 * redo of the AI), draws the slides that differ from the current file and updates their
 * versions. `applied`: `bytes` open already (the step just applied to it) – not read again,
 * then drawn from.
 */
export async function commitStep(
  deps: AppDeps,
  target: EditTarget,
  current: Uint8Array,
  bytes: Uint8Array,
  step: Step,
  applied?: OdpDocument,
): Promise<void> {
  const { deck, revision } = target;
  const fileKey = step.kind === 'new' ? blobKeys.pptx(deck.id, revision.id, 'odp') : step.fileKey;
  const currentKey = revision.pptxKey;
  // Both files as described before – the current one mostly is (the edit state read it) –,
  // else read now; the new one is open already when the step was just applied to it.
  const previous =
    knownFileSlides(currentKey) ?? (await describeFile(await openFile(current), currentKey));
  const known = applied ? undefined : knownFileSlides(fileKey);
  const next = known ? undefined : (applied ?? (await openFile(bytes)));
  const described = known ?? (await describeFile(next as OdpDocument, fileKey));
  // Slides that moved, came or went have page ids written; other edits keep the order. A file
  // without them gets the ids it had when the step started from it (`ensureIds` is the same for
  // the same file), so going back to it and forth again finds its slides too.
  const before = previous.slides;
  const after = described.slides;
  const pairing = pairSlides(before, after, previous.hadPageIds || described.hadPageIds);
  const { pageSize } = described;
  // `next` is not needed any more: drawn from as it is. (What it stored is gone again when the
  // drawing fails.)
  const quick: QuickDrawing = {};
  const drawn = await drawSlides(deps, target, bytes, after, pairing.changed, next, quick);

  const seq = step.kind === 'new' ? revision.editSeq + 1 : step.seq;
  let committed: { replacedImages: string[]; droppedFiles: string[] };
  try {
    // A new hidden slide is not drawn; its texts stand in, as on import.
    for (const index of pairing.changed) {
      if (drawn.has(index) || pairing.source[index] !== null) continue;
      drawn.set(
        index,
        await storeSlideRender(
          deps.storage,
          deck.id,
          revision.id,
          odpPreviewSvg(after[index] as OdpSlide, pageSize),
          null,
        ),
      );
    }

    if (step.kind === 'new') await deps.storage.put(fileKey, bytes);

    committed = await deps.db.transaction(async (tx) => {
      const [fresh] = await tx
        .select()
        .from(revisions)
        .where(eq(revisions.id, revision.id))
        .for('update');
      if (!fresh || fresh.editSeq !== revision.editSeq || fresh.pptxKey !== revision.pptxKey) {
        throw new ApiError(
          409,
          'bad_request',
          'Die Präsentation wurde gerade geändert – bitte nochmal.',
        );
      }
      const droppedFiles =
        step.kind === 'new' ? await recordStep(deps, tx, target, step, seq, fileKey) : [];
      await tx
        .update(revisions)
        .set({ pptxKey: fileKey, editSeq: seq })
        .where(eq(revisions.id, revision.id));
      const replacedImages = await writeSlideVersions(tx, {
        target,
        before,
        after,
        guides: described,
        pairing,
        drawn,
        aspectRatio: pageSize.width / pageSize.height,
      });
      if (deck.isTemplate) await guideAddedLayouts(tx, deck.id, step, before, after, pairing);
      await tx.update(decks).set({ updatedAt: deps.clock.now() }).where(eq(decks.id, deck.id));
      return { replacedImages, droppedFiles };
    });
  } catch (error) {
    // Not committed (someone else's step came first, the database failed): nothing names the
    // pictures drawn for it, nor a new step's file – a step gone back to keeps its own.
    const stored = [...drawn.values()].flatMap((images) => [images.imageKey, images.thumbnailKey]);
    if (step.kind === 'new') stored.push(fileKey);
    await Promise.all([...new Set(stored)].map((key) => deps.storage.delete(key).catch(() => {})));
    throw error;
  }
  const { replacedImages, droppedFiles } = committed;

  deps.rendering?.progress.finish(deck.id, true, deps.clock.now());
  deps.live?.slidesChanged(
    deck.id,
    step.kind === 'new'
      ? { seq, operations: [...step.operations], clientEditId: step.clientEditId ?? null }
      : undefined,
  );
  if (deck.isTemplate) scheduleTemplateSave(deps, deck.id);
  // The step stands either way: texts typed in together that could not be brought along are
  // logged, their editors get the file's text with their next join.
  try {
    syncLiveTexts(deps, deck.id, step.kind === 'new' ? step.operations : [], before, after);
  } catch (error) {
    deps.log.warn(`Deck ${deck.id}: texts typed in together not brought to the new step`, error);
  }
  sharpenLater(deps, target, quick, drawn);
  await dropUnusedImages(deps, replacedImages);
  await Promise.all(
    droppedFiles
      .filter((key) => key !== fileKey)
      .map((key) => deps.storage.delete(key).catch(() => {})),
  );
}

/**
 * Stores a new step as `seq` – after the file as it came (step 0, so undo can go back to it) on
 * the first – and drops the steps that could have been redone after an undo. Returns the files
 * of those steps, to delete.
 */
async function recordStep(
  deps: AppDeps,
  tx: Executor,
  { deck, revision }: EditTarget,
  step: Extract<Step, { kind: 'new' }>,
  seq: number,
  fileKey: string,
): Promise<string[]> {
  if (revision.editSeq === 0) {
    await tx
      .insert(deckEdits)
      .values({
        id: crypto.randomUUID(),
        deckId: deck.id,
        revisionId: revision.id,
        seq: 0,
        fileKey: revision.pptxKey as string,
        operations: [],
        source: 'original',
        authorId: null,
      })
      .onConflictDoNothing();
  }
  const dropped = await tx
    .delete(deckEdits)
    .where(and(eq(deckEdits.revisionId, revision.id), gt(deckEdits.seq, revision.editSeq)))
    .returning({ fileKey: deckEdits.fileKey });
  await tx.insert(deckEdits).values({
    id: step.id,
    deckId: deck.id,
    revisionId: revision.id,
    seq,
    fileKey,
    operations: [...step.operations],
    source: step.source,
    authorId: step.authorId,
    clientEditId: step.clientEditId ?? null,
    dropped: step.dropped,
    // The server's clock, as the AI's proposals keep theirs (which step is whose).
    createdAt: deps.clock.now(),
  });
  return dropped.map((row) => row.fileKey);
}

/**
 * A template's layouts a step added get their guides (`withAddedLayouts`): a copy of a layout
 * (`duplicateSlide`, `addVariant`) that layout's, a new one (`addSlide`) none. A page back by
 * undo, or come otherwise, is a layout as it was.
 */
async function guideAddedLayouts(
  tx: Executor,
  deckId: string,
  step: Step,
  before: readonly OdpSlide[],
  after: readonly OdpSlide[],
  { source }: SlidePairing,
): Promise<void> {
  const made = new Map<string, string | null>();
  for (const operation of step.kind === 'new' ? step.operations : []) {
    if (operation.type === 'addSlide') made.set(operation.newPageId, null);
    if (operation.type === 'duplicateSlide' || operation.type === 'addVariant') {
      made.set(operation.newPageId, operation.pageId);
    }
  }
  const come = after.flatMap((slide, index) =>
    source[index] === null && slide.pageId ? [slide.pageId] : [],
  );
  const added = new Map(
    come.flatMap((pageId) => (made.has(pageId) ? [[pageId, made.get(pageId)!] as const] : [])),
  );
  if (added.size === 0) return;
  const kept = [
    ...before.flatMap((slide) => (slide.pageId ? [slide.pageId] : [])),
    ...come.filter((pageId) => !added.has(pageId)),
  ];
  const [row] = await tx
    .select({ design: decks.templateDesign })
    .from(decks)
    .where(eq(decks.id, deckId))
    .for('update');
  const change = row?.design ? withAddedLayouts(row.design, kept, added) : null;
  if (!row?.design || !change) return;
  await tx
    .update(decks)
    .set({ templateDesign: { ...row.design, ...change } })
    .where(eq(decks.id, deckId));
}

/**
 * The revision's slide versions after a step: those of slides that went are removed – the slide
 * row stays, named by its page (`<revision>:<page id>`) to be found again when the page comes
 * back –, changed ones get their content and new pictures, moved ones their position, and new
 * ones a version – of the slide they were, when their page comes back. Returns the pictures no
 * longer shown by these versions (to delete, unless another version shows them).
 */
async function writeSlideVersions(
  tx: Executor,
  {
    target: { deck, revision },
    before,
    after,
    guides: { layoutGuides, snapLines },
    pairing: { source, removed, changed },
    drawn,
    aspectRatio: pageAspect,
  }: {
    target: EditTarget;
    before: readonly OdpSlide[];
    after: readonly OdpSlide[];
    /** The guides of `after`'s file: each slide's layout's own (`null`: none), its snap lines. */
    guides: {
      layoutGuides: readonly (readonly Guide[] | null)[];
      snapLines: readonly Guide[];
    };
    pairing: SlidePairing;
    drawn: ReadonlyMap<number, DrawnSlide>;
    /** The page's width / height, for a revision that had no slide yet. */
    aspectRatio: number;
  },
): Promise<string[]> {
  const replacedImages: string[] = [];
  // Locked: a sharper picture swapped in meanwhile (`sharpen`) waits, and is not overwritten with
  // its key lost – the key read here is the one replaced, and deleted.
  const versions = await tx
    .select()
    .from(slideVersions)
    .where(eq(slideVersions.revisionId, revision.id))
    .orderBy(asc(slideVersions.position))
    .for('update');
  // Slides that went lose their version in the revision; the slide and its comments stay.
  const gone = removed.flatMap((index) => (versions[index] ? [versions[index]] : []));
  for (const index of removed) {
    const version = versions[index];
    const pageId = before[index]?.pageId;
    if (!version || !pageId) continue;
    await tx
      .update(slides)
      .set({ pageId: `${revision.id}:${pageId}` })
      .where(eq(slides.id, version.slideId));
  }
  if (gone.length > 0) {
    await tx.delete(slideVersions).where(
      inArray(
        slideVersions.id,
        gone.map((version) => version.id),
      ),
    );
    for (const version of gone) replacedImages.push(version.imageKey, version.thumbnailKey);
  }
  const aspectRatio = versions[0]?.aspectRatio ?? pageAspect;
  // Slides that only moved, in one statement after the others: every slide after one that came
  // or went moves, and a deck has hundreds.
  const moved: { id: string; position: number }[] = [];
  for (const slide of after) {
    const from = source[slide.index];
    const version = from === null || from === undefined ? undefined : versions[from];
    const isChanged = changed.has(slide.index);
    if (version && !isChanged) {
      if (version.position !== slide.index) moved.push({ id: version.id, position: slide.index });
      // Its transition picked (nothing else changed), or a version from before it was kept.
      if (version.transition !== slide.transition) {
        await tx
          .update(slideVersions)
          .set({ transition: slide.transition })
          .where(eq(slideVersions.id, version.id));
      }
      continue;
    }
    const parsed = odpParsedSlide(slide);
    const images = drawn.get(slide.index);
    const content = {
      // Its layout's guides, else the file's snap lines – as the import reads the same file
      // (`OdpDocument.slideGuides`), however the slide came.
      guides: [...(layoutGuides[slide.index] ?? snapLines)],
      position: slide.index,
      title: parsed.title,
      hidden: parsed.hidden,
      textHash: parsed.textHash,
      contentHash: parsed.contentHash,
      renderHash: slide.fingerprint,
      shapes: parsed.shapes.map(toShape),
      transition: slide.transition,
    };
    if (version) {
      if (images) replacedImages.push(version.imageKey, version.thumbnailKey);
      await tx
        .update(slideVersions)
        .set({
          ...content,
          ...(images
            ? {
                imageKey: images.imageKey,
                thumbnailKey: images.thumbnailKey,
                renderer: 'libreoffice' as const,
              }
            : {}),
        })
        .where(eq(slideVersions.id, version.id));
      continue;
    }
    // A slide without a version is new to the revision, so changed: drawn, or – hidden, which
    // LibreOffice does not draw – its texts standing in (`commitStep`).
    if (!images) throw new Error(`Slide ${slide.index} of a step was not drawn`);
    // A page coming back (undo, redo) is the slide it was, comments and all; else a new slide.
    const pageKey = slide.pageId ? `${revision.id}:${slide.pageId}` : null;
    const [known] = pageKey
      ? await tx
          .select({ id: slides.id })
          .from(slides)
          .where(and(eq(slides.deckId, deck.id), eq(slides.pageId, pageKey)))
      : [];
    const slideId = known?.id ?? crypto.randomUUID();
    if (!known) await tx.insert(slides).values({ id: slideId, deckId: deck.id, pageId: pageKey });
    await tx.insert(slideVersions).values({
      id: crypto.randomUUID(),
      slideId,
      revisionId: revision.id,
      layoutName: parsed.layoutName,
      ...content,
      imageKey: images.imageKey,
      thumbnailKey: images.thumbnailKey,
      aspectRatio,
      // A hidden slide's picture is the stand-in of its texts, not LibreOffice's (as on import) –
      // but for a variant's.
      renderer: slide.hidden && slide.variantOf === null ? null : 'libreoffice',
    });
  }
  if (moved.length > 0) {
    const rows = sql.join(
      moved.map(({ id, position }) => sql`(${id}, ${position}::integer)`),
      sql`, `,
    );
    await tx.execute(
      sql`update ${slideVersions} set ${sql.identifier(slideVersions.position.name)} = moved.position
        from (values ${rows}) as moved(id, position) where ${slideVersions.id} = moved.id`,
    );
  }
  // Whose variant each slide is, by the slide ids its versions have now (a new slide's included).
  const placed = await tx
    .select({
      id: slideVersions.id,
      slideId: slideVersions.slideId,
      position: slideVersions.position,
      variantOf: slideVersions.variantOf,
    })
    .from(slideVersions)
    .where(eq(slideVersions.revisionId, revision.id));
  const slideAt = new Map(placed.map((version) => [version.position, version.slideId]));
  const pageAt = new Map(
    after.flatMap((slide) => (slide.pageId ? [[slide.pageId, slide.index]] : [])),
  );
  for (const version of placed) {
    const of = after[version.position]?.variantOf;
    const main = (of && slideAt.get(pageAt.get(of) ?? -1)) || null;
    if (version.variantOf !== main)
      await tx
        .update(slideVersions)
        .set({ variantOf: main })
        .where(eq(slideVersions.id, version.id));
  }
  return replacedImages;
}
