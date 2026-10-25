import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { deckSchema, slideSchema, syncResultSchema, type Slide } from '@slider/shared';
import { comments, slideVersions } from '../src/db/schema';
import { createTestContext, type TestContext } from './helpers';
import { makeSlidesPdf, type PdfPage } from './pdf';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

const ORANGE: [number, number, number] = [255, 107, 61];
const agenda: PdfPage = { texts: [{ text: 'Agenda', x: 80, y: 60, size: 48 }] };
const revenue = (cardY: number): PdfPage => ({
  texts: [
    { text: 'Umsatz stieg um 12 Prozent', x: 80, y: 60, size: 40 },
    { text: 'Vor allem im Norden', x: 80, y: 130, size: 24 },
  ],
  boxes: [{ x: 560, y: cardY, w: 300, h: 180, rgb: ORANGE }],
});
const thanks: PdfPage = { texts: [{ text: 'Danke', x: 380, y: 230, size: 64 }] };

const form = (bytes: Uint8Array<ArrayBuffer>, name = 'Keynote-Export.pdf') => {
  const body = new FormData();
  body.append('file', new File([bytes], name));
  return body;
};

async function slidesOf(context: TestContext, deckId: string): Promise<Slide[]> {
  return slideSchema
    .array()
    .parse(await (await context.request(`/api/decks/${deckId}/slides`)).json());
}

describe('a review deck that came as a PDF', () => {
  it('imports every page as a slide with its picture and its boxes', async () => {
    ctx = await createTestContext();
    const res = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: form(makeSlidesPdf([agenda, revenue(260), thanks])),
    });
    expect(res.status).toBe(201);
    const deck = deckSchema.parse(await res.json());
    await ctx.deps.queue.idle();
    expect(
      deckSchema.parse(await (await ctx.request(`/api/decks/${deck.id}`)).json()),
    ).toMatchObject({ import: { status: 'ready' }, slideCount: 3, title: 'Keynote-Export' });

    const slides = await slidesOf(ctx, deck.id);
    expect(slides.map((slide) => slide.title)).toEqual([
      'Agenda',
      'Umsatz stieg um 12 Prozent',
      'Danke',
    ]);
    expect(slides[0]!.aspectRatio).toBeCloseTo(16 / 9);
    // The page's text blocks and its orange card are boxes for box mode.
    const boxes = slides[1]!.shapes;
    expect(boxes.map((box) => box.text).filter(Boolean)).toEqual([
      'Umsatz stieg um 12 Prozent',
      'Vor allem im Norden',
    ]);
    const card = boxes.find((box) => box.name.startsWith('Fläche'))!;
    expect(card.bbox.x).toBeCloseTo(560 / 960, 2);
    expect(card.bbox.y).toBeCloseTo(260 / 540, 2);

    const rows = await ctx.deps.db
      .select()
      .from(slideVersions)
      .where(eq(slideVersions.slideId, slides[1]!.id));
    expect(rows[0]).toMatchObject({ renderer: 'pdf', pptxSldId: null });
    expect(rows[0]!.imageKey.endsWith('.webp')).toBe(true);
  });

  it("draws a converted file's pages under who made its PDF", async () => {
    const pdf = makeSlidesPdf([agenda, thanks]);
    ctx = await createTestContext({ documentPdf: async () => pdf });
    const res = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: form(new TextEncoder().encode('Agenda\nDanke'), 'Notizen.txt'),
    });
    expect(res.status).toBe(201);
    const deck = deckSchema.parse(await res.json());
    await ctx.deps.queue.idle();
    expect(
      deckSchema.parse(await (await ctx.request(`/api/decks/${deck.id}`)).json()),
    ).toMatchObject({ slideCount: 2, thumbnailRenderer: 'libreoffice' });
  });

  it('knows a converted file again by its original, though each conversion differs', async () => {
    // LibreOffice writes a new date and id into every PDF: no two runs give the same bytes.
    let run = 0;
    ctx = await createTestContext({
      documentPdf: async () =>
        makeSlidesPdf([agenda, { texts: [{ text: `Lauf ${++run}`, x: 80, y: 60, size: 24 }] }]),
    });
    const notes = new TextEncoder().encode('Agenda\nDanke');
    const first = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: form(notes, 'Notizen.txt'),
    });
    expect(first.status).toBe(201);
    const deck = deckSchema.parse(await first.json());
    await ctx.deps.queue.idle();

    const again = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: form(notes, 'Notizen.txt'),
    });
    expect(again.status).toBe(200);
    expect(deckSchema.parse(await again.json()).id).toBe(deck.id);

    const version = await ctx.request(`/api/decks/${deck.id}/revisions`, {
      method: 'POST',
      body: form(notes, 'Notizen.txt'),
    });
    expect(syncResultSchema.parse(await version.json())).toEqual({ status: 'unchanged' });
  });

  it('matches a new version page by page: slides and box comments stay where they belong', async () => {
    ctx = await createTestContext();
    const created = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: form(makeSlidesPdf([agenda, revenue(260), thanks])),
    });
    const deck = deckSchema.parse(await created.json());
    await ctx.deps.queue.idle();
    const v1 = await slidesOf(ctx, deck.id);
    const card = v1[1]!.shapes.find((box) => box.name.startsWith('Fläche'))!;
    // A comment bound to the card.
    const posted = await ctx.request(`/api/decks/${deck.id}/comments`, {
      method: 'POST',
      json: {
        slideId: v1[1]!.id,
        body: 'Die Karte ist zu laut.',
        anchor: {
          type: 'rect',
          rect: card.bbox,
          shapeRef: {
            shapeId: card.id,
            offset: { x: 0.5, y: 0.5 },
            size: { w: 1, h: 1 },
            name: card.name,
            bbox: card.bbox,
          },
        },
      },
    });
    expect(posted.status).toBe(201);

    // v2: a page in front, the card moved down a little.
    const intro: PdfPage = { texts: [{ text: 'Neu: Kurzfassung', x: 80, y: 60, size: 48 }] };
    const res = await ctx.request(`/api/decks/${deck.id}/revisions`, {
      method: 'POST',
      body: form(makeSlidesPdf([intro, agenda, revenue(300), thanks])),
    });
    expect(syncResultSchema.parse(await res.json())).toMatchObject({ status: 'updated' });
    const v2 = await slidesOf(ctx, deck.id);
    expect(v2).toHaveLength(4);
    // The pages that were there keep their slides (and with them their comments).
    expect(v2.slice(1).map((slide) => slide.id)).toEqual(v1.map((slide) => slide.id));
    expect(v1.map((slide) => slide.id)).not.toContain(v2[0]!.id);
    // The card keeps its box id, so the comment stays bound to it where it now is.
    const moved = v2[2]!.shapes.find((box) => box.id === card.id)!;
    expect(moved.name).toBe(card.name);
    expect(moved.bbox.y).toBeCloseTo(300 / 540, 2);
    const [comment] = await ctx.deps.db.select().from(comments).where(eq(comments.deckId, deck.id));
    expect(comment!.slideId).toBe(v1[1]!.id);
  });

  it('keeps a deck what it came as, and refuses a file named .pdf that is none', async () => {
    ctx = await createTestContext();
    const created = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: form(makeSlidesPdf([agenda])),
    });
    const deck = deckSchema.parse(await created.json());
    await ctx.deps.queue.idle();
    const pptx = await ctx.request(`/api/decks/${deck.id}/revisions`, {
      method: 'POST',
      body: form(new Uint8Array([80, 75, 3, 4, 1]), 'Deck.pptx'),
    });
    expect(pptx.status).toBe(400);
    expect(await pptx.text()).toContain('als PDF');
    const fake = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: form(new TextEncoder().encode('PK not a pdf'), 'x.pdf'),
    });
    expect(fake.status).toBe(400);
  });
});
