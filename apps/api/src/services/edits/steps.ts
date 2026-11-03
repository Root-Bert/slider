import { and, eq, inArray } from 'drizzle-orm';
import { revertChange, type OdpDocument, type OdpSlide } from '@slider/odp';
import type {
  ApplyEditInput,
  ApplyEditResult,
  DeckEditSource,
  DeckEditState,
  RevertEditInput,
  SlideOperation,
  Viewer,
} from '@slider/shared';
import { requireDeckAccess } from '../../auth/access';
import { deckEdits, type DeckEditRow } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { ApiError, badRequest } from '../../http/errors';
import { loadDesigns } from '../workspace-masters';
import { bakeBackdrops } from './backdrops';
import { commitStep } from './commit';
import { loadImages } from './images';
import { loadSources } from './sources';
import { withDeckLock } from './lock';
import { getEditState } from './state';
import { editTarget, openFile, readFile, withFileProblems, type EditTarget } from './target';

/*
 * Editing a deck in Slider (BER-180). The deck's current revision is the working copy: every
 * edit writes the whole file anew as a step of `deck_edits` (so a step's file is exactly what it
 * made), points the revision at it and draws only the slides whose XML changed. Slides, comments
 * and boxes stay those of the revision – the history of versions is not filled with every drag.
 * Undo and redo of the editor take a step back as a new step on top (`revertEdit`); only the
 * AI's own change, still on top, goes back to the step before it (`moveAiStep`).
 */

/** What a change makes of the deck's file ({@link editFile}). */
export interface FileChange {
  /** The next file; `null`: nothing to change – no new step. */
  bytes: Uint8Array | null;
  /** `bytes` open already: spares reading it again. */
  document?: OdpDocument;
  /** The operations the step is stored with, when not those asked for (some left out). */
  operations?: readonly SlideOperation[];
  /**
   * What the change left out: operations that no longer fit the deck – or, taking a step back,
   * slides left as they are because someone changed the same things since.
   */
  dropped?: number;
}

/** What {@link editFile} did. */
export interface FileEdit {
  /** The deck's step afterwards. */
  seq: number;
  /**
   * The step the change made – or, sent again under its `clientEditId`, the step it made the
   * first time. `null`: none (nothing to change), or that first step is of an older version.
   */
  step: number | null;
  /** {@link FileChange.dropped}; for a change sent again, what was left out the first time. */
  dropped: number;
  /** The row of {@link step} (`deck_edits.id`) – which tells it from a step at its place later. */
  editId: string | null;
}

/**
 * Makes a new step from the deck's current file, under the deck's lock: `change` gets it and
 * says what the next file is. `baseSeq` is the step the change was made on, if it matters:
 * another step meanwhile makes it `stale` for `change`. A change sent with the editor's own id
 * (`clientEditId`) that made a step before – its answer got lost, the editor sends it again, the
 * server restarted meanwhile – is found by it and not made again; under the lock, so one sent
 * twice at once is made once too.
 */
export async function editFile(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  step: {
    source: Exclude<DeckEditSource, 'original'>;
    operations: readonly SlideOperation[];
    baseSeq?: number;
    clientEditId?: string;
  },
  change: (current: Uint8Array, target: EditTarget, stale: boolean) => Promise<FileChange>,
): Promise<FileEdit> {
  // Outsiders are turned away before they queue behind the deck's edits; checked again inside.
  await requireDeckAccess(deps, viewer, deckId, 'own');
  return withDeckLock(deckId, async () => {
    const target = await editTarget(deps, viewer, deckId);
    const { revision } = target;
    if (step.clientEditId !== undefined) {
      const made = await stepMadeBy(deps, viewer, target, step.clientEditId);
      if (made) {
        return {
          seq: revision.editSeq,
          step: made.seq,
          // Kept with the step; a step from before that stores only the operations that fitted.
          dropped: made.dropped ?? Math.max(0, step.operations.length - made.operations.length),
          editId: made.seq === null ? null : made.id,
        };
      }
    }
    const stale = step.baseSeq !== undefined && step.baseSeq !== revision.editSeq;
    const current = await readFile(deps, revision.pptxKey);
    const next = await change(current, target, stale);
    const dropped = next.dropped ?? 0;
    if (next.bytes === null) return { seq: revision.editSeq, step: null, dropped, editId: null };
    // Backdrop blurs the change made stale are baked in the same step: undone with it.
    const baked = await bakeBackdrops(deps, target, next.bytes, next.document);
    if (baked) Object.assign(next, baked);
    const editId = crypto.randomUUID();
    await commitStep(
      deps,
      target,
      current,
      next.bytes,
      {
        kind: 'new',
        id: editId,
        dropped,
        operations: next.operations ?? step.operations,
        source: step.source,
        authorId: viewer.author.id,
        clientEditId: step.clientEditId,
      },
      next.document,
    );
    return { seq: revision.editSeq + 1, step: revision.editSeq + 1, dropped, editId };
  });
}

/**
 * The step a change sent with the editor's id `clientEditId` made, if it made one (one that
 * fitted nowhere made none: sent again, it is tried again – and fits as little, or does now).
 * `seq` is `null` when the step is of an older version of the deck. The id is the editor's own,
 * unique for each change; one someone else's step has is refused rather than taken for theirs.
 */
async function stepMadeBy(
  deps: AppDeps,
  viewer: Viewer,
  target: EditTarget,
  clientEditId: string,
): Promise<(Pick<DeckEditRow, 'id' | 'operations' | 'dropped'> & { seq: number | null }) | null> {
  const [made] = await deps.db
    .select({
      id: deckEdits.id,
      dropped: deckEdits.dropped,
      seq: deckEdits.seq,
      revisionId: deckEdits.revisionId,
      authorId: deckEdits.authorId,
      operations: deckEdits.operations,
    })
    .from(deckEdits)
    .where(and(eq(deckEdits.deckId, target.deck.id), eq(deckEdits.clientEditId, clientEditId)));
  if (!made) return null;
  if (made.authorId !== viewer.author.id) {
    throw new ApiError(
      409,
      'bad_request',
      'Diese Änderung gehört zu jemand anderem. Bitte lade die Seite neu.',
    );
  }
  return {
    id: made.id,
    seq: made.revisionId === target.revision.id ? made.seq : null,
    operations: made.operations,
    dropped: made.dropped,
  };
}

/**
 * Applies what fits of `operations` to a copy of the deck's file: the new file and its slides,
 * the operations applied and those left out – each goes in whole or not at all
 * (`applyWhatFits`): one left out leaves no trace in the file, however far it got before it found
 * it did not fit. `reason`: why the first one left out did not fit.
 */
async function applyToFile(
  deps: AppDeps,
  target: EditTarget,
  bytes: Uint8Array,
  operations: readonly SlideOperation[],
): Promise<{
  bytes: Uint8Array;
  slides: OdpSlide[];
  document: OdpDocument;
  applied: SlideOperation[];
  dropped: SlideOperation[];
  reason: string | null;
}> {
  const { deck } = target;
  const images = await loadImages(deps, deck.id, operations);
  const designs = await loadDesigns(deps, deck.workspaceId, operations);
  const document = await openFile(bytes);
  // Every step's file has its ids written: a file from before page ids gets those any reading of
  // it makes up now (the same each time, `ensureIds`) – later files would make up others, once
  // slides came or went, and the steps would no longer pair their slides (`revertEdit`).
  document.ensureIds();
  const sources = await loadSources(deps, target, document, operations);
  // A picture fitted to its frame the first time: its own size read for its crop.
  await withFileProblems(() => document.preparePictures(operations));
  const outcome = await withFileProblems(() =>
    document.applyWhatFits(operations, images, designs, sources),
  );
  const next = await document.toBytes();
  return { bytes: next, slides: document.slides(), document, ...outcome };
}

/**
 * Applies the editor's operations as a new step, to the deck as it is now: they name elements
 * and slides by id, so they find them wherever they went, and the last change of a property
 * wins. Those that no longer fit – the element or slide went meanwhile (someone else edited, or
 * the editor was offline) – are left out and counted (`dropped`), the others go in. Only an edit
 * of which nothing fits, made on the step the deck is at (`baseSeq`), is refused with the reason:
 * then it is no edit of an older state but one that is wrong. (Even an edit that looks current
 * may have been made on another step of the same number – one undone by the AI and replaced –,
 * so the step tells nothing more than that.) Sent again under its `clientEditId` (a retry, a
 * reload while it was on its way), an edit that made its step is not applied twice: the repeat
 * gets the first one's step and count (see {@link editFile}).
 */
export async function applyEdit(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: ApplyEditInput,
): Promise<ApplyEditResult> {
  assertSameAccount(viewer, input.userId);
  const { step, dropped } = await editFile(
    deps,
    viewer,
    deckId,
    {
      source: 'editor',
      operations: input.operations,
      baseSeq: input.baseSeq,
      clientEditId: input.clientEditId,
    },
    async (current, target, stale) => {
      const result = await applyToFile(deps, target, current, input.operations);
      const dropped = result.dropped.length;
      if (result.applied.length > 0) {
        return {
          bytes: result.bytes,
          document: result.document,
          operations: result.applied,
          dropped,
        };
      }
      if (!stale && result.reason !== null) throw badRequest(result.reason);
      return { bytes: null, dropped };
    },
  );
  return { ...(await getEditState(deps, viewer, deckId)), dropped, step };
}

/**
 * An editor names the account it made an edit under (`userId`): another one signed in in the same
 * browser since – the editor's tab had not heard of it yet – gets it refused, not applied as its
 * own. Left out (older editors): not checked.
 */
function assertSameAccount(viewer: Viewer, userId: string | undefined): void {
  if (userId === undefined || userId === viewer.author.id) return;
  throw new ApiError(
    409,
    'account_changed',
    'Inzwischen ist ein anderes Konto angemeldet. Bitte die Seite neu laden.',
  );
}

/**
 * Takes back one step of the viewer's own (undo – and redo, taking back the step that undid it)
 * as a new step on top of the deck as it is now: what the step changed goes back slide by slide,
 * merged with what others changed since, which stays (`@slider/odp`'s `revertChange`). Slides
 * someone changed the same way meanwhile stay as they are and are counted (`dropped`). Sent again
 * under its `clientEditId`, it is taken back once, as an edit is applied once.
 */
export async function revertEdit(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: RevertEditInput,
): Promise<ApplyEditResult> {
  assertSameAccount(viewer, input.userId);
  const { step, dropped } = await editFile(
    deps,
    viewer,
    deckId,
    { source: 'editor', operations: [], clientEditId: input.clientEditId },
    async (current, target) => {
      const rows = await deps.db
        .select()
        .from(deckEdits)
        .where(
          and(
            eq(deckEdits.revisionId, target.revision.id),
            inArray(deckEdits.seq, [input.seq - 1, input.seq]),
          ),
        );
      const before = rows.find((row) => row.seq === input.seq - 1);
      const made = rows.find((row) => row.seq === input.seq);
      if (!before || !made || input.seq > target.revision.editSeq) {
        throw badRequest('Diese Änderung gibt es nicht mehr.');
      }
      if (made.source !== 'editor' || made.authorId !== viewer.author.id) {
        throw badRequest('Rückgängig machen lässt sich nur eine eigene Änderung.');
      }
      const [from, to, document] = await Promise.all([
        readFile(deps, before.fileKey).then(openFile),
        readFile(deps, made.fileKey).then(openFile),
        openFile(current),
      ]);
      // A step's file has the page ids `ensureIds` made up for the file it was made on – so one
      // without them is from before ids were written on every step: those made up for it now
      // may name other slides than before's, and slides would be paired wrongly. (`from` may
      // lack them: the step's file got them from it.)
      if (!to.pageIds().every(Boolean)) {
        throw badRequest('Diese Änderung lässt sich nicht mehr einzeln zurücknehmen.');
      }
      for (const file of [from, to, document]) file.ensureIds();
      const outcome = await withFileProblems(() => revertChange(document, from, to));
      return {
        bytes: outcome.changed ? await document.toBytes() : null,
        document,
        dropped: outcome.conflicts,
      };
    },
  );
  return { ...(await getEditState(deps, viewer, deckId)), dropped, step };
}

/** The step {@link moveAiStep} was to undo or redo is not the one there. */
export class NotThatStep extends Error {}

/**
 * Goes back to the step before the one on top (`-1`) or forth to the next one (`+1`), exactly:
 * how the AI's change is taken back while it is still the last step, and applied again while
 * nothing came after – the editor's own undo and redo take a step back as a new one
 * ({@link revertEdit}). `only` checks, under the deck's lock, the step undone (the one on top)
 * or redone (the next) – else {@link NotThatStep}, and nothing moves.
 */
export async function moveAiStep(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  direction: -1 | 1,
  only: (step: DeckEditRow) => boolean,
): Promise<DeckEditState> {
  // Outsiders are turned away before they queue behind the deck's edits; checked again inside.
  await requireDeckAccess(deps, viewer, deckId, 'own');
  await withDeckLock(deckId, async () => {
    const target = await editTarget(deps, viewer, deckId);
    const { revision } = target;
    const top = revision.editSeq;
    const seq = top + direction;
    const rows =
      seq < 0
        ? []
        : await deps.db
            .select()
            .from(deckEdits)
            .where(and(eq(deckEdits.revisionId, revision.id), inArray(deckEdits.seq, [top, seq])));
    const moved = rows.find((row) => row.seq === (direction < 0 ? top : seq));
    const step = rows.find((row) => row.seq === seq);
    if (!moved || !only(moved)) throw new NotThatStep();
    if (!step) throw badRequest('Diese Änderung gibt es nicht mehr.');
    const [current, bytes] = await Promise.all([
      readFile(deps, revision.pptxKey),
      readFile(deps, step.fileKey),
    ]);
    await commitStep(deps, target, current, bytes, { kind: 'move', seq, fileKey: step.fileKey });
  });
  return getEditState(deps, viewer, deckId);
}
