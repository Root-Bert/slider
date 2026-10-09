import { afterEach, describe, expect, it } from 'vitest';
import {
  commentSchema,
  deckSchema,
  revisionDiffSchema,
  syncResultSchema,
  type Comment,
} from '@slider/shared';
import { openPptx } from '@slider/pptx';
import { sampleDeck } from '../../../packages/pptx/scripts/sample-deck';
import { buildPptx, type SlideSpec } from '../../../packages/pptx/test/fixtures/build-pptx';
import { createTestContext, type TestContext } from './helpers';
import {
  BASE_SLIDES,
  commentRows,
  createLinkDeck,
  FakeSource,
  pptComment,
  pptxBytes,
  presentation,
  revisionRows,
  versionedPptx,
} from './sync-helpers';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
  ctx = undefined;
});

async function syncTo(context: TestContext, source: FakeSource, deckId: string, version: string) {
  source.token = `token-${version}`;
  source.bytes = pptxBytes(version);
  const res = await context.request(`/api/decks/${deckId}/sync`, { method: 'POST' });
  return syncResultSchema.parse(await res.json());
}

async function listComments(context: TestContext, deckId: string): Promise<Comment[]> {
  const res = await context.request(`/api/decks/${deckId}/comments`);
  return commentSchema.array().parse(await res.json());
}

describe('PowerPoint comments across revisions (BER-114)', () => {
  const A = (text: string, status: 'open' | 'done' = 'open') =>
    pptComment('{A}', 257, text, { status });
  const B = () =>
    pptComment('{B}', 258, 'Quelle fehlt.', {
      replies: [
        {
          externalId: '{B1}',
          author: { name: 'Max Kern', initials: null },
          createdAt: null,
          text: 'Stimmt.',
        },
      ],
    });
  const C = () => pptComment('{C}', 259, 'Neues Bild verwenden.');

  it('updates, flags removed and inserts new comments idempotently', async () => {
    const source = new FakeSource();
    const pptx = versionedPptx({
      v1: presentation(BASE_SLIDES, [A('Reihenfolge ändern?'), B()]),
      v2: presentation(BASE_SLIDES, [A('Reihenfolge jetzt ändern?', 'done'), C()]),
      v3: presentation(BASE_SLIDES, [A('Reihenfolge jetzt ändern?', 'done'), C()]),
      v4: presentation(BASE_SLIDES, [A('Reihenfolge jetzt ändern?', 'done'), B(), C()]),
      v5: presentation(BASE_SLIDES, [A('Reihenfolge jetzt ändern?', 'done'), B(), C()]),
    });
    ctx = await createTestContext({ openPptx: pptx.open, sources: { onedrive: source } });
    const deckId = await createLinkDeck(ctx, source);

    const v1 = await listComments(ctx, deckId);
    const b = v1.find((c) => c.body === 'Quelle fehlt.')!;
    expect(v1.every((c) => c.sourceStatus === 'present')).toBe(true);
    // An app reply on a PowerPoint comment.
    const appReply = commentSchema.parse(
      await (
        await ctx.request(`/api/decks/${deckId}/comments`, {
          method: 'POST',
          json: {
            slideId: null,
            parentId: b.id,
            body: 'Ich kümmere mich.',
            anchor: { type: 'slide' },
          },
        })
      ).json(),
    );
    const initial = deckSchema.parse(await (await ctx.request(`/api/decks/${deckId}`)).json());
    expect(initial.openCommentCount).toBe(2);

    // v2: A edited and resolved in PowerPoint, B (with its reply) deleted, C new.
    const r2 = await syncTo(ctx, source, deckId, 'v2');
    expect(r2.summary).toMatchObject({ commentsNew: 1, commentsUpdated: 1, commentsRemoved: 2 });
    expect(r2.summary?.text).toBe(
      '1 neuer Kommentar aus PowerPoint, 1 Kommentar in PowerPoint geändert, 2 Kommentare in PowerPoint entfernt',
    );
    const v2 = await listComments(ctx, deckId);
    const byBody = (body: string) => v2.find((c) => c.body === body);
    expect(byBody('Reihenfolge jetzt ändern?')).toMatchObject({
      status: 'done',
      sourceStatus: 'present',
    });
    expect(byBody('Quelle fehlt.')).toMatchObject({ id: b.id, sourceStatus: 'removed_in_pptx' });
    expect(byBody('Stimmt.')?.sourceStatus).toBe('removed_in_pptx');
    expect(v2.find((c) => c.id === appReply.id)).toMatchObject({
      parentId: b.id,
      sourceStatus: 'present',
      source: 'app',
    });
    expect(byBody('Neues Bild verwenden.')).toMatchObject({
      status: 'open',
      sourceStatus: 'present',
    });
    // Removed comments no longer count as open feedback.
    const deck = deckSchema.parse(await (await ctx.request(`/api/decks/${deckId}`)).json());
    expect(deck.openCommentCount).toBe(1);

    // v3: different bytes, same comments → nothing written.
    const snapshot = await commentRows(ctx, deckId);
    const r3 = await syncTo(ctx, source, deckId, 'v3');
    expect(r3.status).toBe('updated');
    expect(r3.summary).toMatchObject({ commentsNew: 0, commentsUpdated: 0, commentsRemoved: 0 });
    expect(await commentRows(ctx, deckId)).toEqual(snapshot);

    // Resolved in Slider: stays resolved while PowerPoint still says "open".
    const c = v2.find((x) => x.body === 'Neues Bild verwenden.')!;
    await ctx.request(`/api/comments/${c.id}`, { method: 'PATCH', json: { status: 'done' } });

    // v4: B is back → flag cleared, counted as new again.
    const r4 = await syncTo(ctx, source, deckId, 'v4');
    expect(r4.summary).toMatchObject({ commentsNew: 2, commentsRemoved: 0 });
    const v4 = await listComments(ctx, deckId);
    expect(v4.find((x) => x.id === b.id)?.sourceStatus).toBe('present');
    expect(v4.find((x) => x.id === c.id)?.status).toBe('done');
    expect(v4).toHaveLength(5);

    // Ten more identical syncs: same count, no new revision.
    for (let i = 0; i < 10; i++) {
      const again = await ctx.request(`/api/decks/${deckId}/sync`, { method: 'POST' });
      expect(syncResultSchema.parse(await again.json()).status).toBe('unchanged');
    }
    expect(await listComments(ctx, deckId)).toHaveLength(5);
    expect(await revisionRows(ctx, deckId)).toHaveLength(4);
  });

  it('comments deleted in Slider stay deleted though the file still has them', async () => {
    const source = new FakeSource();
    const pptx = versionedPptx({
      v1: presentation(BASE_SLIDES, [A('Reihenfolge ändern?'), B(), C()]),
      v2: presentation(BASE_SLIDES, [A('Reihenfolge jetzt ändern?'), B(), C()]),
    });
    ctx = await createTestContext({ openPptx: pptx.open, sources: { onedrive: source } });
    const deckId = await createLinkDeck(ctx, source);
    const v1 = await listComments(ctx, deckId);
    const id = (body: string) => v1.find((c) => c.body === body)!.id;
    // Two roots and a reply on its own.
    for (const body of ['Reihenfolge ändern?', 'Stimmt.', 'Neues Bild verwenden.']) {
      expect((await ctx.request(`/api/comments/${id(body)}`, { method: 'DELETE' })).status).toBe(
        204,
      );
    }

    const r2 = await syncTo(ctx, source, deckId, 'v2');
    expect(r2.summary).toMatchObject({ commentsNew: 0, commentsUpdated: 0, commentsRemoved: 0 });
    const v2 = await listComments(ctx, deckId);
    expect(v2.map((c) => c.body)).toEqual(['Quelle fehlt.']);
  });

  it('takes over a status changed in PowerPoint, but not an unchanged one', async () => {
    const source = new FakeSource();
    const pptx = versionedPptx({
      v1: presentation(BASE_SLIDES, [A('Text')]),
      v2: presentation(BASE_SLIDES, [A('Text')]),
      v3: presentation(BASE_SLIDES, [A('Text', 'done')]),
      v4: presentation(BASE_SLIDES, [A('Text', 'open')]),
    });
    ctx = await createTestContext({ openPptx: pptx.open, sources: { onedrive: source } });
    const deckId = await createLinkDeck(ctx, source);
    const [a] = await listComments(ctx, deckId);
    await ctx.request(`/api/comments/${a!.id}`, { method: 'PATCH', json: { status: 'done' } });

    await syncTo(ctx, source, deckId, 'v2');
    expect((await listComments(ctx, deckId))[0]?.status).toBe('done'); // Slider wins
    await ctx.request(`/api/comments/${a!.id}`, { method: 'PATCH', json: { status: 'open' } });
    await syncTo(ctx, source, deckId, 'v3');
    expect((await listComments(ctx, deckId))[0]?.status).toBe('done'); // resolved in PowerPoint
    await syncTo(ctx, source, deckId, 'v4');
    expect((await listComments(ctx, deckId))[0]).toMatchObject({
      status: 'open',
      resolvedAt: null,
    });
  });
});

describe('real PPTX end to end', () => {
  const BASE: SlideSpec[] = sampleDeck.slides.map((slide, index) => ({
    ...slide,
    sldId: 256 + index,
  }));

  it('matches slides and comments of the sample deck across an edit', async () => {
    const v2Slides: SlideSpec[] = [
      BASE[0]!,
      {
        ...BASE[1]!,
        body: [
          'Nächste Schritte zuerst',
          'Rückblick Q3: Ziele und Ergebnisse',
          'Produkt-Roadmap bis Jahresende',
        ],
      },
      { sldId: 400, title: 'Wettbewerb', body: ['Marktanteile 2026'] },
      ...BASE.slice(3),
    ];
    const files: Record<string, Uint8Array> = {
      v1: await buildPptx({ title: sampleDeck.title, slides: BASE }),
      v2: await buildPptx({ title: sampleDeck.title, slides: v2Slides }),
    };
    const source = new FakeSource();
    source.bytes = files.v1!;
    ctx = await createTestContext({ openPptx: openPptx, sources: { onedrive: source } });
    const deckId = await createLinkDeck(ctx, source);
    const before = await listComments(ctx, deckId);
    expect(before.length).toBeGreaterThan(0);

    source.token = 'c2';
    source.bytes = files.v2!;
    const res = await ctx.request(`/api/decks/${deckId}/sync`, { method: 'POST' });
    const result = syncResultSchema.parse(await res.json());
    expect(result).toMatchObject({
      status: 'updated',
      summary: { slidesModified: 1, slidesNew: 1, slidesDeleted: 1, slidesMoved: 0 },
    });

    const diff = revisionDiffSchema.parse(
      await (await ctx.request(`/api/decks/${deckId}/revisions/latest/diff`)).json(),
    );
    expect(diff.slides.map((s) => s.status)).toEqual([
      'unchanged',
      'modified',
      'new',
      'unchanged',
      'unchanged',
      'unchanged',
    ]);
    expect(diff.slides.filter((s) => s.matchedBy === 'sldId')).toHaveLength(5);
    expect(diff.deletedSlides[0]).toMatchObject({
      title: 'Umsatz nach Region',
      lastRevisionNumber: 1,
    });
    // The resolved comment of the deleted slide is kept and flagged; the rest are unchanged.
    const after = await listComments(ctx, deckId);
    expect(after).toHaveLength(before.length);
    const removed = after.filter((c) => c.sourceStatus === 'removed_in_pptx');
    expect(removed.map((c) => c.slideId)).toEqual([diff.deletedSlides[0]?.slideId]);
    expect(diff.deletedSlides[0]?.comments.map((c) => c.id)).toEqual(removed.map((c) => c.id));
    for (const comment of after.filter((c) => c.sourceStatus === 'present')) {
      const was = before.find((c) => c.id === comment.id);
      expect(was?.slideId).toBe(comment.slideId);
      expect(was?.updatedAt).toBe(comment.updatedAt);
    }
  });
});
