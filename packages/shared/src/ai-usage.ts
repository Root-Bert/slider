import { z } from 'zod';

/**
 * What the AI used on the instance (`/instanz` → „KI“): every request to an AI service is
 * written down with its tokens, seconds of audio or pictures as the service's answer tells them
 * – per workspace, and whether it ran on the instance's key or on one of the workspace's own.
 * No money: list prices are guesses, only what is measured is shown.
 */

/** What a request was for – the dashboard names them. */
export const AI_FEATURES = ['edit', 'summary', 'voice', 'live', 'recording', 'image'] as const;
export const aiFeatureSchema = z.enum(AI_FEATURES);
export type AiFeature = z.infer<typeof aiFeatureSchema>;

/** One stretch of the window: what the AI used in it. */
export const aiUsageBucketSchema = z.object({
  start: z.iso.datetime(),
  tokens: z.number().int(),
  audioSeconds: z.number(),
  images: z.number().int(),
  requests: z.number().int(),
});
export type AiUsageBucket = z.infer<typeof aiUsageBucketSchema>;

/** Sums of one group of requests (all of them, one feature, one model, one workspace). */
export const aiUsageSumSchema = z.object({
  requests: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  /** Read from / written to the provider's prompt cache – part of the input. */
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  audioSeconds: z.number(),
  images: z.number().int(),
});
export type AiUsageSum = z.infer<typeof aiUsageSumSchema>;

/**
 * What the AI did in the window, counted from what it left in the decks (decks deleted since are
 * gone from it): asked from a comment or for a variant, and how each request ended.
 */
export const aiWorkSchema = z.object({
  /** Requests to change slides (from a comment, spoken, or „Variante erstellen“). */
  asked: z.number().int(),
  /** Its change is in the deck. */
  kept: z.number().int(),
  /** Its change was taken back. */
  reverted: z.number().int(),
  /** Answered without a change (a reply or a question only). */
  unchanged: z.number().int(),
  /** Failed or stopped. */
  failed: z.number().int(),
  /** Comments the AI left on its own (stickers included). */
  comments: z.number().int(),
});
export type AiWork = z.infer<typeof aiWorkSchema>;

/**
 * `GET /instance/ai-usage?interval=&to=`: the AI's use in the dashboard's window (the same query
 * as the timeline). Workspaces by name and amounts only – never what was asked.
 */
export const instanceAiUsageSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  buckets: z.array(aiUsageBucketSchema),
  total: aiUsageSumSchema,
  /** Of `total`, what ran on the instance's own keys. */
  instanceKeys: aiUsageSumSchema,
  byFeature: z.array(aiUsageSumSchema.extend({ feature: aiFeatureSchema })),
  /** Most used first: by requests, then tokens, minutes of audio, pictures. */
  byModel: z.array(aiUsageSumSchema.extend({ provider: z.string(), model: z.string() })),
  /** The workspaces that used the AI the most (as `byModel`), most first. */
  byWorkspace: z.array(
    aiUsageSumSchema.extend({
      id: z.string(),
      name: z.string(),
      logoUrl: z.string().nullable(),
    }),
  ),
  work: aiWorkSchema,
});
export type InstanceAiUsage = z.infer<typeof instanceAiUsageSchema>;
