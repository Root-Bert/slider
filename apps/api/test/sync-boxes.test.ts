import { asc, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { UNLIMITED_PLAN } from '../src/services/plans';
import { textHash, type ParsedPresentation, type ParsedShape } from '@slider/pptx';
import {
  commentSchema,
  revisionDiffSchema,
  slideSchema,
  syncResultSchema,
  type Comment,
  type CreateCommentInput,
  type Rect,
} from '@slider/shared';
import { slideVersions } from '../src/db/schema';
import { rerenderRevision } from '../src/import/rerender';
import { silentLogger } from '../src/logger';
import { createTestContext, type TestContext } from './helpers';
import { makePdf } from './pdf';
import {
  BASE_SLIDES,
  commentRows,
  createLinkDeck,
  FakeSource,
  pptxBytes,
  presentation,
  revisionRows,
  versionedPptx,
} from './sync-helpers';

/**
 * Owner decision 7: comments are carried over by boxes (shapes), not by slide ids alone. A box
 * comment follows its box, a slide comment stays on the slide that kept one of its boxes, a
 * slide that kept none of them is deleted (its comments go to "Gelöschte Folien"). Plus the
 * hidden/shown signal of the diff and image reuse for unchanged slides.
 */

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

const NOTE_BOX: Rect = { x: 0.6, y: 0.8, w: 0.3, h: 0.1 };

function shape(id: string, name: string, text: string, bbox: Rect): ParsedShape {
  return {
    id,
    name,
    kind: 'text',
    bbox,
    text,
    paragraphs: [],
    imagePath: null,
    fill: null,
    placeholder: null,
  } as ParsedShape;
}

/** `pres` with slide `index`'s shapes replaced (and its text hash updated). */
function withShapes(
  pres: ParsedPresentation,
  index: number,
  shapes: (old: ParsedShape[]) => ParsedShape[],
): ParsedPresentation {
  return {
    ...pres,
    slides: pres.slides.map((slide) => {
      if (slide.index !== index) return slide;
      const next = shapes(slide.shapes);
      return { ...slide, shapes: next, textHash: textHash(next.map((s) => s.text).join('\n')) };
    }),
  };
}

async function setup(versions: Record<string, ParsedPresentation>, v1 = presentation(BASE_SLIDES)) {
  const source = new FakeSource();
  const pptx = versionedPptx({ v1, ...versions });
  ctx = await createTestContext({
    openPptx: pptx.open,
    sources: { onedrive: source },
    config: { plans: { free: UNLIMITED_PLAN, paid: UNLIMITED_PLAN } },
  });
  const deckId = await createLinkDeck(ctx, source);
  return { ctx, source, pptx, deckId };
}

async function syncTo(context: TestContext, source: FakeSource, deckId: string, version: string) {
  source.token = `token-${version}`;
  source.bytes = pptxBytes(version);
  const result = syncResultSchema.parse(
    await context.deps.sync.checkDeck(deckId, { manual: true }),
  );
  expect(result.status).toBe('updated');
}

const slidesOf = async (context: TestContext, deckId: string) =>
  slideSchema.array().parse(await (await context.request(`/api/decks/${deckId}/slides`)).json());

async function post(context: TestContext, deckId: string, input: CreateCommentInput) {
  const res = await context.request(`/api/decks/${deckId}/comments`, {
    method: 'POST',
    json: input,
  });
  expect(res.status).toBe(201);
  return commentSchema.parse(await res.json());
}

/** A box comment bound to `boxShape`, as the viewer creates it. */
const boxComment = (
  slideId: string,
  boxShape: { id: string; name: string; bbox: Rect },
  body: string,
): CreateCommentInput => ({
  slideId,
  body,
  anchor: {
    type: 'rect',
    rect: boxShape.bbox,
    shapeRef: {
      shapeId: boxShape.id,
      offset: { x: 0.5, y: 0.5 },
      size: { w: 1, h: 1 },
      name: boxShape.name,
      bbox: boxShape.bbox,
    },
  },
});

const slideComment = (slideId: string, body: string): CreateCommentInput => ({
  slideId,
  body,
  anchor: { type: 'slide' },
});

const latestDiff = async (context: TestContext, deckId: string) =>
  revisionDiffSchema.parse(
    await (await context.request(`/api/decks/${deckId}/revisions/latest/diff`)).json(),
  );

const byId = (rows: { id: string; slideId: string | null }[], id: string) =>
  rows.find((row) => row.id === id);

describe('sync: comments follow their boxes (owner decision 7)', () => {
  it('a box cut to another slide takes its comment (and replies) along', async () => {
    const note = shape('4', 'Hinweis', 'Entscheidung bis Freitag im Lenkungskreis', NOTE_BOX);
    const v1 = withShapes(presentation(BASE_SLIDES), 1, (old) => [...old, note]);
    // Cut from "Agenda", pasted on "Produkt-Roadmap" (new id there).
    const v2 = withShapes(presentation(BASE_SLIDES), 3, (old) => [...old, { ...note, id: '7' }]);
    const { ctx, source, deckId } = await setup({ v2 }, v1);
    const before = await slidesOf(ctx, deckId);
    const agenda = before[1]!;
    const roadmap = before[3]!;
    const onNote = await post(ctx, deckId, boxComment(agenda.id, note, 'Wer entscheidet?'));
    const reply = await post(ctx, deckId, {
      slideId: null,
      parentId: onNote.id,
      body: 'Der Lenkungskreis',
      anchor: { type: 'slide' },
    });
    const onTitle = await post(ctx, deckId, boxComment(agenda.id, agenda.shapes[0]!, 'Titel ok'));
    const onSlide = await post(ctx, deckId, slideComment(agenda.id, 'Agenda zu lang'));

    await syncTo(ctx, source, deckId, 'v2');

    const rows = await commentRows(ctx, deckId);
    expect(byId(rows, onNote.id)?.slideId).toBe(roadmap.id);
    expect(byId(rows, reply.id)?.slideId).toBe(roadmap.id);
    const moved = rows.find((row) => row.id === onNote.id)?.anchor;
    expect(moved).toMatchObject({
      type: 'rect',
      rect: NOTE_BOX,
      shapeRef: { shapeId: '7', name: 'Hinweis' },
    });
    // The rest of the slide stayed: so do its other comments.
    expect(byId(rows, onTitle.id)?.slideId).toBe(agenda.id);
    expect(byId(rows, onSlide.id)?.slideId).toBe(agenda.id);
    const after = await slidesOf(ctx, deckId);
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
  });

  it('a freed sldId with only new boxes is a new slide; the old comments go to deleted slides', async () => {
    // "Risiken" (260) deleted, a picture slide inserted that gets the freed id 260.
    const v2 = withShapes(presentation(BASE_SLIDES), 4, () => [
      shape('5', 'Foto Team', '', { x: 0.5, y: 0.4, w: 0.45, h: 0.5 }),
      shape('6', 'Textfeld', 'Unser Team in Leipzig', { x: 0.05, y: 0.8, w: 0.4, h: 0.1 }),
    ]);
    const { ctx, source, deckId } = await setup({ v2 });
    const before = await slidesOf(ctx, deckId);
    const risiken = before[4]!;
    const onSlide = await post(ctx, deckId, slideComment(risiken.id, 'Risiken priorisieren'));
    const onTitle = await post(ctx, deckId, boxComment(risiken.id, risiken.shapes[0]!, 'Titel?'));

    await syncTo(ctx, source, deckId, 'v2');

    const after = await slidesOf(ctx, deckId);
    expect(after).toHaveLength(6);
    expect(after[4]?.id).not.toBe(risiken.id);
    expect(after[4]?.change?.status).toBe('new');
    const diff = await latestDiff(ctx, deckId);
    expect(diff.deletedSlides.map((s) => s.slideId)).toEqual([risiken.id]);
    expect(diff.deletedSlides[0]?.comments.map((c: Comment) => c.id).sort()).toEqual(
      [onSlide.id, onTitle.id].sort(),
    );
  });

  it('a slide comment stays when one box of the slide survived', async () => {
    // "Risiken" rebuilt: the title box stays (new text), the body becomes a picture.
    const v2 = withShapes(presentation(BASE_SLIDES), 4, (old) => [
      { ...old[0]!, text: 'Was uns aufhalten könnte' },
      shape('9', 'Diagramm', '', { x: 0.1, y: 0.4, w: 0.8, h: 0.5 }),
    ]);
    const { ctx, source, deckId } = await setup({ v2 });
    const before = await slidesOf(ctx, deckId);
    const risiken = before[4]!;
    const onSlide = await post(ctx, deckId, slideComment(risiken.id, 'Risiken priorisieren'));

    await syncTo(ctx, source, deckId, 'v2');

    const after = await slidesOf(ctx, deckId);
    expect(after[4]).toMatchObject({ id: risiken.id, change: { status: 'modified' } });
    expect(byId(await commentRows(ctx, deckId), onSlide.id)?.slideId).toBe(risiken.id);
    expect((await latestDiff(ctx, deckId)).deletedSlides).toEqual([]);
  });

  it('a box comment on a deleted slide follows its box to the slide it was pasted on', async () => {
    const note = shape('4', 'Hinweis', 'Entscheidung bis Freitag im Lenkungskreis', NOTE_BOX);
    const v1 = withShapes(presentation(BASE_SLIDES), 2, (old) => [...old, note]);
    // "Umsatz nach Region" deleted, its note pasted on "Agenda" first.
    const v2 = withShapes(presentation(BASE_SLIDES.filter((s) => s.sldId !== 258)), 1, (old) => [
      ...old,
      { ...note, id: '8' },
    ]);
    const { ctx, source, deckId } = await setup({ v2 }, v1);
    const before = await slidesOf(ctx, deckId);
    const umsatz = before[2]!;
    const onNote = await post(ctx, deckId, boxComment(umsatz.id, note, 'Quelle?'));
    const onSlide = await post(ctx, deckId, slideComment(umsatz.id, 'Zahlen prüfen'));

    await syncTo(ctx, source, deckId, 'v2');

    const rows = await commentRows(ctx, deckId);
    expect(byId(rows, onNote.id)?.slideId).toBe(before[1]!.id);
    expect(byId(rows, onSlide.id)?.slideId).toBe(umsatz.id);
    expect((await latestDiff(ctx, deckId)).deletedSlides.map((s) => s.slideId)).toEqual([
      umsatz.id,
    ]);
  });
});

describe('sync: hidden and shown slides', () => {
  it('reports hiding apart from the content status, in the diff and on the slide', async () => {
    const hidden = presentation(BASE_SLIDES);
    const v2 = { ...hidden, slides: hidden.slides.map((s) => ({ ...s, hidden: s.index === 2 })) };
    const { ctx, source, deckId } = await setup({ v2, v3: presentation(BASE_SLIDES) });

    await syncTo(ctx, source, deckId, 'v2');
    const slides = await slidesOf(ctx, deckId);
    expect(slides[2]?.change).toMatchObject({ status: 'unchanged', hiddenChanged: 'hidden' });
    expect(slides[1]?.change?.hiddenChanged).toBeUndefined();
    const diff = await latestDiff(ctx, deckId);
    expect(diff.slides.filter((s) => s.hiddenChanged)).toEqual([
      expect.objectContaining({ slideId: slides[2]!.id, hiddenChanged: 'hidden' }),
    ]);

    await syncTo(ctx, source, deckId, 'v3');
    expect((await slidesOf(ctx, deckId))[2]?.change?.hiddenChanged).toBe('shown');
  });
});

describe('sync: unchanged slides keep their images (3a)', () => {
  const versionsOf = (context: TestContext, revisionId: string) =>
    context.deps.db
      .select()
      .from(slideVersions)
      .where(eq(slideVersions.revisionId, revisionId))
      .orderBy(asc(slideVersions.position));

  it('reuses the files of unchanged slides, and a re-render never deletes them', async () => {
    const edited = BASE_SLIDES.map((s) =>
      s.sldId === 257 ? { ...s, body: 'Rückblick Umsatz Roadmap nächste Schritte Budget' } : s,
    );
    const { ctx, source, deckId, pptx } = await setup({ v2: presentation(edited) });
    await syncTo(ctx, source, deckId, 'v2');
    const [first, second] = await revisionRows(ctx, deckId);
    const v1 = await versionsOf(ctx, first!.id);
    const v2 = await versionsOf(ctx, second!.id);
    expect(v2.map((row) => row.imageKey === v1[row.position]?.imageKey)).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(v2[0]?.thumbnailKey).toBe(v1[0]?.thumbnailKey);
    expect(v2[1]?.imageKey.startsWith(`decks/${deckId}/${second!.id}/`)).toBe(true);
    // No stray copies under the new revision: only the edited slide's image(s).
    const stored = await ctx.deps.storage.list(`decks/${deckId}/${second!.id}/slides/`);
    expect(new Set(stored)).toEqual(new Set([v2[1]!.imageKey, v2[1]!.thumbnailKey]));

    // LibreOffice arrives: the current revision is re-rendered, the shared SVGs stay for v1.
    const outcome = await rerenderRevision(
      {
        db: ctx.deps.db,
        storage: ctx.deps.storage,
        openPptx: pptx.open,
        clock: ctx.clock,
        log: silentLogger,
        libreOfficePdf: async () => makePdf(6),
      } as Parameters<typeof rerenderRevision>[0],
      deckId,
    );
    expect(outcome.status).toBe('rendered');
    const rerendered = await versionsOf(ctx, second!.id);
    expect(rerendered[0]?.imageKey).not.toBe(v1[0]?.imageKey);
    for (const row of v1) {
      expect(await ctx.deps.storage.get(row.imageKey), row.imageKey).not.toBeNull();
      expect(await ctx.deps.storage.get(row.thumbnailKey), row.thumbnailKey).not.toBeNull();
    }
  });

  it('renders slides with a slide-number field again (the hash leaves its value out)', async () => {
    // An insert above renumbers the slide without changing its hash: the old picture would show
    // the old number.
    const numbered = (n: number) => {
      const pres = presentation(BASE_SLIDES);
      return {
        ...pres,
        slides: pres.slides.map((slide) =>
          slide.index === 3
            ? {
                ...slide,
                shapes: [
                  ...slide.shapes,
                  shape('9', 'Foliennummer', `<span data-field="slidenum">${n}</span>`, NOTE_BOX),
                ],
              }
            : slide,
        ),
      };
    };
    const { ctx, source, deckId } = await setup({ v2: numbered(5) }, numbered(4));
    await syncTo(ctx, source, deckId, 'v2');
    const [first, second] = await revisionRows(ctx, deckId);
    const v1 = await versionsOf(ctx, first!.id);
    const v2 = await versionsOf(ctx, second!.id);
    expect(v2[3]?.renderHash).toBe(v1[3]?.renderHash);
    expect(v2[3]?.imageKey).not.toBe(v1[3]?.imageKey);
    expect(v2[2]?.imageKey).toBe(v1[2]?.imageKey);
  });

  it('draws nothing when no slide looks different', async () => {
    let conversions = 0;
    const source = new FakeSource();
    const pptx = versionedPptx({
      v1: presentation(BASE_SLIDES),
      v2: presentation(BASE_SLIDES),
    });
    ctx = await createTestContext({
      openPptx: pptx.open,
      sources: { onedrive: source },
      libreOfficePdf: async () => {
        conversions += 1;
        return makePdf(6);
      },
      config: { plans: { free: UNLIMITED_PLAN, paid: UNLIMITED_PLAN } },
    });
    const deckId = await createLinkDeck(ctx, source);
    expect(conversions).toBe(1);
    // Same slides, only reordered: every image is kept and no PDF is drawn.
    pptx.versions.v2 = presentation([...BASE_SLIDES.slice(1), BASE_SLIDES[0]!]);
    await syncTo(ctx, source, deckId, 'v2');
    expect(conversions).toBe(1);
    const [first, second] = await revisionRows(ctx, deckId);
    const v1 = await versionsOf(ctx, first!.id);
    const v2 = await versionsOf(ctx, second!.id);
    expect(v2.map((row) => row.renderer)).toEqual(v1.map(() => 'libreoffice'));
    expect(new Set(v2.map((row) => row.imageKey))).toEqual(new Set(v1.map((row) => row.imageKey)));
    expect(await ctx.deps.storage.list(`decks/${deckId}/${second!.id}/slides/`)).toEqual([]);
  });
});
