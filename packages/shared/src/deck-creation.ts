import { z } from 'zod';

/*
 * A new deck built by the AI from a prompt on Folie 1 (phase 3 of the material board): what
 * kind of deck, how many slides, which of the workspace's templates – and the run's progress.
 * The material on Folie 0 is always read; there is no switch for it.
 */

/**
 * The kinds of deck the prompt offers, in the order shown: one word on its card, the longer
 * meaning as its tooltip; each has a build guide on the server (`deck-creation/kinds.ts`).
 */
export const DECK_KINDS = [
  { id: 'school', label: 'Schule', meaning: 'Schule und Referat', pages: 8 },
  { id: 'pitch', label: 'Pitch', meaning: 'Pitch für Investoren', pages: 12 },
  { id: 'consulting', label: 'Consulting', meaning: 'Consulting und Strategie', pages: 12 },
  { id: 'brand', label: 'Marke', meaning: 'Marke und Firmenvorstellung', pages: 10 },
  { id: 'sales', label: 'Vertrieb', meaning: 'Vertrieb und Angebot', pages: 10 },
  { id: 'status', label: 'Status', meaning: 'Projektstatus und Bericht', pages: 8 },
  { id: 'training', label: 'Workshop', meaning: 'Training und Workshop', pages: 12 },
  { id: 'keynote', label: 'Vortrag', meaning: 'Vortrag und Keynote', pages: 10 },
] as const;

export type DeckKind = (typeof DECK_KINDS)[number]['id'];
export const deckKindSchema = z.enum(
  DECK_KINDS.map((kind) => kind.id) as [DeckKind, ...DeckKind[]],
);
/** Picked when the prompt opens. */
export const DEFAULT_DECK_KIND: DeckKind = 'keynote';

export const MIN_CREATED_SLIDES = 5;
export const MAX_CREATED_SLIDES = 30;
export const MAX_CREATION_PROMPT_LENGTH = 8_000;

/** `POST /decks/:id/creation`: build the deck. `templateId` `null`: Slider's own look. */
export const startDeckCreationInputSchema = z.object({
  description: z.string().trim().min(1).max(MAX_CREATION_PROMPT_LENGTH),
  kind: deckKindSchema,
  pages: z.number().int().min(MIN_CREATED_SLIDES).max(MAX_CREATED_SLIDES),
  templateId: z.string().max(100).nullable(),
});
export type StartDeckCreationInput = z.infer<typeof startDeckCreationInputSchema>;

/** A slide of the outline the AI writes first. */
export const outlineSlideSchema = z.object({
  title: z.string(),
  /** The one thing the slide says. */
  message: z.string(),
  /** What kind of slide: „Titel“, „Aufzählung“, „Zahlen“, „Bild und Text“ … in the deck's language. */
  layout: z.string(),
});
export type OutlineSlide = z.infer<typeof outlineSlideSchema>;

/**
 * - `offered`: a new deck – Folie 1 shows the prompt while the deck is still its blank start;
 * - `dismissed`: „Leer anfangen“ – never shown again;
 * - `running`: the AI reads, outlines, builds slide after slide;
 * - `done`, `failed`, `cancelled`: what it built stays (failed or cancelled before a slide was
 *   built: the prompt shows again).
 */
export const DECK_CREATION_STATUSES = [
  'offered',
  'dismissed',
  'running',
  'done',
  'failed',
  'cancelled',
] as const;
export type DeckCreationStatus = (typeof DECK_CREATION_STATUSES)[number];

/** `GET /decks/:id/creation` – `null` for decks never offered one. */
export const deckCreationSchema = z.object({
  status: z.enum(DECK_CREATION_STATUSES),
  /** The prompt shows on Folie 1: offered (or ended before a slide) and the deck still blank. */
  prompt: z.boolean(),
  kind: deckKindSchema.nullable(),
  pages: z.number().int().nullable(),
  templateId: z.string().nullable(),
  /** Written once the AI has read what it needs. */
  outline: z.array(outlineSlideSchema).nullable(),
  /** Slides built so far. */
  built: z.number().int().nonnegative(),
  /** What it is doing right now, in a few words („Liest das Material“); `null` when not running. */
  step: z.string().nullable(),
  error: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type DeckCreation = z.infer<typeof deckCreationSchema>;
