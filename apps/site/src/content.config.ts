import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Accent of a post's category chip, cover glow and table-of-contents marker. */
const accent = z.enum(['powerpoint', 'cyan', 'green', 'violet', 'yellow', 'blue']);

/** What the cover shows – drawn in code, no images. */
const cover = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('versus'), other: z.string() }),
  z.object({ kind: z.literal('ranking') }),
  z.object({ kind: z.literal('version'), label: z.string() }),
  z.object({ kind: z.literal('slide') }),
  z.object({ kind: z.literal('code') }),
]);

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    /** First name of the author; the founder writes as "Robert | Founder". */
    author: z.string().default('Robert'),
    role: z.string().default('Founder'),
    tag: z.enum(['Comparison', 'Customer story', 'Update', 'Guide']),
    accent,
    cover,
    readingTime: z.string(),
    featured: z.boolean().default(false),
    /** Drafts are left out of the build until they are written. */
    draft: z.boolean().default(false),
    /** The boxed short answer at the top of an article. */
    shortAnswer: z.object({ text: z.string(), facts: z.array(z.string()) }).optional(),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    /** Slugs of the posts under "Keep reading". */
    related: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };
