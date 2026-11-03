import { z } from 'zod';
import { MAX_MEDIA_PEAKS, pointSchema } from './model';

/*
 * Speaking to the AI (the AI's avatar, bottom right): the microphone stays open while the person
 * goes through the slides and says what they think. The browser cuts the speech at its pauses
 * into short pieces (voice activity detection), each one goes to the server with what was on
 * screen while it was said; the server turns it into text, and a fast model decides what it is –
 * a new comment at a place, more of the one being said, an addition to one already sent, a
 * command – while the person goes on speaking. A finished comment goes to the AI right away.
 */

/** A piece of speech the browser sends (16 kHz mono WAV, 16 bit): at most this big. */
export const MAX_VOICE_SEGMENT_BYTES = 2 * 1024 * 1024;
/** The comment's recording, made of its pieces in the browser: at most this big. */
export const MAX_VOICE_CLIP_BYTES = 8 * 1024 * 1024;

/** Where the pointer rested on a slide while a piece was said – summed over the piece. */
export const voicePointerSchema = z.object({
  slideId: z.string().max(100),
  /** The element under it (the slide's shape id), or `null` over the slide's background. */
  shapeId: z.string().max(200).nullable(),
  /** Its mean position, normalised to the slide. */
  point: pointSchema,
  /** How long it rested there, ms. */
  ms: z.number().int().nonnegative().max(600_000),
});
export type VoicePointer = z.infer<typeof voicePointerSchema>;

/** What was on screen while a piece of speech was said. */
export const voiceContextSchema = z.object({
  /** The slides in front, with how long each one was (ms) – in the order they were shown. */
  slides: z
    .array(
      z.object({
        slideId: z.string().max(100),
        ms: z.number().int().nonnegative().max(600_000),
      }),
    )
    .max(50),
  /** Where the pointer rested, longest first. */
  pointer: z.array(voicePointerSchema).max(20),
  /** The element picked in the editor, if any. */
  selection: z.object({ slideId: z.string().max(100), elementId: z.string().max(200) }).nullable(),
  /** The slide in front when the piece ended. */
  activeSlideId: z.string().max(100).nullable(),
});
export type VoiceContext = z.infer<typeof voiceContextSchema>;

/** The form field `meta` next to a piece's audio (`audio`). */
export const voiceSegmentMetaSchema = z.object({
  /** Counts up from 0 per session: pieces are worked through in this order. */
  seq: z.number().int().nonnegative().max(100_000),
  /** When it began and ended, ms since the session started. */
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  context: voiceContextSchema,
  /**
   * What the live stream heard of it, when the browser streams one: the router decides on these
   * words at once; the accurate text speech to text makes of the piece comes after.
   */
  liveText: z.string().max(5_000).optional(),
});
export type VoiceSegmentMeta = z.infer<typeof voiceSegmentMetaSchema>;

/** Where a spoken comment is in its life. */
export const voiceItemStateSchema = z.enum([
  /** Still being said – more may come. */
  'draft',
  /** Finished; waits for its slide's earlier request to the AI. */
  'queued',
  /** The AI works on it. */
  'working',
  /** The AI changed the slides. */
  'applied',
  /** The AI changed nothing (it answered in the thread). */
  'answered',
  /** A comment only: the AI cannot change this deck (or may not here). */
  'comment',
  /** The AI failed or was stopped. */
  'failed',
  /** Taken back by voice („vergiss das“) – the comment is gone. */
  'dropped',
  /** The AI's change was taken back by voice. */
  'reverted',
]);
export type VoiceItemState = z.infer<typeof voiceItemStateSchema>;

/** A comment said in the session – a new one, or an addition to one (a reply in its thread). */
export const voiceItemSchema = z.object({
  /** The comment (the root, or the reply that adds to it). */
  commentId: z.string(),
  /** Its thread's root. */
  threadId: z.string(),
  slideId: z.string().nullable(),
  /** What it says so far. */
  text: z.string(),
  state: voiceItemStateSchema,
  /** The AI's request for it, once asked. */
  proposalId: z.string().nullable(),
  /** Why it failed or stays a comment only. */
  note: z.string().nullable(),
  /** The pieces it was said in (their `seq`): the browser makes its recording of them. */
  segments: z.array(z.number().int()),
  /** Whether its recording is attached already. */
  hasRecording: z.boolean(),
  createdAt: z.string(),
});
export type VoiceItem = z.infer<typeof voiceItemSchema>;

/** What a piece of speech came to. */
export const voiceSegmentResultSchema = z.object({
  seq: z.number().int(),
  /** Its text – empty when nothing was understood. */
  text: z.string(),
  status: z.enum(['done', 'empty', 'failed']),
  /** Why it failed. */
  error: z.string().nullable(),
  /** The pieces it stands for – itself, and those heard together with it. */
  seqs: z.array(z.number().int()),
  /** Whether speech to text is done with it (until then `text` is empty). */
  heard: z.boolean(),
});
export type VoiceSegmentResult = z.infer<typeof voiceSegmentResultSchema>;

/** Things to do in the browser that the person asked for by voice. */
export const voiceCommandSchema = z.discriminatedUnion('type', [
  /** „Nächste Folie“, „geh zu Folie 5“. */
  z.object({ type: z.literal('goToSlide'), slideId: z.string() }),
  /** „Stopp, fertig“: the session ends. */
  z.object({ type: z.literal('stop') }),
]);
export type VoiceCommand = z.infer<typeof voiceCommandSchema>;

export const voiceSessionSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  /** Whether finished comments go to the AI (it may change this deck). */
  aiEdits: z.boolean(),
  /** Why they do not. */
  aiEditsReason: z.string().nullable(),
  /** Who turns the speech into text, by name („Mistral“, a self-hosted one's host). */
  speechService: z.string(),
  items: z.array(voiceItemSchema),
  /** The latest pieces, oldest first. */
  segments: z.array(voiceSegmentResultSchema),
  /**
   * Commands of the last minute, numbered: several answers may carry the same one, the browser
   * does each number once.
   */
  commands: z.array(z.object({ id: z.number().int(), command: voiceCommandSchema })),
  /** Pieces still being worked on. */
  pending: z.number().int(),
  ended: z.boolean(),
});
export type VoiceSession = z.infer<typeof voiceSessionSchema>;

/**
 * `POST /voice/:sessionId/live` – where the browser streams the microphone to show the words as
 * they are spoken (the workspace's `live` key): the service's WebSocket, a token for it that
 * soon expires (asked anew for each connection) and the words to listen for. `null` without a
 * `live` key – then only what `voice` made of the pieces is shown.
 */
export const voiceLiveSchema = z
  .object({
    provider: z.literal('mistral'),
    url: z.string(),
    token: z.string(),
    expiresAt: z.string(),
    terms: z.array(z.string()),
  })
  .nullable();
export type VoiceLive = z.infer<typeof voiceLiveSchema>;

/** The recording of a spoken comment, made in the browser: `meta` next to the file `audio`. */
export const voiceClipMetaSchema = z.object({
  durationMs: z
    .number()
    .int()
    .positive()
    .max(30 * 60_000),
  peaks: z.array(z.number().min(0).max(1)).max(MAX_MEDIA_PEAKS),
});
export type VoiceClipMeta = z.infer<typeof voiceClipMetaSchema>;
