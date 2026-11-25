import { instanceAiUsageSchema, type Comment } from '@slider/shared';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEALED_PREFIX } from '../src/crypto/content-crypto';
import { media, workspaceMembers, workspaces } from '../src/db/schema';
import { attachmentBlocks } from '../src/services/attachments';
import { blobKeys } from '../src/storage/blob-storage';
import { slipsFrom } from '../src/services/video-cuts';
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
          const sent = init?.body as FormData;
          if (sent.get('response_format') === 'verbose_json')
            return Response.json({
              text: 'Also hier ist der Plan. Hier ist der Plan.',
              duration: 12,
              segments: [
                { id: 0, start: 1.5, end: 3, text: 'Also hier ist der' },
                { id: 1, start: 3.2, end: 5, text: 'Plan.' },
                { id: 2, start: 8, end: 10, text: 'Hier ist der Plan.' },
              ],
            });
          asked.push(sent.get('file') as File);
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

        // „KI-Schnitt“ on a video before it is sent: its sound's silences become cuts (before the
        // first word, between, after the last) – the AI's slips only where the workspace has one.
        const sound = new FormData();
        sound.append('file', new File([new Uint8Array(64)], 'ton.wav', { type: 'audio/wav' }));
        const cuts = await speech.request(`/api/workspaces/${speech.workspaceId}/video-cuts`, {
          method: 'POST',
          body: sound,
        });
        expect(await cuts.json()).toEqual([
          { start: 0, end: 1.2, why: 'Pause' },
          { start: 5.3, end: 7.7, why: 'Pause' },
          { start: 10.3, end: 12, why: 'Pause' },
        ]);
        expect(
          slipsFrom('Hier: {"cut":[{"id":0,"why":"Abgebrochen"},{"id":9}]}', [
            { start: 1.5, end: 3, text: 'Also hier ist der' },
          ]),
        ).toEqual([{ start: 1.5, end: 3, why: 'Abgebrochen' }]);

        // A video put on a message is read by the AI as what was said when and its stills: the
        // browser hands over stills and sound, the server keeps them beside it.
        const upload = new FormData();
        upload.append('file', new File(['0123456789'], 'erklärt.mp4', { type: 'video/mp4' }));
        const video = (await (
          await speech.request(`/api/workspaces/${speech.workspaceId}/attachments`, {
            method: 'POST',
            body: upload,
          })
        ).json()) as { id: string; name: string; type: string; size: number };
        const still = new Uint8Array([
          0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 2, 0, 3, 1, 0, 0, 0, 0xff, 0xd9,
        ]);
        const digest = new FormData();
        digest.append('still', new File([still], 'a.jpg', { type: 'image/jpeg' }));
        digest.append('still', new File([new Uint8Array(20)], 'b.jpg', { type: 'image/jpeg' }));
        digest.append('at', JSON.stringify([4.2, 9]));
        digest.append('duration', '12');
        digest.append('speech', new File([new Uint8Array(64)], 'ton.wav', { type: 'audio/wav' }));
        const digested = await speech.request(`/api/attachments/${video.id}/digest`, {
          method: 'POST',
          body: digest,
        });
        expect(digested.status).toBe(204);
        const read = await attachmentBlocks(speech.deps, speech.workspaceId, [video]);
        expect(read[0]).toEqual({
          type: 'text',
          text: '<datei name="erklärt.mp4" art="Video" dauer="0:12">\nGesprochen:\n[0:01] Also hier ist der\n[0:03] Plan.\n[0:08] Hier ist der Plan.\n1 Standbilder folgen, je mit ihrer Zeit.\n</datei>',
        });
        // The one that is no JPEG left out. Taken off again, the digest goes with it.
        expect(read.slice(1).map((one) => one.type)).toEqual(['text', 'image']);
        expect(read[1]).toEqual({ type: 'text', text: '[Bild bei 0:04 aus „erklärt.mp4“]' });
        const digests = async () =>
          (
            await speech.deps.storage.list(
              `${blobKeys.workspacePrefix(speech.workspaceId)}attachments/`,
            )
          ).filter((key) => key.endsWith('.digest'));
        expect(await digests()).toHaveLength(1);
        // Only while one may work in its workspace (the speech service is the workspace's).
        await speech.deps.db
          .update(workspaces)
          .set({ blockedAt: new Date() })
          .where(eq(workspaces.id, speech.workspaceId));
        const again = new FormData();
        again.append('duration', '12');
        expect(
          (
            await speech.request(`/api/attachments/${video.id}/digest`, {
              method: 'POST',
              body: again,
            })
          ).status,
        ).toBe(403);
        await speech.deps.db
          .update(workspaces)
          .set({ blockedAt: null })
          .where(eq(workspaces.id, speech.workspaceId));
        await speech.request(`/api/attachments/${video.id}`, { method: 'DELETE' });
        expect(await digests()).toEqual([]);
      } finally {
        await speech.cleanup();
      }
    }
  });
});
