import {
  deckKindSchema,
  MAX_CREATED_SLIDES,
  MAX_CREATION_PROMPT_LENGTH,
  MIN_CREATED_SLIDES,
  type DeckKind,
} from '@slider/shared';
import { readJson, writeJson, writeString } from '@/lib/storage';

/*
 * What is typed into Folie 1's prompt, kept per deck in this browser: it survives the window
 * going (Bearbeiten and back, the track scrolled far away) and a reload – until „Erstellen“ or
 * „Leer anfangen“ clears it.
 */

export interface CreationDraft {
  description: string;
  kind: DeckKind | null;
  /** `null`: the kind's suggestion. */
  pages: number | null;
  /** `null`: not picked – the deck's own template. */
  templateId: string | null;
}

/** A stored draft as far as it is one; anything else throws (`readJson` falls back). */
function parseDraft(value: unknown): CreationDraft {
  const raw = value as Partial<Record<keyof CreationDraft, unknown>>;
  if (typeof raw !== 'object' || raw === null || typeof raw.description !== 'string')
    throw new Error('no draft');
  const pages =
    typeof raw.pages === 'number' &&
    Number.isInteger(raw.pages) &&
    raw.pages >= MIN_CREATED_SLIDES &&
    raw.pages <= MAX_CREATED_SLIDES
      ? raw.pages
      : null;
  const kind = deckKindSchema.safeParse(raw.kind);
  return {
    description: raw.description.slice(0, MAX_CREATION_PROMPT_LENGTH),
    kind: kind.success ? kind.data : null,
    pages,
    templateId: typeof raw.templateId === 'string' ? raw.templateId.slice(0, 100) : null,
  };
}

export const EMPTY_CREATION_DRAFT: CreationDraft = {
  description: '',
  kind: null,
  pages: null,
  templateId: null,
};

const keyOf = (deckId: string) => `slider.creationDraft.${deckId}`;

export const loadCreationDraft = (deckId: string): CreationDraft =>
  readJson(keyOf(deckId), parseDraft, EMPTY_CREATION_DRAFT);

/** Stored as it changes; an empty one is not kept. */
export function saveCreationDraft(deckId: string, draft: CreationDraft): void {
  const empty =
    !draft.description.trim() && !draft.kind && draft.pages === null && !draft.templateId;
  if (empty) clearCreationDraft(deckId);
  else writeJson(keyOf(deckId), draft);
}

export const clearCreationDraft = (deckId: string): void => writeString(keyOf(deckId), null);
