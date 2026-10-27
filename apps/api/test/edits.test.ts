import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { OdpDocument } from '@slider/odp';
import {
  deckEditStateSchema,
  deckSchema,
  slideLayersSchema,
  slideSchema,
  uploadedEditImageSchema,
  type DeckEditState,
  type Slide,
} from '@slider/shared';
import { deckEdits, decks, revisions } from '../src/db/schema';
import { sweepOldEditImages } from '../src/services/old-edit-images';
import { UNLIMITED_PLAN } from '../src/services/plans';
import { DAY_MS } from '../src/services/retention-rules';
import { totalBytes, workspaceStorageUsage } from '../src/services/workspace-storage';
import type { NextcloudAdapter } from '../src/sources/nextcloud';
import type { RemoteFile } from '../src/sources/source-adapter';
import { createTestContext, signedInUser, type TestContext } from './helpers';
import { DEMO_ODP, fakeOdpPdf, odpForm } from './odp-helpers';
import { makeSlidesPdf } from './pdf';

/* Editing an ODP deck in Slider (BER-180, BER-181, BER-182). */

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

type Calls = { pages: readonly number[] | null }[];

async function odpDeck(options: { calls?: Calls; nextcloud?: FakeNextcloud } = {}) {
  ctx = await createTestContext({
    libreOfficePdf: fakeOdpPdf(options.calls),
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

async function edit(context: TestContext, deckId: string, body: unknown) {
  return context.request(`/api/decks/${deckId}/edit/operations`, { method: 'POST', json: body });
}

describe('editing an ODP deck', () => {
  it('shows its slides with their elements, editable by who manages it', async () => {
    const { ctx, deckId } = await odpDeck();
    const state = await stateOf(ctx, deckId);
    expect(state).toMatchObject({
      editable: true,
      seq: 0,
      canUndo: false,
      canRedo: false,
      unsaved: false,
    });
    expect(state.slides).toHaveLength(6);
    const slides = await slidesOf(ctx, deckId);
    expect(state.slides.map((slide) => slide.slideId)).toEqual(slides.map((slide) => slide.id));
    expect(element(state, 2, (name) => name === 'Hinweis').paragraphs).toEqual([
      'Planwerte vorbehaltlich der Budgetfreigabe im Oktober.',
    ]);

    const { cookie } = await signedInUser(ctx, { name: 'Gesa', email: 'gesa@example.org' });
    expect((await ctx.request(`/api/decks/${deckId}/edit`, { cookie })).status).toBe(404);
  });

  it('changes text, draws only that slide again, and undoes and redoes it', async () => {
    const calls: Calls = [];
    const { ctx, deckId } = await odpDeck({ calls });
    const before = await slidesOf(ctx, deckId);
    const state = await stateOf(ctx, deckId);
    const title = element(state, 2, (_, role) => role === 'title');
    calls.length = 0;

    const res = await edit(ctx, deckId, {
      baseSeq: 0,
      operations: [{ type: 'setText', elementId: title.id, paragraphs: ['Umsatz 2026'] }],
    });
    expect(res.status).toBe(200);
    expect(deckEditStateSchema.parse(await res.json())).toMatchObject({
      seq: 1,
      canUndo: true,
      unsaved: true,
    });
    // Slide 3 is the third visible slide: only its page was drawn.
    expect(calls).toEqual([{ pages: [3] }]);
    const after = await slidesOf(ctx, deckId);
    expect(after[2]!.title).toBe('Umsatz 2026');
    expect(after[2]!.imageUrl).not.toBe(before[2]!.imageUrl);
    expect(after[0]!.imageUrl.split('?')[0]).toBe(before[0]!.imageUrl.split('?')[0]);

    const undone = await ctx.request(`/api/decks/${deckId}/edit/undo`, { method: 'POST' });
    expect(deckEditStateSchema.parse(await undone.json())).toMatchObject({
      seq: 0,
      canUndo: false,
      canRedo: true,
    });
    expect((await slidesOf(ctx, deckId))[2]!.title).toBe('Umsatz nach Region');

    const redone = await ctx.request(`/api/decks/${deckId}/edit/redo`, { method: 'POST' });
    expect(deckEditStateSchema.parse(await redone.json())).toMatchObject({
      seq: 1,
      canRedo: false,
    });
    expect((await slidesOf(ctx, deckId))[2]!.title).toBe('Umsatz 2026');
  });

  it('drops the steps to redo with a new edit, and refuses an edit on an older step', async () => {
    const { ctx, deckId } = await odpDeck();
    const state = await stateOf(ctx, deckId);
    const note = element(state, 2, (name) => name === 'Hinweis');
    await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: note.id, paragraphs: ['A'] }],
    });
    await ctx.request(`/api/decks/${deckId}/edit/undo`, { method: 'POST' });
    await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: note.id, paragraphs: ['B'] }],
    });
    const steps = await ctx.deps.db.select().from(deckEdits);
    expect(steps.map((step) => step.seq).sort()).toEqual([0, 1]);
    expect((await stateOf(ctx, deckId)).canRedo).toBe(false);

    const stale = await edit(ctx, deckId, {
      baseSeq: 0,
      operations: [{ type: 'setText', elementId: note.id, paragraphs: ['C'] }],
    });
    expect(stale.status).toBe(409);
    const wrong = await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: 'nope', paragraphs: ['C'] }],
    });
    expect(wrong.status).toBe(400);
  });

  it('moves an element and swaps a picture for an uploaded one', async () => {
    const { ctx, deckId } = await odpDeck();
    const state = await stateOf(ctx, deckId);
    const picture = element(state, 3, (name) => name === 'Roadmap Visual');

    const png = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwH4QZYAwAQdQH+UW2eecAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const body = new FormData();
    body.append('file', new File([png], 'neu.png'));
    const uploaded = await ctx.request(`/api/decks/${deckId}/edit/images`, {
      method: 'POST',
      body,
    });
    expect(uploaded.status).toBe(201);
    const image = uploadedEditImageSchema.parse(await uploaded.json());
    expect(image).toMatchObject({ width: 2, height: 1 });

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

    const notAnImage = new FormData();
    notAnImage.append('file', new File([new TextEncoder().encode('hallo')], 'x.png'));
    expect(
      (await ctx.request(`/api/decks/${deckId}/edit/images`, { method: 'POST', body: notAnImage }))
        .status,
    ).toBe(400);
  });

  it('counts an uploaded picture against the workspace’s storage, and refuses it when full', async () => {
    const { ctx, deckId } = await odpDeck();
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

    const before = await used();
    expect((await upload()).status).toBe(201);
    expect(await used()).toBe(before + png.byteLength);

    ctx.deps.config.plans.free = { ...UNLIMITED_PLAN, maxStorageBytes: await used() };
    expect((await upload()).status).toBe(403);
    expect(await listed()).toBe(1);
    expect(await used()).toBe(before + png.byteLength);
  });

  it('removes editor pictures after 7 days, and no longer counts them', async () => {
    const { ctx, deckId } = await odpDeck();
    const state = await stateOf(ctx, deckId);
    const picture = element(state, 3, (name) => name === 'Roadmap Visual');
    const png = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwH4QZYAwAQdQH+UW2eecAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const body = new FormData();
    body.append('file', new File([png], 'neu.png'));
    const uploaded = await ctx.request(`/api/decks/${deckId}/edit/images`, {
      method: 'POST',
      body,
    });
    const image = uploadedEditImageSchema.parse(await uploaded.json());
    const used = async () => totalBytes(await workspaceStorageUsage(ctx.deps.db, ctx.workspaceId));
    const listed = async () => (await ctx.deps.storage.list(`decks/${deckId}/edit-images/`)).length;
    const withPicture = await used();

    ctx.clock.advance(6 * DAY_MS);
    await sweepOldEditImages(ctx.deps);
    expect(await listed()).toBe(1);

    ctx.clock.advance(2 * DAY_MS);
    await sweepOldEditImages(ctx.deps);
    expect(await listed()).toBe(0);
    expect(await used()).toBe(withPicture - png.byteLength);
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
  });

  it('hides, moves and deletes slides – each stays the slide it was, and comes back on undo', async () => {
    const calls: Calls = [];
    const { ctx, deckId } = await odpDeck({ calls });
    const before = await slidesOf(ctx, deckId);
    const ids = before.map((slide) => slide.id);
    calls.length = 0;

    const hide = await edit(ctx, deckId, {
      baseSeq: 0,
      operations: [{ type: 'setSlideHidden', slideIndex: 1, hidden: true }],
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
      baseSeq: 1,
      operations: [{ type: 'moveSlide', slideIndex: 0, to: 2 }],
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
      baseSeq: 2,
      operations: [{ type: 'deleteSlide', slideIndex: 2 }],
    });
    expect(deleted.status).toBe(200);
    const state = deckEditStateSchema.parse(await deleted.json());
    expect(state.slides.map((slide) => slide.slideId)).toEqual([ids[1], ids[2], ...ids.slice(3)]);

    await ctx.request(`/api/decks/${deckId}/edit/undo`, { method: 'POST' });
    expect((await slidesOf(ctx, deckId)).map((slide) => slide.id)).toEqual([
      ids[1],
      ids[2],
      ids[0],
      ...ids.slice(3),
    ]);
  });

  it('is not offered for other decks', async () => {
    ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf() });
    const body = new FormData();
    body.append(
      'file',
      new File([makeSlidesPdf([{ texts: [{ text: 'A', x: 80, y: 60, size: 40 }] }])], 'A.pdf'),
    );
    const deck = deckSchema.parse(
      await (await ctx.request('/api/decks/upload', { method: 'POST', body })).json(),
    );
    await ctx.deps.queue.idle();
    const state = await stateOf(ctx, deck.id);
    expect(state).toMatchObject({ editable: false, reason: expect.stringContaining('ODP') });
    const res = await edit(ctx, deck.id, {
      operations: [{ type: 'deleteElement', elementId: 't1' }],
    });
    expect(res.status).toBe(409);
  });
});

/** Nextcloud as far as saving and syncing an edited deck go. */
class FakeNextcloud {
  etag = 'e1';
  uploads: { ifMatch: string | null; bytes: Uint8Array }[] = [];

  async getChangeToken(): Promise<string> {
    return this.etag;
  }

  async download(): Promise<Uint8Array> {
    return DEMO_ODP;
  }

  async resolve(): Promise<RemoteFile> {
    throw new Error('not used');
  }

  async upload(
    _file: RemoteFile,
    bytes: Uint8Array,
    _type: string,
    ifMatch: string | null,
  ): Promise<string | null> {
    this.uploads.push({ ifMatch, bytes });
    if (ifMatch !== null && ifMatch !== this.etag) return null;
    this.etag = `e${this.uploads.length + 1}`;
    return this.etag;
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

describe('saving to Nextcloud', () => {
  it('saves over the file, unless it changed there – then only when asked', async () => {
    const nextcloud = new FakeNextcloud();
    const { ctx, deckId } = await odpDeck({ nextcloud });
    await linkToNextcloud(ctx, deckId);
    const state = await stateOf(ctx, deckId);
    expect(state.saveTarget).toBe('nextcloud');
    const note = element(state, 2, (name) => name === 'Hinweis');
    await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: note.id, paragraphs: ['Neu'] }],
    });

    const saved = await ctx.request(`/api/decks/${deckId}/edit/save`, { method: 'POST', json: {} });
    expect(deckEditStateSchema.parse(await saved.json())).toMatchObject({ unsaved: false });
    expect(nextcloud.uploads[0]!.ifMatch).toBe('e1');
    const written = await OdpDocument.open(nextcloud.uploads[0]!.bytes);
    expect(written.slides()[2]!.elements.find((item) => item.id === note.id)!.paragraphs).toEqual([
      'Neu',
    ]);

    // Someone saves in Nextcloud meanwhile.
    await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: note.id, paragraphs: ['Noch neuer'] }],
    });
    nextcloud.etag = 'someone-else';
    const conflict = await ctx.request(`/api/decks/${deckId}/edit/save`, {
      method: 'POST',
      json: {},
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: 'edit_conflict' } });
    const forced = await ctx.request(`/api/decks/${deckId}/edit/save`, {
      method: 'POST',
      json: { overwrite: true },
    });
    expect(forced.status).toBe(200);
    expect(nextcloud.uploads.at(-1)!.ifMatch).toBeNull();
  });

  it('does not import a new version from the cloud over edits not saved yet', async () => {
    const nextcloud = new FakeNextcloud();
    const { ctx, deckId } = await odpDeck({ nextcloud });
    await linkToNextcloud(ctx, deckId);
    const note = element(await stateOf(ctx, deckId), 2, (name) => name === 'Hinweis');
    await edit(ctx, deckId, {
      operations: [{ type: 'setText', elementId: note.id, paragraphs: ['Neu'] }],
    });

    nextcloud.etag = 'changed-in-cloud';
    expect(await ctx.deps.sync.checkDeck(deckId, { manual: true })).toEqual({
      status: 'unchanged',
    });
    expect(
      await ctx.deps.db.select().from(revisions).where(eq(revisions.deckId, deckId)),
    ).toHaveLength(1);
    expect((await stateOf(ctx, deckId)).changedInCloud).toBe(true);
  });
});

describe('the live editor', () => {
  const style = {
    font: 'Calibri',
    size: 40,
    color: '#123456',
    bold: true,
    italic: false,
    underline: false,
  };

  it('tells the slide size and which texts can be typed on the slide', async () => {
    const { ctx, deckId } = await odpDeck();
    const state = await stateOf(ctx, deckId);
    expect(state.pageSize.width).toBeCloseTo(33.867, 2);
    expect(element(state, 2, (_, role) => role === 'title').live).not.toBeNull();
    expect(element(state, 2, (name) => name === 'Tabelle Umsatz').live).toBeNull();
  });

  it('draws the picture a text is typed over once, while only the text changes', async () => {
    const calls: Calls = [];
    const { ctx, deckId } = await odpDeck({ calls });
    calls.length = 0;
    const state = await stateOf(ctx, deckId);
    const title = element(state, 2, (_, role) => role === 'title');
    const background = async (elementId: string) =>
      ctx.request(`/api/decks/${deckId}/edit/elements/${elementId}/background`, {
        method: 'POST',
      });
    const first = await background(title.id);
    expect(first.status).toBe(200);
    const { url } = (await first.json()) as { url: string };
    // The third slide: LibreOffice's page range counts the hidden one too.
    expect(calls).toEqual([{ pages: [3] }]);

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
    // The text changed (its slide is drawn anew), its picture did not: not drawn again.
    calls.length = 0;
    expect(await (await background(title.id)).json()).toEqual({ url });
    expect(calls).toEqual([]);

    const table = element(state, 2, (name) => name === 'Tabelle Umsatz');
    expect((await background(table.id)).status).toBe(400);
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

    // One element moved: only its two pages are drawn.
    const moved = next.slides[2]!.elements.find((item) => item.id === ids[0])!;
    const boxed = await edit(ctx, deckId, {
      operations: [
        { type: 'setBox', elementId: moved.id, box: { ...moved.bbox, x: moved.bbox.x + 0.05 } },
      ],
    });
    expect(boxed.status).toBe(200);
    calls.length = 0;
    const third = await layers();
    const top = 3 + 2 * (ids.length - 1);
    expect(calls).toEqual([{ pages: [top + 1, top + 2] }]);
    expect(third.background).toBe(first.background);
    expect(byId(third).get(ids[1]!)).toEqual(byId(first).get(ids[1]!));

    const missing = await ctx.request(`/api/decks/${deckId}/edit/slides/nope/layers`, {
      method: 'POST',
    });
    expect(missing.status).toBe(404);
  });
});
