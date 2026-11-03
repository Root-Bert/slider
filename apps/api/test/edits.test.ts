import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OdpDocument, OdpError } from '@slider/odp';
import {
  applyEditResultSchema,
  deckEditStateSchema,
  deckSchema,
  integrationsSchema,
  slideLayersSchema,
  slideSchema,
  LIVE_TEXT_VERSION,
  liveTextJoinSchema,
  uploadedEditImageSchema,
  type Author,
  type DeckEditState,
  type LiveEvent,
  type Slide,
} from '@slider/shared';
import {
  applyLiveChange,
  fromBase64,
  liveTextOf,
  readLiveText,
  toBase64,
} from '@slider/shared/live-text';
import * as Y from 'yjs';
import { deckEdits, decks, revisions } from '../src/db/schema';
import { fromAddress, RecordingMailer, type Mailer } from '../src/mail/mailer';
import { LiveHub } from '../src/realtime/live-hub';
import { sweepOldEditImages } from '../src/services/old-edit-images';
import { UNLIMITED_PLAN } from '../src/services/plans';
import { DAY_MS } from '../src/services/retention-rules';
import {
  remeasureDeck,
  totalBytes,
  workspaceStorageUsage,
} from '../src/services/workspace-storage';
import type { NextcloudAdapter } from '../src/sources/nextcloud';
import type { RemoteFile } from '../src/sources/source-adapter';
import type { CutOutSource } from '../src/services/cut-outs';
import { createTestContext, signedInUser, type TestContext } from './helpers';
import { DEMO_ODP, fakeOdpPdf, odpForm } from './odp-helpers';
import { makeSlidesPdf } from './pdf';
import { TEST_DATA_KEY } from './setup-data-key';

/* Editing an ODP deck in Slider (BER-180, BER-181, BER-182). */

let ctx: TestContext | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await ctx?.cleanup();
  ctx = undefined;
});

type Calls = { pages: readonly number[] | null }[];

async function odpDeck(
  options: {
    calls?: Calls;
    nextcloud?: FakeNextcloud;
    live?: LiveHub;
    cutOuts?: CutOutSource;
    mailer?: Mailer;
  } = {},
) {
  ctx = await createTestContext({
    libreOfficePdf: fakeOdpPdf(options.calls),
    cutOuts: options.cutOuts,
    mailer: options.mailer,
    ...(options.live ? { live: options.live } : {}),
    ...(options.nextcloud
      ? { sources: { nextcloud: options.nextcloud as unknown as NextcloudAdapter } }
      : {}),
  });
  const res = await ctx.request('/api/decks/upload', { method: 'POST', body: odpForm(DEMO_ODP) });
  const deck = deckSchema.parse(await res.json());
  await ctx.deps.queue.idle();
  return { ctx, deckId: deck.id };
}

const stateOf = async (context: TestContext, deckId: string): Promise<DeckEditState> =>
  deckEditStateSchema.parse(await (await context.request(`/api/decks/${deckId}/edit`)).json());

const slidesOf = async (context: TestContext, deckId: string): Promise<Slide[]> =>
  slideSchema.array().parse(await (await context.request(`/api/decks/${deckId}/slides`)).json());

const element = (
  state: DeckEditState,
  slide: number,
  match: (name: string, role: string | null) => boolean,
) => {
  const found = state.slides[slide]?.elements.find((item) => match(item.name, item.role));
  if (!found) throw new Error(`no element on slide ${slide}`);
  return found;
};

/** A live editor that has nothing yet: joining, it gets all of the shared text. */
const NEW_EDITOR = {
  version: LIVE_TEXT_VERSION,
  start: '',
  state: toBase64(Y.encodeStateVector(new Y.Doc())),
};

async function edit(context: TestContext, deckId: string, body: unknown) {
  return context.request(`/api/decks/${deckId}/edit/operations`, { method: 'POST', json: body });
}

/** Takes back one own step (undo; redo takes the undo's step back). */
const revert = (context: TestContext, deckId: string, seq: number) =>
  context.request(`/api/decks/${deckId}/edit/revert`, { method: 'POST', json: { seq } });

describe('editing an ODP deck', () => {
  it('shows its slides with their elements and live texts, editable by who manages it – ODP decks only; exports one slide and mails exports', async () => {
    const calls: Calls = [];
    const mailer = new RecordingMailer();
    const { ctx, deckId } = await odpDeck({ calls, mailer });
    const state = await stateOf(ctx, deckId);
    expect(state).toMatchObject({
      editable: true,
      seq: 0,
      mail: true,
    });
    expect(state.slides).toHaveLength(6);
    const slides = await slidesOf(ctx, deckId);
    expect(state.slides.map((slide) => slide.slideId)).toEqual(slides.map((slide) => slide.id));
    expect(element(state, 2, (name) => name === 'Hinweis').paragraphs).toEqual([
      'Planwerte vorbehaltlich der Budgetfreigabe im Oktober.',
    ]);

    // The slide size, and which texts can be typed on the slide.
    expect(state.pageSize.width).toBeCloseTo(33.867, 2);
    expect(element(state, 2, (_, role) => role === 'title').live).not.toBeNull();
    expect(element(state, 2, (name) => name === 'Tabelle Umsatz').live).toBeNull();

    const { cookie } = await signedInUser(ctx, { name: 'Gesa', email: 'gesa@example.org' });
    expect((await ctx.request(`/api/decks/${deckId}/edit`, { cookie })).status).toBe(404);

    // „Nur diese Folie“: one slide as a one-page PDF (only its page drawn) or as its picture.
    const second = slides[1]!;
    calls.length = 0;
    const slidePdf = await ctx.request(`/api/decks/${deckId}/edit/slides/${second.id}/pdf`);
    expect(slidePdf.status).toBe(200);
    expect(slidePdf.headers.get('content-type')).toBe('application/pdf');
    expect(decodeURIComponent(slidePdf.headers.get('content-disposition')!)).toContain(
      'Strategie – Folie 2.pdf',
    );
    expect(calls).toEqual([{ pages: [2] }]);
    const slidePng = await ctx.request(`/api/decks/${deckId}/edit/slides/${second.id}/png`);
    expect(slidePng.status).toBe(200);
    expect(slidePng.headers.get('content-type')).toBe('image/png');
    const png = Buffer.from(await slidePng.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect((await ctx.request(`/api/decks/${deckId}/edit/slides/nope/png`)).status).toBe(404);
    expect(
      (await ctx.request(`/api/decks/${deckId}/edit/slides/${second.id}/pdf`, { cookie })).status,
    ).toBe(404);

    // „Senden“: mailed as an attachment in the sender's name – only by who may export it.
    const send = (body: unknown, as?: string) =>
      ctx.request(`/api/decks/${deckId}/edit/send`, { method: 'POST', json: body, cookie: as });
    const mailed = {
      to: 'kim@example.org',
      format: 'slidePng',
      slideId: second.id,
      note: 'Für morgen',
    };
    expect((await send(mailed)).status).toBe(204);
    const [mail] = mailer.sent;
    expect(mail).toMatchObject({
      to: 'kim@example.org',
      subject: expect.stringContaining('„Strategie“'),
      // In the sender's name, from the instance's address; replies go to the sender.
      fromName: expect.stringContaining('(über Slider)'),
      replyTo: expect.stringContaining('@'),
    });
    expect(fromAddress('Slider <noreply@example.org>')).toBe('noreply@example.org');
    expect(mail!.text).toContain('Für morgen');
    const attached = mail!.attachments!.find((file) => !file.cid)!;
    expect(attached).toMatchObject({
      filename: 'Strategie – Folie 2.png',
      contentType: 'image/png',
    });
    expect(Buffer.compare(attached.content, png)).toBe(0);
    expect((await send({ ...mailed, format: 'file' })).status).toBe(204);
    expect(mailer.sent[1]!.attachments!.find((file) => !file.cid)?.filename).toBe('Strategie.odp');
    expect((await send({ ...mailed, to: 'kein-mail' })).status).toBe(400);
    expect((await send({ ...mailed, format: 'slidePdf', slideId: undefined })).status).toBe(400);
    expect((await send(mailed, cookie)).status).toBe(404);
    expect(mailer.sent).toHaveLength(2);

    // No photos before a search is typed on a server without a photo source.
    const photos = await ctx.request(`/api/decks/${deckId}/stock/photos`);
    expect(photos.status).toBe(200);
    expect(await photos.json()).toEqual({ photos: [] });
    expect((await ctx.request(`/api/decks/${deckId}/stock/photos?q=Berge`)).status).toBe(404);

    // Not offered for other decks.
    const pdf = new FormData();
    pdf.append(
      'file',
      new File([makeSlidesPdf([{ texts: [{ text: 'A', x: 80, y: 60, size: 40 }] }])], 'A.pdf'),
    );
    const other = deckSchema.parse(
      await (await ctx.request('/api/decks/upload', { method: 'POST', body: pdf })).json(),
    );
    await ctx.deps.queue.idle();
    expect(await stateOf(ctx, other.id)).toMatchObject({
      editable: false,
      reason: expect.stringContaining('ODP'),
    });
    const refused = await edit(ctx, other.id, {
      operations: [{ type: 'deleteElement', elementId: 't1' }],
    });
    expect(refused.status).toBe(409);
  });

  it('applies an edit or take-back sent again under its id once – also while the first is still applied, and after a restart', async () => {
    const { ctx, deckId } = await odpDeck();
    const state = await stateOf(ctx, deckId);
    const title = element(state, 2, (_, role) => role === 'title');
    const body = {
      baseSeq: 0,
      clientEditId: 'edit-1',
      operations: [{ type: 'setText', elementId: title.id, paragraphs: ['Einmal'] }],
    };
    const [first, again] = await Promise.all([edit(ctx, deckId, body), edit(ctx, deckId, body)]);
    const answers = [first, again].map(async (res) =>
      applyEditResultSchema.parse(await res.json()),
    );
    for (const answer of await Promise.all(answers)) expect(answer.step).toBe(1);
    const later = applyEditResultSchema.parse(await (await edit(ctx, deckId, body)).json());
    expect(later).toMatchObject({ seq: 1, step: 1 });
    const steps = await ctx.deps.db.select().from(deckEdits);
    expect(steps.map((step) => [step.seq, step.clientEditId]).sort()).toEqual([
      [0, null],
      [1, 'edit-1'],
    ]);

    // Made on an older step with something that no longer fits: sent again, it tells the same.
    const stale = {
      baseSeq: 0,
      clientEditId: 'edit-2',
      operations: [
        { type: 'setText', elementId: title.id, paragraphs: ['Zweimal'] },
        { type: 'deleteElement', elementId: 'gibt-es-nicht' },
      ],
    };
    const made = applyEditResultSchema.parse(await (await edit(ctx, deckId, stale)).json());
    expect(made).toMatchObject({ seq: 2, step: 2, dropped: 1 });
    const repeated = applyEditResultSchema.parse(await (await edit(ctx, deckId, stale)).json());
    expect(repeated).toMatchObject({ seq: 2, step: 2, dropped: 1 });

    // An id another person's step has (they are the editors' own) is not taken for theirs.
    const { user } = await signedInUser(ctx, { name: 'Gesa', email: 'gesa@example.org' });
    await ctx.deps.db
      .update(deckEdits)
      .set({ authorId: user.id })
      .where(eq(deckEdits.clientEditId, 'edit-2'));
    expect((await edit(ctx, deckId, stale)).status).toBe(409);
    expect((await stateOf(ctx, deckId)).seq).toBe(2);

    // A take-back sent again under its id: taken back once.
    await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: title.id, paragraphs: ['Einmal zurück'] }],
    });
    const undo = { seq: 3, clientEditId: 'undo-1' };
    const send = async () =>
      applyEditResultSchema.parse(
        await (
          await ctx.request(`/api/decks/${deckId}/edit/revert`, { method: 'POST', json: undo })
        ).json(),
      );
    const undone = await Promise.all([send(), send()]);
    for (const answer of undone) expect(answer).toMatchObject({ seq: 4, step: 4, dropped: 0 });
    expect(await send()).toMatchObject({ seq: 4, step: 4 });
    expect(element(undone[0]!, 2, (_, role) => role === 'title').paragraphs).toEqual(['Zweimal']);
    const all = await ctx.deps.db.select().from(deckEdits);
    expect(all.map((step) => [step.seq, step.clientEditId]).sort()).toEqual([
      [0, null],
      [1, 'edit-1'],
      [2, 'edit-2'],
      [3, null],
      [4, 'undo-1'],
    ]);

    // A server started anew on the same database: nothing of the first one's memory is left –
    // it starts with the key of the encrypted columns, as on start (`content-encryption`).
    vi.resetModules();
    const [{ createApp }, { useDataKey }, { loadSodium }] = await Promise.all([
      import('../src/app'),
      import('../src/crypto/content-crypto'),
      import('../src/crypto/sodium'),
    ]);
    await loadSodium();
    useDataKey(TEST_DATA_KEY);
    const restarted = createApp(ctx.deps);
    const afterRestart = await restarted.request(`/api/decks/${deckId}/edit/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(afterRestart.status).toBe(200);
    expect(applyEditResultSchema.parse(await afterRestart.json())).toMatchObject({
      step: 1,
      dropped: 0,
    });
    expect(await ctx.deps.db.select().from(deckEdits)).toHaveLength(5);
  });

  it('changes text, draws only that slide again, undoes and redoes it – never pulled over from the source', async () => {
    const calls: Calls = [];
    const nextcloud = new FakeNextcloud();
    const { ctx, deckId } = await odpDeck({ calls, nextcloud });
    await linkToNextcloud(ctx, deckId);
    const before = await slidesOf(ctx, deckId);
    const state = await stateOf(ctx, deckId);
    const title = element(state, 2, (_, role) => role === 'title');
    calls.length = 0;

    const res = await edit(ctx, deckId, {
      baseSeq: 0,
      operations: [{ type: 'setText', elementId: title.id, paragraphs: ['Umsatz 2026'] }],
    });
    expect(res.status).toBe(200);
    expect(applyEditResultSchema.parse(await res.json())).toMatchObject({ seq: 1, step: 1 });
    // Slide 3 is the third visible slide: only its page was drawn.
    expect(calls).toEqual([{ pages: [3] }]);
    const after = await slidesOf(ctx, deckId);
    expect(after[2]!.title).toBe('Umsatz 2026');
    expect(after[2]!.imageUrl).not.toBe(before[2]!.imageUrl);
    expect(after[0]!.imageUrl.split('?')[0]).toBe(before[0]!.imageUrl.split('?')[0]);

    // Undo takes the step back as a new one; redo takes the undo back.
    const undone = await revert(ctx, deckId, 1);
    expect(applyEditResultSchema.parse(await undone.json())).toMatchObject({ seq: 2, step: 2 });
    expect((await slidesOf(ctx, deckId))[2]!.title).toBe('Umsatz nach Region');

    const redone = await revert(ctx, deckId, 2);
    expect(applyEditResultSchema.parse(await redone.json())).toMatchObject({ seq: 3, step: 3 });
    expect((await slidesOf(ctx, deckId))[2]!.title).toBe('Umsatz 2026');

    // Unchanged in the source: nothing to pull, no conflict. Changed: not imported over the edits.
    expect(await ctx.deps.sync.checkDeck(deckId)).toEqual({ status: 'unchanged' });
    nextcloud.etag = 'changed-in-cloud';
    await expect(ctx.deps.sync.checkDeck(deckId)).rejects.toMatchObject({
      code: 'edit_conflict',
    });
    const rerender = await ctx.request(`/api/decks/${deckId}/rerender`, { method: 'POST' });
    expect(rerender.status).toBe(409);
    expect(await rerender.json()).toMatchObject({ error: { code: 'edit_conflict' } });
    expect(
      await ctx.deps.db.select().from(revisions).where(eq(revisions.deckId, deckId)),
    ).toHaveLength(1);
    expect((await stateOf(ctx, deckId)).seq).toBe(3);
  });

  it('applies an edit made on an older step to the deck as it is now, leaving no trace of what is left out', async () => {
    const { ctx, deckId } = await odpDeck();
    const state = await stateOf(ctx, deckId);
    const note = element(state, 2, (name) => name === 'Hinweis');
    await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: note.id, paragraphs: ['B'] }],
    });
    const steps = await ctx.deps.db.select().from(deckEdits);
    expect(steps.map((step) => step.seq).sort()).toEqual([0, 1]);

    // Made on step 0 (someone else's step 1 since): applied to the deck as it is now.
    const stale = await edit(ctx, deckId, {
      baseSeq: 0,
      operations: [{ type: 'setText', elementId: note.id, paragraphs: ['C'] }],
    });
    expect(stale.status).toBe(200);
    expect(applyEditResultSchema.parse(await stale.json())).toMatchObject({ seq: 2, dropped: 0 });
    expect(element(await stateOf(ctx, deckId), 2, (name) => name === 'Hinweis').paragraphs).toEqual(
      ['C'],
    );
    // On the step it was made on, an edit of which nothing fits is refused, with the reason.
    const wrong = await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: 'nope', paragraphs: ['C'] }],
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({
      error: { message: 'Dieses Element gibt es nicht mehr.' },
    });
    // What fits of it goes in, though: a step of the same number may be another one by now (the
    // AI's change undone and a new step made), so the number does not tell the edit is current.
    const partly = await edit(ctx, deckId, {
      baseSeq: 2,
      operations: [
        { type: 'setText', elementId: note.id, paragraphs: ['D'] },
        { type: 'deleteElement', elementId: 'nope' },
      ],
    });
    expect(applyEditResultSchema.parse(await partly.json())).toMatchObject({
      seq: 3,
      step: 3,
      dropped: 1,
    });

    // An operation left out leaves no trace in the file, however far it got.
    const title = element(state, 2, (_, role) => role === 'title');
    const page = state.slides[1]!.pageId;
    const fileNow = async () =>
      OdpDocument.open(
        new Uint8Array(await (await ctx.request(`/api/decks/${deckId}/edit/file`)).arrayBuffer()),
      );
    const before = await fileNow();
    const picturesBefore = (await before.pictures()).map((picture) => picture.path);
    const stylesBefore = before.search('<style:style ').total;

    // The picture frame fails at its very end – its placeholder picture is in the package then,
    // its style among the automatic styles.
    const prototype = OdpDocument.prototype as unknown as { putOnTop: () => void };
    vi.spyOn(prototype, 'putOnTop').mockImplementation(() => {
      throw new OdpError('operation', 'Passt nicht mehr.');
    });
    const box = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 };
    const res = await edit(ctx, deckId, {
      baseSeq: 0,
      operations: [
        { type: 'setText', elementId: title.id, paragraphs: ['Offline geändert'] },
        { type: 'addImage', pageId: page, elementId: 'sl-halb', box, imageId: null },
        { type: 'setBox', elementId: title.id, box },
      ],
    });
    expect(res.status).toBe(200);
    const result = applyEditResultSchema.parse(await res.json());
    expect(result).toMatchObject({ seq: 4, step: 4, dropped: 1 });
    const moved = element(result, 2, (_, role) => role === 'title');
    expect(moved.paragraphs).toEqual(['Offline geändert']);
    expect(moved.bbox.w).toBeCloseTo(box.w, 3);

    const file = await fileNow();
    expect((await file.pictures()).map((picture) => picture.path)).toEqual(picturesBefore);
    expect(file.search('sl-halb').total).toBe(0);
    // Neither title operation needs a style of its own: the frame's never came.
    expect(file.search('<style:style ').total).toBe(stylesBefore);
    const [step] = await ctx.deps.db.select().from(deckEdits).where(eq(deckEdits.seq, 4));
    expect(step?.operations.map((operation) => operation.type)).toEqual(['setText', 'setBox']);
  });

  it('merges edits made offline: what still fits goes in, the rest is left out, resent is no twice', async () => {
    const { ctx, deckId } = await odpDeck();
    const state = await stateOf(ctx, deckId);
    const note = element(state, 2, (name) => name === 'Hinweis');
    const title = element(state, 2, (_, role) => role === 'title');
    const pages = state.slides.map((slide) => slide.pageId);
    // Someone else deletes the note and moves slide 3 to the front.
    await edit(ctx, deckId, {
      baseSeq: 0,
      operations: [
        { type: 'deleteElement', elementId: note.id },
        { type: 'moveSlide', pageId: pages[2]!, after: null },
      ],
    });
    // Offline on step 0: the note changed, the title changed, a box added on slide 3.
    const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
    const offline = {
      baseSeq: 0,
      operations: [
        { type: 'setText', elementId: note.id, paragraphs: ['weg'] },
        { type: 'setText', elementId: title.id, paragraphs: ['Offline geändert'] },
        {
          type: 'addElement',
          pageId: pages[2]!,
          elementId: 'sl-offline',
          kind: 'rect',
          box,
          fill: '#ff0000',
          stroke: null,
          paragraphs: [],
        },
      ],
    };
    const merged = await edit(ctx, deckId, offline);
    expect(merged.status).toBe(200);
    const result = applyEditResultSchema.parse(await merged.json());
    expect(result).toMatchObject({ seq: 2, dropped: 1 });
    // Slide 3 is first now: the title and the box went there.
    const first = result.slides[0]!;
    expect(first.pageId).toBe(pages[2]);
    expect(first.elements.find((item) => item.id === title.id)?.paragraphs).toEqual([
      'Offline geändert',
    ]);
    expect(first.elements.some((item) => item.id === 'sl-offline')).toBe(true);
    const steps = await ctx.deps.db.select().from(deckEdits);
    expect(steps.find((step) => step.seq === 2)?.operations).toHaveLength(2);

    // Sent again (its answer got lost): nothing twice, no new step.
    const again = applyEditResultSchema.parse(await (await edit(ctx, deckId, offline)).json());
    expect(again.seq).toBe(3);
    expect(again.slides[0]!.elements.filter((item) => item.id === 'sl-offline')).toHaveLength(1);
    // Nothing left that fits: no step at all.
    const nothing = applyEditResultSchema.parse(
      await (
        await edit(ctx, deckId, {
          baseSeq: 0,
          operations: [{ type: 'deleteElement', elementId: note.id }],
        })
      ).json(),
    );
    expect(nothing).toMatchObject({ seq: 3, dropped: 1 });

    // The note copied (or cut) before it was deleted: put in as the file before that had it.
    const pasted = applyEditResultSchema.parse(
      await (
        await edit(ctx, deckId, {
          operations: [
            {
              type: 'copyElement',
              elementId: note.id,
              pageId: pages[1]!,
              newElementId: 'sl-pasted',
              box: note.bbox,
            },
          ],
        })
      ).json(),
    );
    expect(pasted).toMatchObject({ seq: 4, dropped: 0 });
    const onSlide = pasted.slides.find((slide) => slide.pageId === pages[1]);
    expect(onSlide?.elements.find((item) => item.id === 'sl-pasted')?.paragraphs).toEqual(
      note.paragraphs,
    );
  });

  it('undoes and redoes only one’s own step, keeping what others changed since, under the account signed in', async () => {
    const { ctx, deckId } = await odpDeck();
    const state = await stateOf(ctx, deckId);
    const note = element(state, 2, (name) => name === 'Hinweis');
    const title = element(state, 2, (_, role) => role === 'title');
    const revert = async (seq: number) =>
      ctx.request(`/api/decks/${deckId}/edit/revert`, { method: 'POST', json: { seq } });
    const box = { ...note.bbox, x: 0.05, y: 0.05 };
    const mine = applyEditResultSchema.parse(
      await (
        await edit(ctx, deckId, { operations: [{ type: 'setBox', elementId: note.id, box }] })
      ).json(),
    );
    expect(mine.step).toBe(1);
    // Someone else types the title on the same slide afterwards.
    await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: title.id, paragraphs: ['Von nebenan'] }],
    });
    await ctx.deps.db.update(deckEdits).set({ authorId: null }).where(eq(deckEdits.seq, 2));

    // Undo: the note goes back, their title stays – a new step on top.
    const undone = applyEditResultSchema.parse(await (await revert(1)).json());
    expect(undone).toMatchObject({ seq: 3, step: 3, dropped: 0 });
    const back = element(undone, 2, (name) => name === 'Hinweis');
    expect(back.bbox.x).toBeCloseTo(note.bbox.x, 3);
    expect(element(undone, 2, (_, role) => role === 'title').paragraphs).toEqual(['Von nebenan']);
    // Redo: taking the undo back.
    const redone = applyEditResultSchema.parse(await (await revert(3)).json());
    expect(redone.step).toBe(4);
    expect(element(redone, 2, (name) => name === 'Hinweis').bbox.x).toBeCloseTo(0.05, 3);
    expect(element(redone, 2, (_, role) => role === 'title').paragraphs).toEqual(['Von nebenan']);

    // Their step is not mine to take back; a step not there is refused too.
    expect((await revert(2)).status).toBe(400);
    expect((await revert(9)).status).toBe(400);

    // The editor's tab still knew of an account signed out since: not applied as this one's.
    const operations = [{ type: 'setText', elementId: title.id, paragraphs: ['Wessen?'] }];
    const other = await edit(ctx, deckId, { operations, userId: 'ein-anderes-konto' });
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ error: { code: 'account_changed' } });
    expect((await stateOf(ctx, deckId)).seq).toBe(4);
    const own = await edit(ctx, deckId, { operations, userId: ctx.ownerId });
    expect(applyEditResultSchema.parse(await own.json()).step).toBe(5);
    const undo = (userId: string) =>
      ctx.request(`/api/decks/${deckId}/edit/revert`, { method: 'POST', json: { seq: 5, userId } });
    expect((await undo('ein-anderes-konto')).status).toBe(409);
    expect((await stateOf(ctx, deckId)).seq).toBe(5);

    // A backdrop blur is baked into the note's fill in the step that sets it (the slide under it
    // drawn by LibreOffice, blurred, its layers over that) – and goes with it on undo.
    const fileOf = async () =>
      OdpDocument.open(
        new Uint8Array(await (await ctx.request(`/api/decks/${deckId}/edit/file`)).arrayBuffer()),
      );
    const glass = [{ type: 'solid', color: '#ffffff', opacity: 0.4, visible: true }];
    const effects = { shadow: null, blur: null, glow: null, backdrop: 12 };
    const frost = { type: 'setShapeStyle', elementId: note.id, fills: glass, effects };
    const frosted = applyEditResultSchema.parse(
      await (await edit(ctx, deckId, { operations: [frost] })).json(),
    );
    expect(frosted.step).toBe(6);
    const baked = element(frosted, 2, (name) => name === 'Hinweis').look!;
    expect(baked).toMatchObject({ fill: null, fills: glass, effects: { backdrop: 12 } });
    expect(baked.fillAspect).toBeGreaterThan(0);
    expect((await fileOf()).backdropWork()).toEqual([]);
    const unfrosted = applyEditResultSchema.parse(await (await revert(6)).json());
    expect(element(unfrosted, 2, (name) => name === 'Hinweis').look).toEqual(note.look);
    // Without LibreOffice the step goes in all the same, unblurred – baked by a later step. (Put
    // to the back: the slide under it is another, not drawn before.)
    const toPdf = ctx.deps.rendering!.renderers.libreOfficePdf!;
    vi.spyOn(toPdf, 'pages').mockRejectedValueOnce(new Error('LibreOffice fehlt'));
    const toBack = { type: 'moveElement', elementId: note.id, to: 0 };
    const stale = applyEditResultSchema.parse(
      await (await edit(ctx, deckId, { operations: [frost, toBack] })).json(),
    );
    expect(element(stale, 2, (name) => name === 'Hinweis').look).toMatchObject({
      fill: '#ffffff',
      effects: { backdrop: 12 },
    });
    expect((await fileOf()).backdropWork()).toMatchObject([{ elementId: note.id, radius: 12 }]);
    await edit(ctx, deckId, { operations });
    expect((await fileOf()).backdropWork()).toEqual([]);
    expect(element(await stateOf(ctx, deckId), 2, (name) => name === 'Hinweis').look!.fill).toBe(
      null,
    );

    // ⌘G: note and title in one group (its elements keeping their ids), moved as one; ⇧⌘G takes
    // it apart – its undo (no way back in the browser) is the server's, the group back.
    const group = {
      type: 'groupElements',
      elementIds: [note.id, title.id],
      newElementId: 'slgroup1',
    };
    const grouped = applyEditResultSchema.parse(
      await (await edit(ctx, deckId, { operations: [group] })).json(),
    );
    const made = element(grouped, 2, (name) => name === 'Gruppe 1');
    expect(made).toMatchObject({ id: 'slgroup1', kind: 'group', movable: true, resizable: false });
    // The note was put to the back before: bottom first.
    expect(made.members).toEqual([note.id, title.id]);
    expect(grouped.slides[2]!.elements.some((item) => item.id === note.id)).toBe(false);
    // Entered (a double click): its elements are there by their ids – the note moved in it.
    expect(made.children?.map((item) => item.id)).toEqual([note.id, title.id]);
    const part = made.children![0]!;
    const moveIn = {
      type: 'setBox',
      elementId: note.id,
      box: { ...part.bbox, y: part.bbox.y + 0.05 },
    } as const;
    const unmoved = await fileOf();
    const inGroup = applyEditResultSchema.parse(
      await (await edit(ctx, deckId, { operations: [moveIn] })).json(),
    );
    const movedIn = element(inGroup, 2, (name) => name === 'Gruppe 1');
    expect(movedIn.children?.[0]?.bbox.y).toBeCloseTo(part.bbox.y + 0.05, 3);
    // Its frosted glass moved in the group: stale, baked anew in the same step.
    unmoved.apply([moveIn]);
    expect(unmoved.backdropWork()).toMatchObject([{ elementId: note.id }]);
    expect((await fileOf()).backdropWork()).toEqual([]);
    const apart = applyEditResultSchema.parse(
      await (
        await edit(ctx, deckId, {
          operations: [{ type: 'ungroupElements', elementId: 'slgroup1' }],
        })
      ).json(),
    );
    expect(element(apart, 2, (name) => name === 'Hinweis').id).toBe(note.id);
    const regrouped = applyEditResultSchema.parse(await (await revert(apart.step!)).json());
    expect(element(regrouped, 2, (name) => name === 'Gruppe 1').members).toEqual([
      note.id,
      title.id,
    ]);
  });

  it('lets two people type in one text at once: what one types reaches the other', async () => {
    const hub = new LiveHub();
    const { ctx, deckId } = await odpDeck({ live: hub });
    const title = element(await stateOf(ctx, deckId), 2, (_, role) => role === 'title');
    const owner: Author = { id: ctx.ownerId, name: 'Owner', type: 'owner', color: 'blue' };
    const heard: LiveEvent[] = [];
    const a = hub.join(deckId, owner, () => {});
    const b = hub.join(deckId, owner, (event) => heard.push(event));
    const join = async (key: string) => {
      const res = await ctx.request(`/api/live/${key}/text/${title.id}/join`, {
        method: 'POST',
        json: { ...NEW_EDITOR, member: key },
      });
      expect(res.status).toBe(200);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, fromBase64(liveTextJoinSchema.parse(await res.json()).update));
      return doc;
    };
    const post = (key: string, update: Uint8Array) =>
      ctx.request(`/api/live/${key}/text/${title.id}`, {
        method: 'POST',
        body: JSON.stringify({ member: key, update: toBase64(update) }),
        headers: { 'content-type': 'application/json' },
      });

    // Not typing in it yet: refused.
    expect((await post(a, new Uint8Array([0, 0]))).status).toBe(404);
    // Both start from the file's text.
    const docA = await join(a);
    const docB = await join(b);
    const fallback = title.live!.paragraphs[0]!;
    const before = readLiveText(liveTextOf(docA), fallback);
    expect(before.map((p) => p.runs.map((run) => run.text).join(''))).toEqual(title.paragraphs);

    // A types: the update reaches B (and nobody else), B has the same text.
    const updates: Uint8Array[] = [];
    docA.on('update', (update: Uint8Array) => updates.push(update));
    const typed = [{ ...before[0]!, runs: [{ ...before[0]!.runs[0]!, text: 'Umsatz Q4' }] }];
    applyLiveChange(liveTextOf(docA), typed);
    expect((await post(a, updates[0]!)).status).toBe(204);
    const text = heard.find((event) => event.type === 'text');
    expect(text).toMatchObject({ type: 'text', elementId: title.id });
    Y.applyUpdate(docB, fromBase64((text as { update: string }).update));
    expect(readLiveText(liveTextOf(docB), fallback)).toEqual(
      readLiveText(liveTextOf(docA), fallback),
    );
    // Someone joining later gets the text as typed so far, not the file's.
    const c = hub.join(deckId, owner, () => {});
    expect(readLiveText(liveTextOf(await join(c)), fallback)[0]!.runs[0]!.text).toBe('Umsatz Q4');

    // Gone (tab closed): its posts are refused; the others still type.
    hub.leave(a);
    expect((await post(a, updates[0]!)).status).toBe(404);
    expect((await post(b, updates[0]!)).status).toBe(204);

    // Each step reaches the others with what it did (applied at once, before the refetch). Two
    // edits of one element made on the same step – one moves it, one fills it – both stay.
    heard.length = 0;
    const seq = (await stateOf(ctx, deckId)).seq;
    const moved = { x: 0.2, y: 0.3, w: 0.5, h: 0.1 };
    await edit(ctx, deckId, {
      baseSeq: seq,
      clientEditId: 'move-1',
      operations: [{ type: 'setBox', elementId: title.id, box: moved }],
    });
    await edit(ctx, deckId, {
      baseSeq: seq,
      clientEditId: 'fill-1',
      operations: [{ type: 'setShapeStyle', elementId: title.id, fill: '#00aa00' }],
    });
    const steps = heard.flatMap((event) =>
      event.type === 'slides' && event.step ? [event.step] : [],
    );
    expect(steps).toMatchObject([
      {
        seq: seq + 1,
        clientEditId: 'move-1',
        operations: [{ type: 'setBox', elementId: title.id }],
      },
      { seq: seq + 2, clientEditId: 'fill-1', operations: [{ type: 'setShapeStyle' }] },
    ]);
    const both = element(await stateOf(ctx, deckId), 2, (_, role) => role === 'title');
    expect(both.bbox.x).toBeCloseTo(moved.x, 3);
    expect(both.look!.fill).toBe('#00aa00');
    hub.closeAll();
  });

  it('writes an undo into a text typed in together, but not the typing saved', async () => {
    const hub = new LiveHub();
    const { ctx, deckId } = await odpDeck({ live: hub });
    const title = element(await stateOf(ctx, deckId), 2, (_, role) => role === 'title');
    await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: title.id, paragraphs: ['Umsatz 2026'] }],
    });
    const owner: Author = { id: ctx.ownerId, name: 'Owner', type: 'owner', color: 'blue' };
    const heard: LiveEvent[] = [];
    const a = hub.join(deckId, owner, () => {});
    const b = hub.join(deckId, owner, (event) => heard.push(event));
    const join = async (key: string) => {
      const res = await ctx.request(`/api/live/${key}/text/${title.id}/join`, {
        method: 'POST',
        json: { ...NEW_EDITOR, member: key },
      });
      const doc = new Y.Doc();
      Y.applyUpdate(doc, fromBase64(liveTextJoinSchema.parse(await res.json()).update));
      return doc;
    };
    const docA = await join(a);
    const docB = await join(b);
    const fallback = title.live!.paragraphs[0]!;
    const said = (doc: Y.Doc) =>
      readLiveText(liveTextOf(doc), fallback).map((p) => p.runs.map((run) => run.text).join(''));
    expect(said(docA)).toEqual(['Umsatz 2026']);
    const texts = () => heard.filter((event) => event.type === 'text') as { update: string }[];

    // Undo of the step: the shared text says the file's text again, B hears it.
    expect((await revert(ctx, deckId, 1)).status).toBe(200);
    expect(texts()).toHaveLength(1);
    Y.applyUpdate(docB, fromBase64(texts()[0]!.update));
    expect(said(docB)).toEqual(['Umsatz nach Region']);

    // A types on and saves (`setRichText`) while the shared text is ahead already: kept as is.
    const updates: Uint8Array[] = [];
    docA.on('update', (update: Uint8Array) => updates.push(update));
    Y.applyUpdate(docA, fromBase64(texts()[0]!.update));
    const before = readLiveText(liveTextOf(docA), fallback);
    const typed = (text: string) => [{ ...before[0]!, runs: [{ ...before[0]!.runs[0]!, text }] }];
    applyLiveChange(liveTextOf(docA), typed('Umsatz nach Region!!'));
    await ctx.request(`/api/live/${a}/text/${title.id}`, {
      method: 'POST',
      json: { member: a, update: toBase64(Y.mergeUpdates(updates)) },
    });
    const relayed = texts().length;
    const saved = await edit(ctx, deckId, {
      operations: [
        {
          type: 'setRichText',
          elementId: title.id,
          paragraphs: typed('Umsatz nach Region!'),
          typed: true,
        },
      ],
    });
    expect(saved.status).toBe(200);
    expect(texts()).toHaveLength(relayed);
    const c = hub.join(deckId, owner, () => {});
    expect(said(await join(c))).toEqual(['Umsatz nach Region!!']);

    // Rich text from elsewhere – the format panel, from paragraphs it had: written into the
    // shared text, so the editors there show it and do not save theirs back over it – merged with
    // what was typed there since the last save (the second „!“), which stays.
    const panel = await edit(ctx, deckId, {
      operations: [{ type: 'setRichText', elementId: title.id, paragraphs: typed('Umsatz fett') }],
    });
    expect(panel.status).toBe(200);
    expect(texts()).toHaveLength(relayed + 1);
    const d = hub.join(deckId, owner, () => {});
    expect(said(await join(d))).toEqual(['Umsatz fett!']);
    hub.closeAll();
  });

  it('moves an element, swaps a picture for an uploaded one and removes its background, counted against storage until removed after 7 days', async () => {
    // rembg as a fake: the picture as it came.
    const cutOut = vi.fn(async (bytes: Uint8Array) => bytes);
    const { ctx, deckId } = await odpDeck({ cutOuts: { cutOut } });
    const state = await stateOf(ctx, deckId);
    const picture = element(state, 3, (name) => name === 'Roadmap Visual');

    const png = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwH4QZYAwAQdQH+UW2eecAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const upload = () => {
      const body = new FormData();
      body.append('file', new File([png], 'neu.png'));
      return ctx.request(`/api/decks/${deckId}/edit/images`, { method: 'POST', body });
    };
    const used = async () => totalBytes(await workspaceStorageUsage(ctx.deps.db, ctx.workspaceId));
    const listed = async () => (await ctx.deps.storage.list(`decks/${deckId}/edit-images/`)).length;
    const unused = await used();
    const uploaded = await upload();
    expect(uploaded.status).toBe(201);
    expect(await used()).toBe(unused + png.byteLength);
    const image = uploadedEditImageSchema.parse(await uploaded.json());
    expect(image).toMatchObject({ width: 2, height: 1 });

    // „Strecken“ on the imported picture: its own size read from the file first.
    const stretched = await edit(ctx, deckId, {
      operations: [{ type: 'setImageFit', elementId: picture.id, fit: 'stretch' }],
    });
    expect(applyEditResultSchema.parse(await stretched.json())).toMatchObject({ dropped: 0 });
    expect(
      element(await stateOf(ctx, deckId), 3, (name) => name === 'Roadmap Visual').picture,
    ).toMatchObject({ fit: 'stretch' });

    const res = await edit(ctx, deckId, {
      operations: [
        { type: 'setBox', elementId: picture.id, box: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 } },
        { type: 'replaceImage', elementId: picture.id, imageId: image.imageId },
      ],
    });
    expect(res.status).toBe(200);
    const moved = element(
      deckEditStateSchema.parse(await res.json()),
      3,
      (name) => name === 'Roadmap Visual',
    );
    // A 2:1 picture in a 0.5 × 0.25 frame of a 16:9 page (wider than 2:1): as high as the
    // frame, centred across it.
    const width = (0.25 * 2 * 9) / 16;
    expect(moved.bbox.h).toBeCloseTo(0.25, 3);
    expect(moved.bbox.w).toBeCloseTo(width, 3);
    expect(moved.bbox.x).toBeCloseTo(0.1 + (0.5 - width) / 2, 3);

    const file = await ctx.request(`/api/decks/${deckId}/edit/file`);
    expect(file.headers.get('content-disposition')).toContain('Strategie.odp');
    const document = await OdpDocument.open(new Uint8Array(await file.arrayBuffer()));
    expect(
      document.slides()[3]!.elements.find((item) => item.id === picture.id)!.bbox.h,
    ).toBeCloseTo(0.25, 3);

    // Locked in place – in the file, for LibreOffice too – and unlocked again by undo.
    const locked = await edit(ctx, deckId, {
      operations: [{ type: 'setLocked', elementId: picture.id, locked: true }],
    });
    expect(locked.status).toBe(200);
    const lockStep = applyEditResultSchema.parse(await locked.json()).step!;
    const roadmap = async () =>
      element(await stateOf(ctx, deckId), 3, (name) => name === 'Roadmap Visual');
    expect((await roadmap()).locked).toBe(true);
    expect((await revert(ctx, deckId, lockStep)).status).toBe(200);
    expect((await roadmap()).locked).toBeUndefined();

    // The swapped picture fills its frame; its left part shown, zoomed in.
    const filled = await edit(ctx, deckId, {
      operations: [
        {
          type: 'setImageFit',
          elementId: picture.id,
          fit: 'fill',
          focus: { x: 0.25, y: 0.5, zoom: 2 },
        },
      ],
    });
    expect(filled.status).toBe(200);
    expect((await roadmap()).picture).toMatchObject({
      fit: 'fill',
      aspect: 2,
      focus: { x: 0.25, y: 0.5, zoom: 2 },
    });

    // „Hintergrund entfernen“: the picture the element shows, cut out by rembg – ready for
    // `replaceImage`; refused for an element showing none.
    const removeBackground = (elementId: string) =>
      ctx.request(`/api/decks/${deckId}/edit/elements/${elementId}/remove-background`, {
        method: 'POST',
      });
    expect(state.cutOut).toBe(true);
    const freed = await removeBackground(picture.id);
    expect(freed.status).toBe(201);
    expect(Buffer.from(cutOut.mock.calls[0]![0])).toEqual(Buffer.from(png));
    expect(uploadedEditImageSchema.parse(await freed.json())).toMatchObject({
      width: 2,
      height: 1,
    });
    const title = element(state, 2, (_, role) => role === 'title');
    expect((await removeBackground(title.id)).status).toBe(400);

    const notAnImage = new FormData();
    notAnImage.append('file', new File([new TextEncoder().encode('hallo')], 'x.png'));
    expect(
      (await ctx.request(`/api/decks/${deckId}/edit/images`, { method: 'POST', body: notAnImage }))
        .status,
    ).toBe(400);

    // A frame drawn on a slide: a placeholder, and the uploaded picture fitted into one.
    const box = { x: 0.1, y: 0.5, w: 0.5, h: 0.25 };
    const page = (await stateOf(ctx, deckId)).slides[1]!.pageId;
    const added = await edit(ctx, deckId, {
      operations: [
        { type: 'addImage', pageId: page, elementId: 'sl-placeholder', box, imageId: null },
        { type: 'addImage', pageId: page, elementId: 'sl-uploaded', box, imageId: image.imageId },
      ],
    });
    expect(added.status).toBe(200);
    const slide = deckEditStateSchema.parse(await added.json()).slides[1]!;
    const placeholder = slide.elements.find((item) => item.id === 'sl-placeholder');
    const uploadedPicture = slide.elements.find((item) => item.id === 'sl-uploaded');
    expect(placeholder?.kind).toBe('image');
    expect(placeholder!.bbox.w).toBeCloseTo(box.w, 3);
    expect(placeholder!.bbox.h).toBeCloseTo(box.h, 3);
    expect(uploadedPicture?.kind).toBe('image');
    expect(uploadedPicture!.bbox.w).toBeCloseTo(width, 3);

    // Editor pictures go after 7 days and are no longer counted.
    // The edits grew the deck's file since: measured anew, as the sweep does – once the edited
    // slides' quick pictures are replaced by their WebP.
    await ctx.deps.background?.idle();
    await remeasureDeck(ctx.deps, deckId);
    const withPicture = await used();
    ctx.clock.advance(6 * DAY_MS);
    await sweepOldEditImages(ctx.deps);
    expect(await listed()).toBe(2);
    ctx.clock.advance(2 * DAY_MS);
    await sweepOldEditImages(ctx.deps);
    expect(await listed()).toBe(0);
    // The uploaded picture and its cut-out copy.
    expect(await used()).toBe(withPicture - 2 * png.byteLength);
    // Nothing left to look at: the next runs pass the deck by.
    const [row] = await ctx.deps.db
      .select({ since: decks.editImagesSince })
      .from(decks)
      .where(eq(decks.id, deckId));
    expect(row!.since).toBeNull();
    const gone = await edit(ctx, deckId, {
      operations: [{ type: 'replaceImage', elementId: picture.id, imageId: image.imageId }],
    });
    expect(gone.status).toBe(400);

    // Storage full: refused, nothing stored.
    ctx.deps.config.plans.free = { ...UNLIMITED_PLAN, maxStorageBytes: await used() };
    expect((await upload()).status).toBe(403);
    expect(await listed()).toBe(0);
  });

  it('generates a picture for a frame with the workspace’s key – OpenAI’s API or FLUX, cut to the frame', async () => {
    const asked: { url: string; body: unknown }[] = [];
    let pending = 1;
    // A 4 × 2 picture, whatever the size asked.
    const png = await (async () => {
      const { createCanvas } = await import('@napi-rs/canvas');
      return new Uint8Array(await createCanvas(4, 2).encode('png'));
    })();
    const aiFetch = async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      asked.push({ url, body });
      if (url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-image-2' }] });
      if (url.endsWith('/images/generations')) {
        return Response.json({ data: [{ b64_json: Buffer.from(png).toString('base64') }] });
      }
      if (url.endsWith('/openapi.json')) {
        return Response.json({
          paths: { '/v1/flux-3-image': { post: { summary: 'Generate an image with FLUX 3.' } } },
        });
      }
      if (url.endsWith('/credits')) return Response.json({ credits: 5 });
      if (url.endsWith('/v1/flux-3-image')) {
        return Response.json({
          id: 't1',
          polling_url: 'https://api.eu.bfl.ai/v1/get_result?id=t1',
        });
      }
      if (url.includes('/get_result')) {
        return Response.json(
          pending-- > 0
            ? { status: 'Pending' }
            : { status: 'Ready', result: { sample: 'https://delivery-eu.bfl.ai/t1.png' } },
        );
      }
      if (url === 'https://delivery-eu.bfl.ai/t1.png') return new Response(png);
      return new Response('', { status: 404 });
    };
    ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf(), aiFetch });
    const deck = deckSchema.parse(
      await (
        await ctx.request('/api/decks/upload', { method: 'POST', body: odpForm(DEMO_ODP) })
      ).json(),
    );
    await ctx.deps.queue.idle();
    const generate = (aspect: number | null) =>
      ctx!.request(`/api/decks/${deck.id}/edit/images/generate`, {
        method: 'POST',
        json: { prompt: 'Ein Leuchtturm im Nebel', aspect },
      });
    const addKey = (json: object) =>
      ctx!.request(`/api/workspaces/${ctx!.workspaceId}/integrations/keys`, {
        method: 'POST',
        json: { kind: 'images', ...json },
      });

    // Without a key: nothing to offer, and asked anyway, why not.
    expect((await stateOf(ctx, deck.id)).imageGeneration).toBe(false);
    const none = await generate(null);
    expect(none.status).toBe(400);
    expect(JSON.stringify(await none.json())).toContain('keine Bildgenerierung eingerichtet');

    expect((await addKey({ provider: 'openai', apiKey: 'sk-proj-good-1234567' })).status).toBe(200);
    expect((await stateOf(ctx, deck.id)).imageGeneration).toBe(true);
    // A wide frame: generated landscape, cut to 2:1 – the picture is so already.
    const wide = await generate(2);
    expect(wide.status).toBe(201);
    expect(uploadedEditImageSchema.parse(await wide.json())).toMatchObject({ width: 4, height: 2 });
    expect(asked.at(-1)?.body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'Ein Leuchtturm im Nebel',
      size: '1536x1024',
    });
    // A square frame: its middle.
    const square = uploadedEditImageSchema.parse(await (await generate(1)).json());
    expect(square).toMatchObject({ width: 2, height: 2 });
    expect(asked.at(-1)?.body).toMatchObject({ size: '1024x1024' });

    // FLUX: a task, asked about until it is ready, the picture fetched from where it lies.
    const flux = await addKey({ provider: 'black-forest-labs', apiKey: 'bfl-good-12345678' });
    const { id } = integrationsSchema
      .parse(await flux.json())
      .areas.images.keys.find((key) => key.provider === 'black-forest-labs')!;
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/integrations/keys/${id}`, {
      method: 'PATCH',
      json: { active: true },
    });
    asked.length = 0;
    const tall = await generate(0.5);
    expect(tall.status).toBe(201);
    expect(uploadedEditImageSchema.parse(await tall.json())).toMatchObject({ width: 1, height: 2 });
    expect(asked.map((each) => each.url)).toEqual([
      'https://api.eu.bfl.ai/v1/flux-3-image',
      'https://api.eu.bfl.ai/v1/get_result?id=t1',
      'https://api.eu.bfl.ai/v1/get_result?id=t1',
      'https://delivery-eu.bfl.ai/t1.png',
    ]);
    expect(asked[0]?.body).toMatchObject({ width: 816, height: 1440 });
  });

  it('copies, hides, moves and deletes slides – each stays the slide it was, and comes back on undo', async () => {
    const calls: Calls = [];
    const { ctx, deckId } = await odpDeck({ calls });
    const before = await slidesOf(ctx, deckId);
    const ids = before.map((slide) => slide.id);
    const initial = await stateOf(ctx, deckId);
    const pages = initial.slides.map((slide) => slide.pageId);
    calls.length = 0;

    // A copy inserted at a gap: a slide of its own, drawn, gone again on undo.
    const copied = await edit(ctx, deckId, {
      operations: [
        { type: 'duplicateSlide', pageId: pages[2]!, newPageId: 'sl-copy', after: pages[0]! },
      ],
    });
    expect(copied.status).toBe(200);
    const withCopy = await slidesOf(ctx, deckId);
    expect(withCopy).toHaveLength(ids.length + 1);
    expect([withCopy[0]!.id, ...withCopy.slice(2).map((slide) => slide.id)]).toEqual(ids);
    expect(ids).not.toContain(withCopy[1]!.id);
    expect(withCopy[1]!.title).toBe(withCopy[3]!.title);
    expect(calls.length).toBeGreaterThan(0);
    expect((await revert(ctx, deckId, 1)).status).toBe(200);
    expect((await slidesOf(ctx, deckId)).map((slide) => slide.id)).toEqual(ids);
    calls.length = 0;

    // A variant: hidden, yet drawn, and a variant of its slide; speaker notes are never drawn.
    const varied = applyEditResultSchema.parse(
      await (
        await edit(ctx, deckId, {
          operations: [{ type: 'addVariant', pageId: pages[2]!, newPageId: 'sl-variante' }],
        })
      ).json(),
    );
    expect(calls.length).toBeGreaterThan(0);
    const withVariant = await slidesOf(ctx, deckId);
    expect(withVariant[3]).toMatchObject({ hidden: true, variantOf: ids[2] });
    expect(withVariant[3]!.imageUrl).not.toMatch(/\.svg/);
    expect(varied.slides[3]).toMatchObject({ variantOf: pages[2], hidden: true });
    calls.length = 0;
    const noted = applyEditResultSchema.parse(
      await (
        await edit(ctx, deckId, {
          operations: [
            {
              type: 'setSlideNotes',
              pageId: pages[2]!,
              text: 'Langsam.\nPause.',
              paragraphs: [
                { runs: [{ text: 'Langsam', bold: true }, { text: '.' }] },
                { runs: [{ text: 'Pause.' }], list: { kind: 'bullet', level: 1 } },
              ],
            },
          ],
        })
      ).json(),
    );
    expect(noted.slides[2]!.notes).toBe('Langsam.\nPause.');
    // Formatted notes come back formatted.
    expect(noted.slides[2]!.notesRich).toEqual([
      { runs: [{ text: 'Langsam', bold: true }, { text: '.' }] },
      { runs: [{ text: 'Pause.' }], list: { kind: 'bullet', level: 1 } },
    ]);
    expect(calls).toEqual([]);
    // Taking its slide's place: the slide becomes the variant, comments stay with each.
    const swapped = applyEditResultSchema.parse(
      await (
        await edit(ctx, deckId, { operations: [{ type: 'useVariant', pageId: 'sl-variante' }] })
      ).json(),
    );
    const used = await slidesOf(ctx, deckId);
    expect(used[2]).toMatchObject({ hidden: false, variantOf: null });
    expect(used[3]).toMatchObject({ id: ids[2], hidden: true, variantOf: used[2]!.id });
    for (const step of [swapped.step, noted.step, varied.step])
      expect((await revert(ctx, deckId, step!)).status).toBe(200);
    expect((await slidesOf(ctx, deckId)).map((slide) => slide.id)).toEqual(ids);

    // A transition picked plays in every viewer's slide show, not only the editor's.
    const transition = applyEditResultSchema.parse(
      await (
        await edit(ctx, deckId, {
          operations: [{ type: 'setSlideTransition', pageId: pages[1]!, transition: 'push' }],
        })
      ).json(),
    );
    expect((await slidesOf(ctx, deckId)).map((slide) => slide.transition)).toEqual([
      'none',
      'push',
      'none',
      'none',
      'none',
      'none',
    ]);
    expect((await revert(ctx, deckId, transition.step!)).status).toBe(200);
    expect((await slidesOf(ctx, deckId))[1]!.transition).toBe('none');
    calls.length = 0;

    const hide = await edit(ctx, deckId, {
      operations: [{ type: 'setSlideHidden', pageId: pages[1]!, hidden: true }],
    });
    expect(hide.status).toBe(200);
    // A hidden slide is not drawn again.
    expect(calls).toEqual([]);
    expect((await slidesOf(ctx, deckId)).map((slide) => slide.hidden)).toEqual([
      false,
      true,
      false,
      false,
      true,
      false,
    ]);

    const moved = await edit(ctx, deckId, {
      operations: [{ type: 'moveSlide', pageId: pages[0]!, after: pages[2]! }],
    });
    expect(moved.status).toBe(200);
    expect(calls).toEqual([]);
    expect((await slidesOf(ctx, deckId)).map((slide) => slide.id)).toEqual([
      ids[1],
      ids[2],
      ids[0],
      ...ids.slice(3),
    ]);

    const deleted = await edit(ctx, deckId, {
      operations: [{ type: 'deleteSlide', pageId: pages[0]! }],
    });
    expect(deleted.status).toBe(200);
    const state = applyEditResultSchema.parse(await deleted.json());
    expect(state.slides.map((slide) => slide.slideId)).toEqual([ids[1], ids[2], ...ids.slice(3)]);

    expect((await revert(ctx, deckId, state.step!)).status).toBe(200);
    expect((await slidesOf(ctx, deckId)).map((slide) => slide.id)).toEqual([
      ids[1],
      ids[2],
      ids[0],
      ...ids.slice(3),
    ]);

    // A deleted slide comes back as itself on undo, though copies were made since.
    const elements = initial.slides[3]!.elements.map((item) => item.id);
    const gone = applyEditResultSchema.parse(
      await (
        await edit(ctx, deckId, { operations: [{ type: 'deleteSlide', pageId: pages[3]! }] })
      ).json(),
    );
    // A copy made since gets ids the server picks for its elements: never the deleted slide's.
    await edit(ctx, deckId, {
      operations: [
        { type: 'duplicateSlide', pageId: pages[1]!, newPageId: 'sl-kopie', after: pages[1]! },
      ],
    });
    const undone = applyEditResultSchema.parse(
      await (await revert(ctx, deckId, gone.step!)).json(),
    );
    expect(undone.dropped).toBe(0);
    const back = undone.slides.find((slide) => slide.pageId === pages[3]);
    // The slide it was – its comments with it – and its elements as they were.
    expect(back?.slideId).toBe(ids[3]);
    expect(back?.elements.map((item) => item.id)).toEqual(elements);
    expect((await slidesOf(ctx, deckId)).map((slide) => slide.id)).toContain(ids[3]);
  });
});

/** Nextcloud as far as pulling an edited deck goes. */
class FakeNextcloud {
  etag = 'e1';

  async getChangeToken(): Promise<string> {
    return this.etag;
  }

  async download(): Promise<Uint8Array> {
    return DEMO_ODP;
  }

  async resolve(): Promise<RemoteFile> {
    throw new Error('not used');
  }
}

async function linkToNextcloud(context: TestContext, deckId: string) {
  await context.deps.db
    .update(decks)
    .set({ source: 'nextcloud', sourceRef: 'https://cloud.example.org/f/42' })
    .where(eq(decks.id, deckId));
  await context.deps.db
    .update(revisions)
    .set({ sourceChangeToken: 'e1' })
    .where(eq(revisions.deckId, deckId));
}

describe('the live editor', () => {
  const style = {
    font: 'Calibri',
    size: 40,
    color: '#123456',
    bold: true,
    italic: false,
    underline: false,
  };

  it('draws a composed slide once, while only a live text changes', async () => {
    const calls: Calls = [];
    const { ctx, deckId } = await odpDeck({ calls });
    calls.length = 0;
    const state = await stateOf(ctx, deckId);
    const title = element(state, 2, (_, role) => role === 'title');
    const composed = async () => {
      const res = await ctx.request(
        `/api/decks/${deckId}/edit/slides/${state.slides[2]!.slideId}/layers`,
        { method: 'POST', json: { compose: true } },
      );
      expect(res.status).toBe(200);
      return (await res.json()) as { background: string };
    };
    const first = await composed();
    expect(calls.length).toBeGreaterThan(0);

    const res = await edit(ctx, deckId, {
      operations: [
        {
          type: 'setRichText',
          elementId: title.id,
          paragraphs: [{ align: 'center', runs: [{ ...style, text: 'Live' }] }],
        },
      ],
    });
    const next = deckEditStateSchema.parse(await res.json());
    expect(element(next, 2, (_, role) => role === 'title').live?.paragraphs[0]).toMatchObject({
      align: 'center',
      runs: [{ ...style, text: 'Live' }],
    });
    // The text changed – the browser draws it – its pictures did not: nothing drawn again.
    calls.length = 0;
    expect((await composed()).background).toBe(first.background);
    expect(calls).toEqual([]);
    // The pictures it was once typed over and its cutouts are no more.
    for (const part of ['background', 'cutout']) {
      const gone = await ctx.request(`/api/decks/${deckId}/edit/elements/${title.id}/${part}`, {
        method: 'POST',
      });
      expect(gone.status).toBe(404);
    }
  });
});

describe('the layers view', () => {
  it('takes a slide apart once per look, and restacks its elements', async () => {
    const calls: Calls = [];
    const { ctx, deckId } = await odpDeck({ calls });
    calls.length = 0;
    const state = await stateOf(ctx, deckId);
    const slide = state.slides[2]!;
    const ids = slide.elements.map((item) => item.id);
    const layers = async () => {
      const res = await ctx.request(`/api/decks/${deckId}/edit/slides/${slide.slideId}/layers`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      return slideLayersSchema.parse(await res.json());
    };

    const first = await layers();
    // The slide without its elements, then each element alone on white and on black.
    expect(calls).toEqual([{ pages: Array.from({ length: 1 + 2 * ids.length }, (_, i) => 3 + i) }]);
    expect(first.seq).toBe(0);
    expect(first.layers.map((layer) => layer.elementId)).toEqual(ids);
    for (const url of [first.background, ...first.layers.map((layer) => layer.url)]) {
      expect(url).not.toBeNull();
      expect((await ctx.request(url!)).status).toBe(200);
    }
    calls.length = 0;
    expect(await layers()).toEqual(first);
    expect(calls).toEqual([]);

    // The first element on top: the slide's order changes – nothing looks other, nothing is drawn.
    const res = await edit(ctx, deckId, {
      operations: [{ type: 'moveElement', elementId: ids[0], to: ids.length - 1 }],
    });
    expect(res.status).toBe(200);
    const next = deckEditStateSchema.parse(await res.json());
    const restacked = [...ids.slice(1), ids[0]];
    expect(next.slides[2]!.elements.map((item) => item.id)).toEqual(restacked);
    calls.length = 0;
    const again = await layers();
    expect(again.seq).toBe(1);
    expect(again.layers.map((layer) => layer.elementId)).toEqual(restacked);
    expect(calls).toEqual([]);
    const byId = (drawn: typeof first) =>
      new Map(drawn.layers.map((layer) => [layer.elementId, layer]));
    expect(byId(again)).toEqual(byId(first));
    expect(again.background).toBe(first.background);

    // One element moved: nothing is drawn – its picture goes where it lies now.
    const moved = next.slides[2]!.elements.find((item) => item.id === ids[0])!;
    const shifted = await edit(ctx, deckId, {
      operations: [
        { type: 'setBox', elementId: moved.id, box: { ...moved.bbox, x: moved.bbox.x + 0.05 } },
      ],
    });
    expect(shifted.status).toBe(200);
    calls.length = 0;
    const fourth = await layers();
    expect(calls).toEqual([]);
    expect(byId(fourth).get(ids[0]!)?.url).toBe(byId(first).get(ids[0]!)?.url);
    expect(byId(fourth).get(ids[0]!)?.box?.x).toBeCloseTo(
      (byId(first).get(ids[0]!)?.box?.x ?? NaN) + 0.05,
    );

    // One element resized: only its two pages are drawn.
    const boxed = await edit(ctx, deckId, {
      operations: [
        {
          type: 'setBox',
          elementId: moved.id,
          box: { ...moved.bbox, x: moved.bbox.x + 0.05, w: moved.bbox.w * 0.9 },
        },
      ],
    });
    expect(boxed.status).toBe(200);
    calls.length = 0;
    const third = await layers();
    const top = 3 + 2 * (ids.length - 1);
    expect(calls).toEqual([{ pages: [top + 1, top + 2] }]);
    expect(third.background).toBe(first.background);
    expect(byId(third).get(ids[1]!)).toEqual(byId(first).get(ids[1]!));

    // For the per-element editor: what the browser draws whole is not drawn (no picture).
    const composed = await ctx.request(`/api/decks/${deckId}/edit/slides/${slide.slideId}/layers`, {
      method: 'POST',
      body: JSON.stringify({ compose: true }),
    });
    expect(composed.status).toBe(200);
    const parts = slideLayersSchema.parse(await composed.json());
    const painted = new Set(slide.elements.filter((item) => item.paint).map((item) => item.id));
    expect(painted.size).toBeGreaterThan(0);
    for (const layer of parts.layers) {
      expect(layer.url === null).toBe(painted.has(layer.elementId));
    }

    const missing = await ctx.request(`/api/decks/${deckId}/edit/slides/nope/layers`, {
      method: 'POST',
    });
    expect(missing.status).toBe(404);
  });
});
