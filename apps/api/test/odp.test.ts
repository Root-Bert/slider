import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { OdpDocument, isOdpBytes } from '@slider/odp';
import { deckSchema, slideSchema, type Slide } from '@slider/shared';
import { revisions } from '../src/db/schema';
import { createLibreOfficePdf, findSoffice } from '../src/import/libreoffice';
import { createTestContext, type TestContext } from './helpers';
import { DEMO_ODP, fakeOdpPdf, odpForm } from './odp-helpers';

/*
 * ODP decks (BER-177): imported as they are – an ODP that stays an ODP – with ids on every
 * element, its elements as boxes, its pictures by LibreOffice.
 */

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

async function slidesOf(context: TestContext, deckId: string): Promise<Slide[]> {
  return slideSchema
    .array()
    .parse(await (await context.request(`/api/decks/${deckId}/slides`)).json());
}

describe('an ODP deck', () => {
  it('is imported as an ODP: slides, hidden ones, boxes with ids, pictures by LibreOffice', async () => {
    ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf() });
    const res = await ctx.request('/api/decks/upload', { method: 'POST', body: odpForm(DEMO_ODP) });
    expect(res.status).toBe(201);
    const deck = deckSchema.parse(await res.json());
    await ctx.deps.queue.idle();
    expect(
      deckSchema.parse(await (await ctx.request(`/api/decks/${deck.id}`)).json()),
    ).toMatchObject({
      import: { status: 'ready' },
      slideCount: 5,
      thumbnailRenderer: 'libreoffice',
    }); // visible ones

    const slides = await slidesOf(ctx, deck.id);
    expect(slides.map((slide) => slide.title)).toEqual([
      'Q4 Strategie 2026',
      'Agenda',
      'Umsatz nach Region',
      'Produkt-Roadmap',
      expect.stringContaining('Backup'),
      'Vielen Dank',
    ]);
    expect(slides.map((slide) => slide.hidden)).toEqual([false, false, false, false, true, false]);
    const note = slides[2]!.shapes.find((shape) => shape.name === 'Hinweis')!;
    expect(note.id).toMatch(/^sl\d+$/);
    expect(note.text).toContain('Budgetfreigabe');

    // Stored as an ODP with the ids, so the editor and the boxes name the same elements.
    const [revision] = await ctx.deps.db
      .select()
      .from(revisions)
      .where(eq(revisions.deckId, deck.id));
    expect(revision!.pptxKey).toMatch(/\.odp$/);
    const stored = await ctx.deps.storage.get(revision!.pptxKey!);
    expect(isOdpBytes(stored!)).toBe(true);
    const document = await OdpDocument.open(stored!);
    expect(document.slides()[2]!.elements.map((element) => element.id)).toContain(note.id);
  });

  it('refuses an ODF file that is no presentation', async () => {
    ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf() });
    const res = await ctx.request('/api/decks/upload', {
      method: 'POST',
      body: odpForm(new TextEncoder().encode('kein zip'), 'Kaputt.odp'),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('nicht lesen');
  });
});

describe('LibreOffice and ODP', () => {
  it('draws all visible slides, or only the pages asked for', async () => {
    const binary = await findSoffice();
    if (!binary) return;
    const log = { info() {}, warn() {}, error() {}, debug() {} } as never;
    const toPdf = createLibreOfficePdf({ binary, log });
    const all = new TextDecoder('latin1').decode(await toPdf(DEMO_ODP));
    expect(all.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(5);
    const some = new TextDecoder('latin1').decode(await toPdf.pages!(DEMO_ODP, [2, 4]));
    expect(some.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(2);
  }, 60_000);
});
