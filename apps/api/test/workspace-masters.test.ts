import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import JSZip from 'jszip';
import { expect, it } from 'vitest';
import { OdpDocument, OTP_MIME } from '@slider/odp';
import {
  deckSchema,
  layoutGuidesOf,
  withLayoutGuides,
  type DeckEditState,
  type DeckLayouts,
  type WorkspaceMaster,
} from '@slider/shared';
import {
  decks,
  revisions,
  slideVersions,
  workspaceMasters,
  workspaceMembers,
  workspaces,
} from '../src/db/schema';
import type { PptxToPdf } from '../src/import/libreoffice';
import { odpLayoutName } from '../src/import/master-deck';
import { deckDesign } from '../src/services/ai-context';
import { DEMO_ODP, fakeOdpPdf, odpForm } from './odp-helpers';
import { createTestContext, signedInUser } from './helpers';
import { makeSlidesPdf } from './pdf';

const DEMO_PPTX = new Uint8Array(
  readFileSync(new URL('../../../packages/pptx/samples/slider-demo.pptx', import.meta.url)),
);

/** The demo deck as PowerPoint saves it as a template (`.potx`). */
async function demoTemplate(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(DEMO_PPTX);
  const types = await zip.file('[Content_Types].xml')!.async('string');
  zip.file(
    '[Content_Types].xml',
    types.replace('presentationml.presentation.main+xml', 'presentationml.template.main+xml'),
  );
  return zip.generateAsync({ type: 'uint8array' });
}

/** The demo ODP as LibreOffice saves it as a template (`.otp`). */
async function odpTemplate(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(DEMO_ODP);
  zip.file('mimetype', 'application/vnd.oasis.opendocument.presentation-template', {
    compression: 'STORE',
  });
  const manifest = await zip.file('META-INF/manifest.xml')!.async('string');
  zip.file(
    'META-INF/manifest.xml',
    manifest.replace(
      'manifest:media-type="application/vnd.oasis.opendocument.presentation"/>',
      'manifest:media-type="application/vnd.oasis.opendocument.presentation-template"/>',
    ),
  );
  return zip.generateAsync({ type: 'uint8array' });
}

/** A layout grid set in a template being designed. */
const GRID = {
  columns: { count: 12, gutter: 1, margin: 0.5 },
  rows: { count: 1, gutter: 0, margin: 0.5 },
};

const form = (bytes: Uint8Array, name: string) => {
  const body = new FormData();
  body.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name));
  return body;
};

it('reads a template’s layouts under their own names, draws master pages with LibreOffice and keeps the file as a template', async () => {
  {
    const ctx = await createTestContext();
    try {
      const response = await ctx.request(`/api/workspaces/${ctx.workspaceId}/masters`, {
        method: 'POST',
        body: form(await demoTemplate(), 'Firmendesign 2026.potx'),
      });
      expect(response.status).toBe(200);
      const [master] = (await response.json()) as WorkspaceMaster[];
      expect(master).toMatchObject({ name: 'Firmendesign 2026', format: 'pptx' });
      expect(master!.layouts.map((layout) => [layout.master, layout.name])).toEqual([
        ['Slider', 'Title Slide'],
        ['Slider', 'Title and Content'],
      ]);
      expect(master!.aspectRatio).toBeCloseTo(16 / 9);

      // Without LibreOffice: Slider's own preview, placeholders filled in.
      const [row] = await ctx.deps.db.select().from(workspaceMasters);
      const picture = new TextDecoder().decode(
        (await ctx.deps.storage.get(row!.layouts[0]!.imageKey))!,
      );
      expect(picture).toContain('Titel');
      expect(picture).toContain('Untertitel');
      const file = await JSZip.loadAsync((await ctx.deps.storage.get(row!.fileKey))!);
      expect(await file.file('[Content_Types].xml')!.async('string')).toContain(
        'presentationml.template.main+xml',
      );
      expect(row!.fileKey).toMatch(/\.potx$/);
      expect(master!.fileExtension).toBe('potx');
      expect(row!.sizeBytes).toBeGreaterThan(DEMO_PPTX.byteLength / 2);

      const listed = await ctx.request(`/api/workspaces/${ctx.workspaceId}/masters`);
      expect(((await listed.json()) as WorkspaceMaster[]).map((item) => item.id)).toEqual([
        master!.id,
      ]);
    } finally {
      await ctx.cleanup();
    }
  }
  {
    const drawn: Uint8Array[] = [];
    const libreOfficePdf: PptxToPdf = async (deck) => {
      drawn.push(deck);
      return makeSlidesPdf([{ texts: [{ text: 'Titel', x: 80, y: 60, size: 40 }] }, { texts: [] }]);
    };
    const ctx = await createTestContext({ libreOfficePdf });
    try {
      const response = await ctx.request(`/api/workspaces/${ctx.workspaceId}/masters`, {
        method: 'POST',
        body: form(await odpTemplate(), 'Hausdesign.otp'),
      });
      expect(response.status).toBe(200);
      const [master] = (await response.json()) as WorkspaceMaster[];
      expect(master).toMatchObject({ name: 'Hausdesign', format: 'odp', fileExtension: 'otp' });
      // Kept as the template it is; LibreOffice draws a presentation made of it.
      const [row] = await ctx.deps.db.select().from(workspaceMasters);
      expect(row!.fileKey).toMatch(/\.otp$/);
      expect(
        (await OdpDocument.open((await ctx.deps.storage.get(row!.fileKey))!)).isTemplate(),
      ).toBe(true);
      expect((await OdpDocument.open(drawn[0]!)).isTemplate()).toBe(false);
      expect(master!.layouts.map((layout) => layout.name)).toEqual([
        'Title Slide',
        'Title and Content',
      ]);
      expect(master!.layouts[0]!.imageUrl).toMatch(/\.webp\?/);
      // The deck LibreOffice drew: one page per master page, none of the file's own slides.
      const content = await (await JSZip.loadAsync(drawn[0]!)).file('content.xml')!.async('string');
      expect(
        [...content.matchAll(/<draw:page [^>]*draw:name="([^"]*)"/g)].map((m) => m[1]),
      ).toEqual(['slider-master-1', 'slider-master-2']);
    } finally {
      await ctx.cleanup();
    }
  }
  {
    const name = (style: string, displayName: string | null = null) =>
      odpLayoutName({ name: style, displayName, placeholders: [] });
    expect(name('Master1-Layout41-cust-Statement')).toBe('Statement');
    expect(name('x', 'Master1-Layout3-cust-Title-with-Picture-2')).toBe('Title with Picture 2');
    expect(name('Master1-RetroFormFusion')).toBe('RetroFormFusion');
    expect(name('Title_20_and_20_Content', 'Title and Content')).toBe('Title and Content');
    expect(name('Section_20_Header_20_2')).toBe('Section Header 2');
  }
});

it('refuses files without masters, lets viewers only look and admins remove, and designs templates in the editor', async () => {
  {
    const ctx = await createTestContext();
    try {
      const url = `/api/workspaces/${ctx.workspaceId}/masters`;
      const notADeck = await ctx.request(url, {
        method: 'POST',
        body: form(new TextEncoder().encode('kein Zip'), 'Notizen.pptx'),
      });
      expect(notADeck.status).toBe(400);
      expect(await notADeck.text()).toContain('keine Präsentation oder Vorlage');
      // A presentation brings its slides along: only templates are taken.
      for (const [bytes, name] of [
        [DEMO_ODP, 'Strategie.odp'],
        [DEMO_PPTX, 'Strategie.pptx'],
      ] as const) {
        const presentation = await ctx.request(url, { method: 'POST', body: form(bytes, name) });
        expect(presentation.status).toBe(400);
        expect(await presentation.text()).toContain('Bitte als Vorlage speichern');
      }

      const viewer = await signedInUser(ctx, { name: 'Vera', email: 'vera@example.com' });
      await ctx.deps.db
        .insert(workspaceMembers)
        .values({ workspaceId: ctx.workspaceId, userId: viewer.user.id, role: 'viewer' });
      const refused = await ctx.request(url, {
        method: 'POST',
        cookie: viewer.cookie,
        body: form(await demoTemplate(), 'Design.potx'),
      });
      expect(refused.status).toBe(403);

      const [master] = (await (
        await ctx.request(url, { method: 'POST', body: form(await demoTemplate(), 'Design.potx') })
      ).json()) as WorkspaceMaster[];
      expect((await ctx.request(url, { cookie: viewer.cookie })).status).toBe(200);
      // A viewer opens the pictures, an outsider does not.
      const picture = new URL(master!.layouts[0]!.thumbnailUrl, 'http://localhost');
      const outsider = await signedInUser(ctx, { name: 'Eve', email: 'eve@example.com' });
      ctx.deps.config.auth.devLogin = false;
      expect(
        (await ctx.request(`${picture.pathname}${picture.search}`, { cookie: viewer.cookie }))
          .status,
      ).toBe(200);
      expect(
        (await ctx.request(`${picture.pathname}${picture.search}`, { cookie: outsider.cookie }))
          .status,
      ).toBe(404);
      ctx.deps.config.auth.devLogin = true;

      // Renamed by members and admins: the name in Slider, the file stays.
      const renameBy = (cookie?: string) =>
        ctx.request(`${url}/${master!.id}`, {
          method: 'PATCH',
          json: { name: '  Hausdesign 2026 ' },
          ...(cookie ? { cookie } : {}),
        });
      expect((await renameBy(viewer.cookie)).status).toBe(403);
      const renamed = (await (await renameBy()).json()) as WorkspaceMaster[];
      expect(renamed.map((item) => item.name)).toEqual(['Hausdesign 2026']);

      expect(
        (await ctx.request(`${url}/${master!.id}`, { method: 'DELETE', cookie: viewer.cookie }))
          .status,
      ).toBe(403);
      const [row] = await ctx.deps.db
        .select()
        .from(workspaceMasters)
        .where(eq(workspaceMasters.id, master!.id));
      const removed = await ctx.request(`${url}/${master!.id}`, { method: 'DELETE' });
      expect(await removed.json()).toEqual([]);
      expect(await ctx.deps.storage.get(row!.fileKey)).toBeNull();
      expect(await ctx.deps.storage.get(row!.layouts[0]!.imageKey)).toBeNull();

      // Read and drawn by LibreOffice like an import: designs, drafts and saves share its budget.
      let status = 0;
      for (let i = 0; i < 25 && status !== 429; i++) {
        status = (
          await ctx.request(url, {
            method: 'POST',
            body: form(new TextEncoder().encode('kein Zip'), 'Notizen.pptx'),
          })
        ).status;
      }
      expect(status).toBe(429);
      expect((await ctx.request(`${url}/draft`, { method: 'POST' })).status).toBe(429);
      expect(
        (await ctx.request('/api/decks/any/template/save', { method: 'POST' })).status,
      ).toBe(429);
    } finally {
      await ctx.cleanup();
    }
  }
  {
    const ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf() });
    try {
      const created = await ctx.request(`/api/workspaces/${ctx.workspaceId}/masters/draft`, {
        method: 'POST',
      });
      expect(created.status).toBe(201);
      const draft = deckSchema.parse(await created.json());
      // Named after its workspace until someone names it.
      const [workspace] = await ctx.deps.db
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, ctx.workspaceId));
      expect(draft.title).toBe(`${workspace!.name} Vorlage`);

      // No review: not among the projects, no deck slot.
      const listed = (await (
        await ctx.request(`/api/decks?workspaceId=${ctx.workspaceId}`)
      ).json()) as { id: string }[];
      expect(listed.map((deck) => deck.id)).not.toContain(draft.id);
      // Saved to the library as it is made.
      const [first] = await ctx.deps.db.select().from(workspaceMasters);
      expect(first).toMatchObject({ name: draft.title, draftDeckId: draft.id });
      expect(draft.template?.masterId).toBe(first!.id);

      const [revision] = await ctx.deps.db
        .select()
        .from(revisions)
        .where(eq(revisions.deckId, draft.id));
      const file = await OdpDocument.open((await ctx.deps.storage.get(revision!.pptxKey!))!);
      file.ensureIds();
      const [pageId] = file.pageIds();
      // A picture frame on the layout, marked as where a slide's picture goes.
      const framed = await ctx.request(`/api/decks/${draft.id}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [
            {
              type: 'addImage',
              pageId,
              elementId: 'slpicture1',
              box: { x: 0.5, y: 0.1, w: 0.4, h: 0.8 },
              imageId: null,
            },
            // Text boxes: what is typed in them is what their placeholders ask for – the one in
            // the largest letters the title, a locked one fixed (a footer).
            ...(
              [
                ['slsubtitle', 'Untertitel', 24, 0.4],
                ['sltitle', 'Titel', 40, 0.1],
                ['slfooter', 'Vertraulich', 10, 0.9],
              ] as const
            ).map(([elementId, text, size, y]) => ({
              type: 'addElement' as const,
              pageId,
              elementId,
              kind: 'text' as const,
              box: { x: 0.05, y, w: 0.4, h: 0.08 },
              fill: null,
              stroke: null,
              paragraphs: [
                {
                  align: 'left' as const,
                  runs: [
                    {
                      text,
                      font: 'Inter',
                      size,
                      color: '#000000',
                      bold: false,
                      italic: false,
                      underline: false,
                    },
                  ],
                },
              ],
            })),
            { type: 'setLocked', elementId: 'slfooter', locked: true },
          ],
        },
      });
      expect(framed.status).toBe(200);
      // A second layout.
      const added = await ctx.request(`/api/decks/${draft.id}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [{ type: 'addSlide', like: pageId, newPageId: 'sl-zweites', after: pageId }],
        },
      });
      expect(added.status).toBe(200);
      // Guides as templates from before kept them: shared by every layout.
      const patched = await ctx.request(`/api/decks/${draft.id}/template`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          placeholders: { slpicture1: 'picture' },
          layoutNames: { [pageId!]: 'Titelfolie' },
          guides: [{ orientation: 'vertical', position: 0.1 }],
          colors: [{ color: '#112233', name: 'Primär' }],
          grid: GRID,
        }),
      });
      expect(patched.status).toBe(200);
      // Its own colours are what its pickers offer.
      expect(deckSchema.parse(await patched.json()).colors?.template).toEqual([
        { color: '#112233', name: 'Primär' },
      ]);
      await ctx.request(`/api/decks/${draft.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Hausdesign' }),
      });

      // Saved by itself after the changes: the same template, its old file gone.
      await ctx.deps.background?.idle();
      const rows = await ctx.deps.db.select().from(workspaceMasters);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row).toMatchObject({ id: first!.id, name: 'Hausdesign', format: 'odp' });
      expect(row!.layouts.map((layout) => layout.name)).toEqual(['Titelfolie', 'Layout 2']);
      expect(row!.colors).toEqual([{ color: '#112233', name: 'Primär' }]);
      expect(row!.fileKey).not.toBe(first!.fileKey);
      expect(await ctx.deps.storage.get(first!.fileKey)).toBeNull();
      const template = await OdpDocument.open((await ctx.deps.storage.get(row!.fileKey))!);
      expect(template.isTemplate()).toBe(true);
      expect((await template.guides())[0]!.position).toBeCloseTo(0.1, 3);
      // Each layout its own guides: the first one's changed, the second keeps the shared ones.
      const [shared] = await ctx.deps.db.select().from(decks).where(eq(decks.id, draft.id));
      const vertical = { orientation: 'vertical', position: 0.1 } as const;
      const horizontal = { orientation: 'horizontal', position: 0.3 } as const;
      expect(layoutGuidesOf(shared!.templateDesign!, 'sl-zweites')).toEqual([vertical]);
      const change = withLayoutGuides(shared!.templateDesign!, [pageId!, 'sl-zweites'], pageId!, [
        vertical,
        horizontal,
      ]);
      expect(change).toEqual({
        guides: [],
        layoutGuides: { [pageId!]: [vertical, horizontal], 'sl-zweites': [vertical] },
      });
      const perLayout = await ctx.request(`/api/decks/${draft.id}/template`, {
        method: 'PATCH',
        json: change,
      });
      expect(perLayout.status).toBe(200);
      // „Exportieren“ hands out the template, not the deck that designs it.
      const exported = await ctx.request(`/api/decks/${draft.id}/edit/file`);
      expect(exported.status).toBe(200);
      expect(exported.headers.get('content-type')).toBe(OTP_MIME);
      expect(exported.headers.get('content-disposition')).toContain('Hausdesign.otp');
      expect(
        (await OdpDocument.open(new Uint8Array(await exported.arrayBuffer()))).isTemplate(),
      ).toBe(true);

      // Saved on request too, in place.
      const saved = await ctx.request(`/api/decks/${draft.id}/template/save`, { method: 'POST' });
      expect(saved.status).toBe(200);
      expect(((await saved.json()) as WorkspaceMaster).id).toBe(first!.id);
      const [deck] = await ctx.deps.db.select().from(decks).where(eq(decks.id, draft.id));
      expect(deck!.templateDesign).toMatchObject({ masterId: first!.id });
      // A presentation made from it shows its layout grid („Layout-Ansicht“).
      const fromDesign = await ctx.request('/api/decks/blank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ masterId: first!.id }),
      });
      const made = deckSchema.parse(await fromDesign.json());
      expect(made.grid).toEqual(GRID);
      // Its slides show their layout's guides – a slide added on the second layout that one's, a
      // slide on a layout from elsewhere (no guides of its own) the file's snap lines: those all
      // layouts share, as the import reads them – not the first slide's.
      const uploaded = await ctx.request(`/api/workspaces/${ctx.workspaceId}/masters`, {
        method: 'POST',
        body: form(await odpTemplate(), 'Fremd.otp'),
      });
      const foreign = ((await uploaded.json()) as WorkspaceMaster[]).find(
        (master) => master.id !== first!.id,
      );
      await ctx.deps.queue.idle();
      const madeState = (await (
        await ctx.request(`/api/decks/${made.id}/edit`)
      ).json()) as DeckEditState;
      const madeLayouts = (await (
        await ctx.request(`/api/decks/${made.id}/layouts`)
      ).json()) as DeckLayouts;
      const onSecond = await ctx.request(`/api/decks/${made.id}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [
            {
              type: 'addSlide',
              like: madeState.slides[0]!.pageId,
              newPageId: 'sl-auf-zweitem',
              after: madeState.slides[0]!.pageId,
              master: madeLayouts.layouts[1]!.page,
            },
            {
              type: 'addSlide',
              like: 'sl-auf-zweitem',
              newPageId: 'sl-fremd',
              after: 'sl-auf-zweitem',
              design: { id: foreign!.id, layout: 0 },
            },
          ],
        },
      });
      expect(onSecond.status).toBe(200);
      const [madeRevision] = await ctx.deps.db
        .select()
        .from(revisions)
        .where(eq(revisions.deckId, made.id));
      const madeFile = await OdpDocument.open(
        (await ctx.deps.storage.get(madeRevision!.pptxKey!))!,
      );
      // Its slide has the picture placeholder as a picture frame to swap, showing the grey
      // placeholder – not an empty placeholder LibreOffice draws nothing of (nor of its swap).
      const slot = madeFile.slides()[0]!.elements.find((element) => element.role === 'graphic');
      expect(slot).toMatchObject({ kind: 'image', movable: true });
      expect(madeFile.slideXml(0)).not.toMatch(/presentation:class="graphic"[^>]*placeholder/);
      // Its text placeholders empty, each asking for what was typed on the layout, in its look;
      // the locked footer is the layout's own, not one to fill.
      const asks = madeFile
        .slides()[0]!
        .elements.flatMap((element) =>
          element.live?.placeholder
            ? [[element.role, element.live.prompt, element.live.paragraphs[0]?.mark.size]]
            : [],
        );
      expect(asks).toEqual([
        ['outline', 'Untertitel', 24],
        ['title', 'Titel', 40],
      ]);
      const madeGuides = (
        await ctx.deps.db
          .select()
          .from(slideVersions)
          .where(eq(slideVersions.revisionId, madeRevision!.id))
      )
        .sort((a, b) => a.position - b.position)
        .map((version) => version.guides.map((guide) => guide.orientation));
      expect(madeGuides).toEqual([['vertical', 'horizontal'], ['vertical'], ['vertical']]);

      // A layout duplicated takes its guides along, a new one starts without.
      const copied = await ctx.request(`/api/decks/${draft.id}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [
            { type: 'duplicateSlide', pageId, newPageId: 'sl-kopie', after: 'sl-zweites' },
            { type: 'addSlide', like: pageId, newPageId: 'sl-neu', after: 'sl-kopie' },
          ],
        },
      });
      expect(copied.status).toBe(200);
      const [designed] = await ctx.deps.db.select().from(decks).where(eq(decks.id, draft.id));
      const design = designed!.templateDesign!;
      expect(layoutGuidesOf(design, 'sl-kopie')).toEqual([vertical, horizontal]);
      expect(layoutGuidesOf(design, 'sl-neu')).toEqual([]);
      // The AI hears of the guides of the layouts there are only (a layout gone keeps its own).
      const [draftRevision] = await ctx.deps.db
        .select()
        .from(revisions)
        .where(eq(revisions.deckId, draft.id));
      const brief = await deckDesign(
        ctx.deps,
        { deck: designed!, revision: draftRevision! },
        { pageIds: ['sl-zweites', 'sl-neu'], guides: async () => [horizontal] },
      );
      expect(brief.guides).toEqual([vertical]);

      // The workspace's name taken in the library: the next one counts on.
      await ctx.request(`/api/decks/${draft.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `${workspace!.name} Vorlage` }),
      });
      await ctx.deps.background?.idle();
      const next = await ctx.request(`/api/workspaces/${ctx.workspaceId}/masters/draft`, {
        method: 'POST',
      });
      expect(deckSchema.parse(await next.json()).title).toBe(`${workspace!.name} Vorlage 2`);
    } finally {
      await ctx.cleanup();
    }
  }
});

it('builds a deck on a design, finds it again, and takes a template’s layout into a deck that lacks it', async () => {
  {
    const ctx = await createTestContext({ libreOfficePdf: fakeOdpPdf() });
    try {
      const masterOf = async (deckId: string) =>
        (await ctx.deps.db.select().from(decks).where(eq(decks.id, deckId)))[0]!.masterId;
      // A file of its own each time: the same file again would be the deck uploaded before.
      const upload = async () => {
        const zip = await JSZip.loadAsync(DEMO_ODP);
        zip.file('slider-test.txt', crypto.randomUUID());
        const res = await ctx.request('/api/decks/upload', {
          method: 'POST',
          body: odpForm(await zip.generateAsync({ type: 'uint8array' })),
        });
        expect(res.status).toBe(201);
        const deck = deckSchema.parse(await res.json());
        await ctx.deps.queue.idle();
        return deck;
      };
      // No design in the workspace yet: nothing to find – the deck's own layouts all the same.
      const before = await upload();
      expect(await masterOf(before.id)).toBeNull();
      const own = (await (
        await ctx.request(`/api/decks/${before.id}/layouts`)
      ).json()) as DeckLayouts;
      expect(own.layouts.map((layout) => [layout.name, layout.page])).toEqual([
        ['Title Slide', 'Title_20_Slide'],
        ['Title and Content', 'Title_20_and_20_Content'],
      ]);
      expect(own.layouts[0]!.thumbnailUrl).toMatch(/^\/files\/decks\//);

      const uploaded = await ctx.request(`/api/workspaces/${ctx.workspaceId}/masters`, {
        method: 'POST',
        body: form(await odpTemplate(), 'Hausdesign.otp'),
      });
      const [master] = (await uploaded.json()) as WorkspaceMaster[];

      // Made from it: one slide of its first layout, its placeholders empty.
      const res = await ctx.request('/api/decks/blank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ masterId: master!.id }),
      });
      expect(res.status).toBe(201);
      const made = deckSchema.parse(await res.json());
      expect(await masterOf(made.id)).toBe(master!.id);
      // Its pickers offer the template's colours – none set: the general ones – and its own.
      expect(made.colors).toEqual({ template: null, custom: [] });
      // A template uploaded as a file has no grid of its own: the standard one.
      expect(made.grid).toBeNull();
      await ctx.deps.db
        .update(workspaceMasters)
        .set({ colors: [{ color: '#aa0000', name: 'Rot' }] })
        .where(eq(workspaceMasters.id, master!.id));
      const customized = await ctx.request(`/api/decks/${made.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customColors: ['#00ff00'] }),
      });
      expect(deckSchema.parse(await customized.json()).colors).toEqual({
        template: [{ color: '#aa0000', name: 'Rot' }],
        custom: ['#00ff00'],
      });
      const badColor = await ctx.request(`/api/decks/${made.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customColors: ['red'] }),
      });
      expect(badColor.status).toBe(400);
      const [revision] = await ctx.deps.db
        .select()
        .from(revisions)
        .where(eq(revisions.deckId, made.id));
      const document = await OdpDocument.open((await ctx.deps.storage.get(revision!.pptxKey!))!);
      expect(document.slides()).toHaveLength(1);
      expect(document.isTemplate()).toBe(false);
      const layouts = (await (
        await ctx.request(`/api/decks/${made.id}/layouts`)
      ).json()) as DeckLayouts;
      expect(layouts.layouts.map((layout) => layout.name)).toEqual([
        'Title Slide',
        'Title and Content',
      ]);
      expect(document.slideXml(0)).toContain(`draw:master-page-name="${layouts.layouts[0]!.page}"`);
      expect(document.slideXml(0)).toContain('presentation:placeholder="true"');

      // Uploaded, built on the same design: found.
      const after = await upload();
      expect(await masterOf(after.id)).toBe(master!.id);
    } finally {
      await ctx.cleanup();
    }
  }
  {
    const drawn: Uint8Array[] = [];
    const toPdf = fakeOdpPdf();
    const libreOfficePdf: PptxToPdf = async (deck, options) => {
      drawn.push(deck);
      return toPdf(deck, options);
    };
    libreOfficePdf.pages = async (deck, pages, options) => {
      drawn.push(deck);
      return toPdf.pages!(deck, pages, options);
    };
    const ctx = await createTestContext({ libreOfficePdf });
    try {
      const uploaded = await ctx.request(`/api/workspaces/${ctx.workspaceId}/masters`, {
        method: 'POST',
        body: form(await odpTemplate(), 'Hausdesign.otp'),
      });
      const [master] = (await uploaded.json()) as WorkspaceMaster[];
      const created = await ctx.request('/api/decks/blank', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const deck = deckSchema.parse(await created.json());
      await ctx.deps.queue.idle();
      const layoutsOf = async () =>
        (await (await ctx.request(`/api/decks/${deck.id}/layouts`)).json()) as DeckLayouts;
      const blank = await layoutsOf();
      expect(blank.layouts.map((layout) => layout.page)).toEqual(['Default']);
      // Asked again: the pictures kept, nothing drawn anew.
      const drawings = drawn.length;
      expect((await layoutsOf()).layouts[0]!.imageUrl.split('?')[0]).toBe(
        blank.layouts[0]!.imageUrl.split('?')[0],
      );
      expect(drawn).toHaveLength(drawings);

      const state = (await (
        await ctx.request(`/api/decks/${deck.id}/edit`)
      ).json()) as DeckEditState;
      const first = state.slides[0]!.pageId!;

      const res = await ctx.request(`/api/decks/${deck.id}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [
            {
              type: 'addSlide',
              like: first,
              newPageId: 'sl-hausdesign',
              after: first,
              design: { id: master!.id, layout: 1 },
            },
          ],
        },
      });
      expect(res.status).toBe(200);
      const [revision] = await ctx.deps.db
        .select()
        .from(revisions)
        .where(eq(revisions.deckId, deck.id));
      const document = await OdpDocument.open((await ctx.deps.storage.get(revision!.pptxKey!))!);
      expect(document.slides()).toHaveLength(2);
      expect(document.slideXml(1)).toContain('draw:master-page-name="Title_20_and_20_Content"');

      // Its design changed: the layouts now with the one taken in, drawn anew.
      const after = await layoutsOf();
      expect(after.layouts.map((layout) => layout.name)).toEqual(['Default', 'Title and Content']);
      expect(drawn.length).toBeGreaterThan(drawings);

      // A template of the workspace that is gone: the slide does not fit, with the reason.
      const gone = await ctx.request(`/api/decks/${deck.id}/edit/operations`, {
        method: 'POST',
        json: {
          operations: [
            {
              type: 'addSlide',
              like: first,
              newPageId: 'sl-weg',
              after: first,
              design: { id: 'weg', layout: 0 },
            },
          ],
        },
      });
      expect(gone.status).toBe(400);
      expect(await gone.text()).toContain('gibt es in der Vorlage nicht mehr');
    } finally {
      await ctx.cleanup();
    }
  }
});
