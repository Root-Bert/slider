import type { Viewer, WriteNotesInput, WrittenNotes } from '@slider/shared';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { runToolCall } from './ai-providers';
import { editTarget, fileSlides } from './edits';
import { workspaceAiConnection } from './integration-keys';

/** What one slide's notes may be at most – a few spoken minutes. */
const MAX_NOTES_CHARS = 3_000;
/** What the call reads of the deck at most, slides around the ones to write included. */
const MAX_DECK_CHARS = 60_000;
/** Slides written in one go at most; more stay for the next press. */
const MAX_SLIDES = 30;

const SYSTEM = [
  'You write the speaker notes of a presentation: what the presenter says while a slide is',
  'shown. For each slide asked for, write what to say in 2–5 short sentences of spoken language:',
  'the point of the slide, what to add beyond what is written on it, a bridge to the next slide',
  'where it helps. Do not read the slide out, invent no figures or facts, no stage directions,',
  'no headings, no lists, no Markdown. Write in the language of the slides. Slides with notes',
  'already only give you context.',
].join(' ');

const TOOL = {
  name: 'speaker_notes',
  description: 'The speaker notes for the slides asked for, one entry per slide.',
  input_schema: {
    type: 'object' as const,
    properties: {
      slides: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slide: { type: 'integer', description: 'The slide number as given.' },
            notes: { type: 'string', description: 'What the presenter says; paragraphs by \\n.' },
          },
          required: ['slide', 'notes'],
        },
      },
    },
    required: ['slides'],
  },
};

/**
 * Speaker notes written by the workspace's AI for the deck's slides without notes (variants
 * left out), or for `pageIds` – returned, not put in: the editor applies them as its own step.
 * Needs the right to edit and an AI in the workspace.
 */
export async function writeSpeakerNotes(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: WriteNotesInput,
): Promise<WrittenNotes> {
  const { deck, revision } = await editTarget(deps, viewer, deckId);
  const ai = await workspaceAiConnection(deps, deck.workspaceId);
  if (ai.connection === null) throw new ApiError(409, 'ai_not_configured', ai.error);
  const { slides } = await fileSlides(deps, revision.pptxKey);
  const shown = slides.filter((slide) => slide.pageId && slide.variantOf === null);
  const asked = input.pageIds ? new Set(input.pageIds) : null;
  const wanted = new Set(
    shown
      .filter((slide) => (asked ? asked.has(slide.pageId!) : !slide.notes.trim()))
      .slice(0, MAX_SLIDES)
      .map((slide) => slide.pageId!),
  );
  if (wanted.size === 0) return { notes: [] };

  const numbers = new Map<number, string>();
  const parts = shown.map((slide, index) => {
    const number = index + 1;
    const write = wanted.has(slide.pageId!);
    if (write) numbers.set(number, slide.pageId!);
    const words = slide.elements
      .flatMap((element) => element.paragraphs ?? [])
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    return [
      `## Slide ${number}${write ? ' (write its notes)' : ''}${slide.hidden ? ' (hidden)' : ''}`,
      words || '(no text on it)',
      slide.notes.trim() && !write ? `Its notes: ${slide.notes.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  let deckText = parts.join('\n\n');
  if (deckText.length > MAX_DECK_CHARS) deckText = deckText.slice(0, MAX_DECK_CHARS);

  const answer = await runToolCall(deps, ai.connection, {
    system: SYSTEM,
    tool: TOOL,
    user: `The presentation „${deck.title}“, slide by slide:\n\n${deckText}`,
    maxTokens: Math.min(12_000, 600 + wanted.size * 350),
    signal: AbortSignal.timeout(60_000),
    feature: 'edit',
  }).catch((error: unknown) => {
    deps.log.warn(`Speaker notes for deck ${deck.id} failed`, error);
    throw new ApiError(
      502,
      'internal',
      'Die KI ist gerade nicht erreichbar. Versuch es noch einmal.',
    );
  });
  const written =
    answer && typeof answer === 'object' && Array.isArray((answer as { slides?: unknown }).slides)
      ? (answer as { slides: unknown[] }).slides
      : [];
  const notes = new Map<string, string>();
  for (const entry of written) {
    if (!entry || typeof entry !== 'object') continue;
    const { slide, notes: text } = entry as { slide?: unknown; notes?: unknown };
    const pageId = typeof slide === 'number' ? numbers.get(slide) : undefined;
    if (!pageId || typeof text !== 'string' || !text.trim()) continue;
    notes.set(pageId, text.trim().slice(0, MAX_NOTES_CHARS));
  }
  if (notes.size === 0) {
    throw new ApiError(
      502,
      'internal',
      'Die KI hat keine Notizen geschrieben. Versuch es noch einmal.',
    );
  }
  return { notes: [...notes].map(([pageId, text]) => ({ pageId, text })) };
}
