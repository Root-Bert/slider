import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { OdpDocument, isOdpBytes } from '@slider/odp';
import { deckSchema, slideSchema, type Slide } from '@slider/shared';
import {
  cloudNodes,
  cloudVersions,
  revisions,
  slideVersions,
  workspaceFonts,
} from '../src/db/schema';
import { createLibreOfficePdf, findSoffice, type PptxToPdf } from '../src/import/libreoffice';
import { blobKeys } from '../src/storage/blob-storage';
import { createTestContext, type TestContext } from './helpers';
import { DEMO_ODP, fakeOdpPdf, odpForm } from './odp-helpers';
import { makeSlidesPdf } from './pdf';

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
  it('is imported as it is, starts empty with one blank slide, and an ODF file that is no presentation is refused', async () => {
    {
      ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf() });
      const res = await ctx.request('/api/decks/upload', {
        method: 'POST',
        body: odpForm(DEMO_ODP),
      });
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
      expect(slides.map((slide) => slide.hidden)).toEqual([
        false,
        false,
        false,
        false,
        true,
        false,
      ]);
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
    }
    {
      await ctx?.cleanup();
      ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf() });
      const create = () =>
        ctx!.request('/api/decks/blank', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
      const res = await create();
      expect(res.status).toBe(201);
      const deck = deckSchema.parse(await res.json());
      expect(deck.title).toBe('Neue Präsentation');
      // Drawn ahead (`BlankDecks`): ready at once, its slide in, nothing imported.
      expect(deck.import.status).toBe('ready');
      expect(deck.slideCount).toBe(1);
      const slidesRes = await ctx.request(`/api/decks/${deck.id}/slides`);
      expect(slidesRes.status).toBe(200);

      const [revision] = await ctx.deps.db
        .select()
        .from(revisions)
        .where(eq(revisions.deckId, deck.id));
      expect(revision!.pptxKey).toMatch(/\.odp$/);
      const document = await OdpDocument.open((await ctx.deps.storage.get(revision!.pptxKey!))!);
      expect(document.slides()).toHaveLength(1);
      expect(document.slides()[0]!.elements).toEqual([]);

      // Not "the same file uploaded before": the second one is a deck of its own.
      const again = await create();
      expect(again.status).toBe(201);
      expect(deckSchema.parse(await again.json()).id).not.toBe(deck.id);
    }
    {
      await ctx?.cleanup();
      ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf() });
      const res = await ctx.request('/api/decks/upload', {
        method: 'POST',
        body: odpForm(new TextEncoder().encode('kein zip'), 'Kaputt.odp'),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('nicht lesen');
    }
    // A file Cloud drew already opens on those pictures until LibreOffice's come (here it
    // fails, so they stay); pages that do not fit the visible slides leave the SVG previews.
    // Cloud draws it as its deck is drawn (the workspace's fonts, LibreOffice's table); one
    // drawn the old way is drawn anew when listed – its small picture with it – and opens on
    // that one.
    for (const cloudPages of [5, 4]) {
      await ctx?.cleanup();
      const broken = async () => {
        throw new Error('LibreOffice fehlt');
      };
      const pdfOf = (pages: number) =>
        makeSlidesPdf(
          Array.from({ length: pages }, (_, i) => ({
            texts: [{ text: `Cloud ${i + 1}`, x: 80, y: 60, size: 40 }],
          })),
        );
      const drawn: { kind: string; fonts: unknown; priority?: string }[] = [];
      let unreadable = false;
      ctx = await createTestContext({
        libreOfficePdf: Object.assign(broken, { pages: broken }) as PptxToPdf,
        materialPdf: async (_bytes, kind, options) => {
          drawn.push({ kind, fonts: options?.fonts, priority: options?.priority });
          return unreadable ? new Uint8Array([1, 2, 3]) : pdfOf(cloudPages);
        },
      });
      const query = new URLSearchParams({ name: 'Strategie.odp' });
      const up = await ctx.request(`/api/workspaces/${ctx.workspaceId}/cloud/files?${query}`, {
        method: 'POST',
        body: DEMO_ODP,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      expect(up.status).toBe(201);
      const { node } = (await up.json()) as { node: { id: string } };
      await ctx.deps.background?.idle();
      const [version] = await ctx.deps.db
        .select()
        .from(cloudVersions)
        .where(eq(cloudVersions.nodeId, node.id));
      expect(version!.preview).toBe('ready');
      expect(drawn.splice(0)).toEqual([{ kind: 'odp', fonts: [], priority: 'background' }]);
      // As drawn before: in the pool, unmarked.
      await ctx.deps.storage.delete(
        blobKeys.cloudPreviewAsDeck(ctx.workspaceId, node.id, version!.id),
      );
      await ctx.deps.storage.put(
        blobKeys.cloudPreview(ctx.workspaceId, node.id, version!.id),
        pdfOf(9 - cloudPages),
      );
      await ctx.deps.storage.put(
        blobKeys.cloudThumbnail(ctx.workspaceId, node.id, version!.id),
        new Uint8Array([1, 2, 3]),
      );
      const picture = `/api/cloud/nodes/${node.id}/thumbnail?v=${version!.id}`;
      const before = (await ctx.request(picture)).headers.get('ETag')!;
      const list = `/api/workspaces/${ctx.workspaceId}/cloud/nodes?scope=folder`;
      expect((await ctx.request(list)).status).toBe(200);
      await ctx.deps.background?.idle();
      expect(drawn.splice(0)).toEqual([{ kind: 'odp', fonts: [], priority: 'background' }]);
      const after = await ctx.request(picture, { headers: { 'If-None-Match': before } });
      expect(after.status).toBe(200);
      expect(after.headers.get('ETag')).not.toBe(before);
      // Once: listed again, nothing is drawn.
      await ctx.request(list);
      await ctx.deps.background?.idle();
      expect(drawn).toEqual([]);
      // A workspace font it names, added later, has it drawn anew once; one it does not name not.
      // A PDF drawn anew whose first page cannot be drawn changes nothing.
      const thumbnailNow = async () =>
        (await ctx!.deps.db.select().from(cloudNodes).where(eq(cloudNodes.id, node.id)))[0]!
          .thumbnail;
      const kept = blobKeys.cloudThumbnail(ctx.workspaceId, node.id, version!.id);
      for (const [id, family] of [
        ['font-other', 'Abril Fatface'],
        ['font-named', 'Calibri Light'],
        ['font-unreadable', 'Calibri'],
      ] as const) {
        unreadable = id === 'font-unreadable';
        if (unreadable) await ctx.deps.storage.put(kept, new Uint8Array([9, 9, 9]));
        await ctx.deps.db.insert(workspaceFonts).values({
          id,
          workspaceId: ctx.workspaceId,
          family,
          weight: 400,
          italic: false,
          format: 'ttf',
          sizeBytes: 1,
          upm: 1000,
          ascent: 800,
          descent: -200,
          storageKey: `fonts/${id}.ttf`,
        });
        await ctx.request(list);
        await ctx.deps.background?.idle();
        expect(drawn.splice(0)).toEqual(
          id === 'font-other' ? [] : [{ kind: 'odp', fonts: [], priority: 'background' }],
        );
        expect(await thumbnailNow()).toBe('ready');
      }
      expect([...((await ctx.deps.storage.get(kept)) ?? [])]).toEqual([9, 9, 9]);
      unreadable = false;
      await ctx.request(list);
      await ctx.deps.background?.idle();
      expect(drawn).toEqual([]);
      // A file without a small picture gets one when listed – not while it was just changed (a
      // Writer document typed in saves anew).
      for (const ago of [0, 120_000]) {
        await ctx.deps.db
          .update(cloudNodes)
          .set({ thumbnail: 'none', updatedAt: new Date(ctx.deps.clock.now().getTime() - ago) })
          .where(eq(cloudNodes.id, node.id));
        await ctx.request(list);
        await ctx.deps.background?.idle();
        expect(await thumbnailNow()).toBe(ago ? 'ready' : 'none');
      }
      expect(drawn).toEqual([]);
      const opened = await ctx.request(`/api/cloud/nodes/${node.id}/present`, { method: 'POST' });
      expect(opened.status).toBe(201);
      const deck = deckSchema.parse(await opened.json());
      await ctx.deps.queue.idle();
      const rows = await ctx.deps.db
        .select()
        .from(slideVersions)
        .innerJoin(revisions, eq(revisions.id, slideVersions.revisionId))
        .where(eq(revisions.deckId, deck.id))
        .orderBy(asc(slideVersions.position));
      const kinds = rows.map(({ slide_versions: row }) => row.imageKey.split('.').pop());
      expect(kinds).toEqual(
        cloudPages === 5
          ? ['webp', 'webp', 'webp', 'webp', 'svg', 'webp'] // the hidden one has no page
          : ['svg', 'svg', 'svg', 'svg', 'svg', 'svg'],
      );
      // The `fresh` re-render ran (and found no better renderer).
      expect(rows.map(({ slide_versions: row }) => row.renderer)).toEqual(Array(6).fill('svg'));
    }
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
