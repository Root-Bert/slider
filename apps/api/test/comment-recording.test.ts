import { instanceAiUsageSchema, type Comment } from '@slider/shared';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEALED_PREFIX } from '../src/crypto/content-crypto';
import { media, workspaceMembers } from '../src/db/schema';
import {
  createReadyDeck,
  createTestContext,
  pinComment,
  signedInUser,
  type TestContext,
} from './helpers';

/** Editing a comment with a new recording (voice mode while editing). */
let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(() => ctx.cleanup());

/** A few bytes that pass as Ogg: the server checks the container signature only. */
const ogg = () => new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0, 0, 0]);

function recordingForm(body: string, bytes = ogg()) {
  const form = new FormData();
  form.append('comment', JSON.stringify({ body, media: { kind: 'audio', durationMs: 1200 } }));
  form.append('file', new File([bytes], 'aufnahme.ogg'));
  return form;
}

let deckId = '';
let slideId = '';

async function postComment() {
  const res = await ctx.request(`/api/decks/${deckId}/comments`, {
    method: 'POST',
    json: pinComment(slideId),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Comment;
}

beforeEach(async () => {
  const deck = await createReadyDeck(ctx);
  deckId = deck.deckId;
  slideId = deck.slideIds[0] ?? '';
});

describe('PUT /comments/:commentId/recording', () => {
  it('lets only the author add or replace a recording, saving its text as the note, and refuses what is none', async () => {
    {
      const comment = await postComment();
      const put = (body: string) =>
        ctx.request(`/api/comments/${comment.id}/recording`, {
          method: 'PUT',
          body: recordingForm(body),
        });

      const first = await put('Notiz');
      expect(first.status).toBe(200);
      const withVoice = (await first.json()) as Comment;
      expect(withVoice.body).toBe('Notiz');
      expect(withVoice.media).toMatchObject({
        kind: 'audio',
        mimeType: 'audio/ogg',
        durationMs: 1200,
      });

      // Again: one recording, a new one; the note may go empty.
      const second = (await (await put('')).json()) as Comment;
      expect(second.body).toBe('');
      expect(second.media?.id).not.toBe(withVoice.media?.id);
      expect((await ctx.request(`/api/media/${withVoice.media?.id}`)).status).toBe(404);
      expect((await ctx.request(`/api/media/${second.media?.id}`)).status).toBe(200);
    }
    {
      const comment = await postComment();
      const other = await signedInUser(ctx, { name: 'Andere', email: 'andere@example.com' });
      await ctx.deps.db
        .insert(workspaceMembers)
        .values({ workspaceId: ctx.workspaceId, userId: other.user.id, role: 'reviewer' });
      const res = await ctx.request(`/api/comments/${comment.id}/recording`, {
        method: 'PUT',
        body: recordingForm('Fremd'),
        cookie: other.cookie,
      });
      expect(res.status).toBe(403);
    }
    {
      const comment = await postComment();
      const fake = await ctx.request(`/api/comments/${comment.id}/recording`, {
        method: 'PUT',
        body: recordingForm('x', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
      });
      expect(fake.status).toBe(415);
      const unknown = await ctx.request(`/api/comments/${crypto.randomUUID()}/recording`, {
        method: 'PUT',
        body: recordingForm('x'),
      });
      expect(unknown.status).toBe(404);
    }
    {
      // A video comment is transcribed like a voice one: its own container sent to speech to
      // text (the services read the sound of a video), a failed try made anew, the text sealed
      // at rest and the seconds counted as a recording.
      const asked: File[] = [];
      let fail = true;
      const speech = await createTestContext({
        instanceAdmin: true,
        config: { speech: { url: 'http://stt:8000/v1', model: 'whisper-large-v3-turbo' } },
        aiFetch: async (url, init) => {
          if (!url.endsWith('/audio/transcriptions'))
            return Response.json({ data: [{ id: 'whisper-large-v3-turbo' }] });
          asked.push((init?.body as FormData).get('file') as File);
          if (fail) return new Response('busy', { status: 503 });
          return Response.json({ text: 'Den Titel bitte größer.' });
        },
      });
      try {
        const deck = await createReadyDeck(speech);
        const form = new FormData();
        const comment = { ...pinComment(deck.slideIds[0] ?? ''), body: '' };
        form.append(
          'comment',
          JSON.stringify({ ...comment, media: { kind: 'video', durationMs: 4000 } }),
        );
        // An MP4's first box: the server checks the container signature only.
        const mp4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
        form.append('file', new File([mp4], 'video.mp4'));
        const res = await speech.request(`/api/decks/${deck.deckId}/media-comments`, {
          method: 'POST',
          body: form,
        });
        expect(res.status).toBe(201);
        const created = (await res.json()) as Comment;
        expect(created.media).toMatchObject({ kind: 'video', transcriptStatus: 'pending' });
        const mediaId = created.media?.id ?? '';
        const status = async () =>
          (
            (await (await speech.request(`/api/decks/${deck.deckId}/comments`)).json()) as Comment[]
          ).find((each) => each.id === created.id)?.media;
        await vi.waitFor(async () => expect((await status())?.transcriptStatus).toBe('failed'));
        expect(asked[0]).toMatchObject({ name: 'recording.mp4', type: 'video/mp4' });

        fail = false;
        const retried = await speech.request(`/api/media/${mediaId}/transcript`, {
          method: 'POST',
        });
        expect(retried.status).toBe(204);
        await vi.waitFor(async () =>
          expect(await status()).toMatchObject({
            transcriptStatus: 'done',
            transcript: 'Den Titel bitte größer.',
          }),
        );
        const [row] = await speech.deps.db
          .select({ raw: sql<string>`${media.transcript}` })
          .from(media)
          .where(eq(media.id, mediaId));
        expect(row?.raw.startsWith(SEALED_PREFIX)).toBe(true);
        const usage = instanceAiUsageSchema.parse(
          await (await speech.request('/api/instance/ai-usage?interval=1d')).json(),
        );
        expect(usage.byFeature.find((each) => each.feature === 'recording')?.audioSeconds).toBe(4);
      } finally {
        await speech.cleanup();
      }
    }
  });
});
