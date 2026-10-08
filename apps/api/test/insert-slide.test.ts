import { afterEach, describe, expect, it, vi } from 'vitest';
import { insertSlideResultSchema, slideSchema, syncResultSchema } from '@slider/shared';
import { createDeckFromFile } from '../src/services/decks';
import { microsoftLoginRequired, sourceForbidden } from '../src/sources/errors';
import { cookieFrom, createTestContext, type TestContext } from './helpers';
import {
  BASE_SLIDES,
  createLinkDeck,
  FakeSource,
  pptxBytes,
  presentation,
  revisionRows,
  versionedPptx,
  type SlideDef,
} from './sync-helpers';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

const NEW_SLIDE_ID = 400;
/** v1 with an empty slide after "Agenda" (sldId 257). */
const WITH_NEW_SLIDE: SlideDef[] = [
  ...BASE_SLIDES.slice(0, 2),
  { sldId: NEW_SLIDE_ID, title: '', body: '' },
  ...BASE_SLIDES.slice(2),
];

async function setup() {
  const source = new FakeSource();
  const pptx = versionedPptx({
    v1: presentation(BASE_SLIDES),
    'v1+slide': presentation(WITH_NEW_SLIDE),
  });
  // The real PPTX edit is tested in @slider/pptx; here the fake bytes just switch version.
  const insertSlide = vi.fn(async (bytes: Uint8Array, options: { afterSldId: number | null }) => {
    expect(options.afterSldId).toBe(257);
    const version = new TextDecoder().decode(bytes.slice(4));
    return {
      bytes: pptxBytes(`${version}+slide`),
      sldId: NEW_SLIDE_ID,
      path: 'ppt/slides/slide7.xml',
    };
  });
  ctx = await createTestContext({
    openPptx: pptx.open,
    sources: { onedrive: source },
    insertSlide,
  });
  const deckId = await createLinkDeck(ctx, source);
  const slides = slideSchema
    .array()
    .parse(await (await ctx.request(`/api/decks/${deckId}/slides`)).json());
  const agenda = slides.find((slide) => slide.title === 'Agenda');
  if (!agenda) throw new Error('Agenda slide missing');
  return { ctx, source, deckId, agendaId: agenda.id, insertSlide };
}

const insert = (context: TestContext, deckId: string, afterSlideId: string, cookie?: string) =>
  context.request(`/api/decks/${deckId}/slides`, {
    method: 'POST',
    json: { afterSlideId },
    cookie,
  });

describe('inserting a slide (POST /decks/:id/slides)', () => {
  it('writes the slide into the PowerPoint and shows it as the next revision', async () => {
    const { ctx, source, deckId, agendaId } = await setup();

    const res = await insert(ctx, deckId, agendaId);
    expect(res.status).toBe(200);
    const body = insertSlideResultSchema.parse(await res.json());

    expect(body.result.status).toBe('updated');
    expect(source.replace).toHaveBeenCalledTimes(1);
    expect(source.replace.mock.calls[0]?.[0]).toMatchObject({ eTag: 'e1' });
    const slides = slideSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${deckId}/slides`)).json());
    expect(slides.map((slide) => slide.title)).toEqual([
      'Q4 Strategie',
      'Agenda',
      '',
      ...BASE_SLIDES.slice(2).map((slide) => slide.title),
    ]);
    expect(body.slideId).toBe(slides[2]?.id);
    // Existing slides keep their identity.
    expect(slides[1]?.id).toBe(agendaId);

    const revisions = await revisionRows(ctx, deckId);
    expect(revisions.map((revision) => revision.trigger)).toEqual(['initial', 'edit']);
    expect(revisions[1]?.sourceChangeToken).toBe(source.token);
  });

  it('does not import its own write again on the next sync', async () => {
    const { ctx, source, deckId, agendaId } = await setup();
    await insert(ctx, deckId, agendaId);
    source.download.mockClear();

    const res = await ctx.request(`/api/decks/${deckId}/sync`, { method: 'POST' });
    expect(syncResultSchema.parse(await res.json())).toEqual({ status: 'unchanged' });
    expect(source.download).not.toHaveBeenCalled();
    expect(await revisionRows(ctx, deckId)).toHaveLength(2);
  });

  it('redoes the edit on top of a save by someone else instead of overwriting it', async () => {
    const { ctx, source, deckId, agendaId, insertSlide } = await setup();
    source.conflicts = 1;

    const res = await insert(ctx, deckId, agendaId);

    expect(res.status).toBe(200);
    expect(source.openForEdit).toHaveBeenCalledTimes(2);
    expect(insertSlide).toHaveBeenCalledTimes(2);
    expect(source.replace).toHaveBeenCalledTimes(2);
    expect(await revisionRows(ctx, deckId)).toHaveLength(2);
  });

  it('gives up after repeated saves by others, without a revision', async () => {
    const { ctx, source, deckId, agendaId } = await setup();
    source.conflicts = 10;

    const res = await insert(ctx, deckId, agendaId);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'conflict' } });
    expect(source.replace).toHaveBeenCalledTimes(3);
    expect(await revisionRows(ctx, deckId)).toHaveLength(1);
  });

  it('asks for a write login that comes back to the deck', async () => {
    const { ctx, source, deckId, agendaId } = await setup();
    source.replace.mockRejectedValueOnce(microsoftLoginRequired(''));

    const res = await insert(ctx, deckId, agendaId);

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; loginUrl: string } };
    expect(body.error.code).toBe('microsoft_login_required');
    expect(body.error.loginUrl).toBe(
      `/api/auth/microsoft/login?access=write&returnTo=${encodeURIComponent(
        `/d/${deckId}?slide=${agendaId}&insertAfter=${agendaId}`,
      )}`,
    );
  });

  it('passes on a missing write permission on the file', async () => {
    const { ctx, source, deckId, agendaId } = await setup();
    source.replace.mockRejectedValueOnce(
      sourceForbidden('Dein Microsoft-Konto darf diese PowerPoint nicht bearbeiten.'),
    );

    const res = await insert(ctx, deckId, agendaId);

    expect(res.status).toBe(403);
    expect(await revisionRows(ctx, deckId)).toHaveLength(1);
  });

  it('is only for the owner, and only for linked decks', async () => {
    const { ctx, deckId, agendaId } = await setup();
    const link = (await (
      await ctx.request(`/api/decks/${deckId}/review-links`, {
        method: 'POST',
        json: { role: 'comment' },
      })
    ).json()) as { token: string };
    const guest = cookieFrom(
      await ctx.request(`/api/invites/${link.token}/join`, {
        method: 'POST',
        json: { name: 'Gast' },
      }),
    );
    expect((await insert(ctx, deckId, agendaId, guest)).status).toBe(403);

    const upload = await createDeckFromFile(ctx.deps, ctx, {
      fileName: 'Upload.pptx',
      bytes: pptxBytes('v1'),
      source: 'upload',
    });
    await ctx.deps.queue.idle();
    const uploadSlides = slideSchema
      .array()
      .parse(await (await ctx.request(`/api/decks/${upload.id}/slides`)).json());
    expect((await insert(ctx, upload.id, uploadSlides[0]!.id)).status).toBe(400);

    expect((await insert(ctx, deckId, crypto.randomUUID())).status).toBe(404);
  });
});
