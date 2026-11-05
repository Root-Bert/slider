import { z } from 'zod';

export const showRunSchema = z.object({
  at: z.string().datetime(),
  total: z.number().finite().nonnegative(),
  rows: z
    .array(
      z.object({
        slideId: z.string().max(200),
        number: z.number().int().positive(),
        title: z.string().max(2000).nullable(),
        thumbnailUrl: z.string().max(4000),
        aspectRatio: z.number().finite().positive(),
        ms: z.number().finite().nonnegative(),
        skipped: z.boolean(),
      }),
    )
    .max(1000),
});
export type ShowRun = z.infer<typeof showRunSchema>;
export type ShowRunRow = ShowRun['rows'][number];
export type SavedShowRun = ShowRun & { id: string; recordingUrl: string | null };
