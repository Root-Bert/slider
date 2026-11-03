import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyEditResultSchema,
  deckEditStateSchema,
  deckSchema,
  type DeckEditState,
} from '@slider/shared';
import { deckEdits, decks, revisions, slideVersions } from '../src/db/schema';
import { createTestContext, type TestContext } from './helpers';
import { DEMO_ODP, fakeOdpPdf, odpForm } from './odp-helpers';

/* Committing an edit's step: what it stores beside the database, and what a step keeps. */

let ctx: TestContext | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await ctx?.cleanup();
  ctx = undefined;
});

async function odpDeck() {
  await ctx?.cleanup();
  ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf() });
  const res = await ctx.request('/api/decks/upload', { method: 'POST', body: odpForm(DEMO_ODP) });
  const deck = deckSchema.parse(await res.json());
  await ctx.deps.queue.idle();
  return { ctx, deckId: deck.id };
}

const stateOf = async (context: TestContext, deckId: string): Promise<DeckEditState> =>
  deckEditStateSchema.parse(await (await context.request(`/api/decks/${deckId}/edit`)).json());

const elementOf = (
  state: DeckEditState,
  slide: number,
  match: (name: string, role: string | null) => boolean,
) => {
  const found = state.slides[slide]?.elements.find((item) => match(item.name, item.role));
  if (!found) throw new Error(`no element on slide ${slide}`);
  return found;
};

describe('committing a step', () => {
  it('leaves nothing behind when a step fails, places moved slides and answers a resent step back in full', async () => {
    {
      const { ctx, deckId } = await odpDeck();
      const state = await stateOf(ctx, deckId);
      const title = elementOf(state, 2, (_, role) => role === 'title');
      const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId));
      const revisionId = deck!.currentRevisionId!;

      // Someone else's step comes first, while this one's file is being stored: its commit finds
      // the revision moved on.
      const put = ctx.deps.storage.put.bind(ctx.deps.storage);
      const stored: string[] = [];
      vi.spyOn(ctx.deps.storage, 'put').mockImplementation(async (key, bytes) => {
        stored.push(key);
        await put(key, bytes);
        if (key.endsWith('.odp')) {
          await ctx.deps.db
            .update(revisions)
            .set({ editSeq: 7 })
            .where(eq(revisions.id, revisionId));
        }
      });
      const res = await ctx.request(`/api/decks/${deckId}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [{ type: 'setText', elementId: title.id, paragraphs: ['Nie gespeichert'] }],
        },
      });
      expect(res.status).toBe(409);

      // Its slide was drawn and its file stored – and both are gone again.
      expect(stored.some((key) => key.endsWith('.odp'))).toBe(true);
      expect(stored.some((key) => !key.endsWith('.odp'))).toBe(true);
      for (const key of stored) expect(await ctx.deps.storage.size(key)).toBeNull();
      const versions = await ctx.deps.db
        .select({ imageKey: slideVersions.imageKey })
        .from(slideVersions)
        .where(eq(slideVersions.revisionId, revisionId));
      for (const { imageKey } of versions)
        expect(await ctx.deps.storage.size(imageKey)).not.toBeNull();
    }
    {
      const { ctx, deckId } = await odpDeck();
      const state = await stateOf(ctx, deckId);
      const pages = state.slides.map((slide) => slide.pageId);
      const res = await ctx.request(`/api/decks/${deckId}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [
            { type: 'duplicateSlide', pageId: pages[0]!, newPageId: 'sl-vorne', after: null },
          ],
        },
      });
      expect(res.status).toBe(200);
      const after = applyEditResultSchema.parse(await res.json());
      expect(after.slides.map((slide) => slide.pageId)).toEqual(['sl-vorne', ...pages]);
      // Every slide that was there kept its slide, one place further on.
      expect(after.slides.slice(1).map((slide) => slide.slideId)).toEqual(
        state.slides.map((slide) => slide.slideId),
      );
      const positions = await ctx.deps.db
        .select({ slideId: slideVersions.slideId, position: slideVersions.position })
        .from(slideVersions)
        .where(eq(slideVersions.revisionId, (await currentRevision(ctx, deckId))!));
      expect(Object.fromEntries(positions.map((row) => [row.slideId, row.position]))).toEqual(
        Object.fromEntries(after.slides.map((slide, index) => [slide.slideId, index])),
      );
    }
    {
      const { ctx, deckId } = await odpDeck();
      const state = await stateOf(ctx, deckId);
      const note = elementOf(state, 2, (name) => name === 'Hinweis');
      const title = elementOf(state, 0, (_, role) => role === 'title');
      // My step: the note moved and the first title typed.
      await ctx.request(`/api/decks/${deckId}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [
            { type: 'setBox', elementId: note.id, box: { ...note.bbox, x: 0.05, y: 0.05 } },
            { type: 'setText', elementId: title.id, paragraphs: ['Meins'] },
          ],
        },
      });
      // Someone else moves the note further.
      await ctx.request(`/api/decks/${deckId}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [
            { type: 'setBox', elementId: note.id, box: { ...note.bbox, x: 0.3, y: 0.3 } },
          ],
        },
      });
      await ctx.deps.db.update(deckEdits).set({ authorId: null }).where(eq(deckEdits.seq, 2));

      const undo = { seq: 1, clientEditId: 'zurueck-1' };
      const send = async () =>
        applyEditResultSchema.parse(
          await (
            await ctx.request(`/api/decks/${deckId}/edit/revert`, { method: 'POST', json: undo })
          ).json(),
        );
      const first = await send();
      // The title goes back; the note, moved by them since, stays theirs.
      expect(first).toMatchObject({ seq: 3, step: 3, dropped: 1 });
      expect(elementOf(first, 0, (_, role) => role === 'title').paragraphs).not.toEqual(['Meins']);
      expect(await send()).toMatchObject({ seq: 3, step: 3, dropped: 1 });
    }
  });
});

async function currentRevision(context: TestContext, deckId: string) {
  const [deck] = await context.deps.db.select().from(decks).where(eq(decks.id, deckId));
  return deck?.currentRevisionId;
}
