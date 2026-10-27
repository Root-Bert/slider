import { and, asc, inArray, isNull } from 'drizzle-orm';
import {
  DECK_SEARCH_HITS_PER_DECK,
  searchFold,
  type DeckSearchHit,
  type DeckSearchResult,
} from '@slider/shared';
import { openToViewer, type DeckViewerAccess } from '../auth/access';
import { comments, decks, slideVersions } from '../db/schema';
import type { AppDeps } from '../deps';

/** Characters of context before the match in a snippet, and the snippet's length at most. */
const SNIPPET_BEFORE = 40;
const SNIPPET_LENGTH = 140;

/**
 * Text search through the decks of workspaces (BER-175): the slides of each deck's current
 * version (titles and box texts) and its comments and replies. Titles stay with the overview,
 * which filters them itself. The text is encrypted at rest (BER-149), so there is no index to
 * ask: the rows are read – decrypted by their column types – and compared here, only for the
 * decks a restriction doesn't keep from the caller. Matching ignores case and accents
 * ({@link searchFold}), like the title filter. The overview sorts the decks itself.
 */
export async function searchDecks(
  { db }: Pick<AppDeps, 'db'>,
  workspaceIds: readonly string[],
  access: DeckViewerAccess,
  query: string,
): Promise<DeckSearchResult[]> {
  const needle = searchFold(query.replace(/\s+/g, ' ').trim());
  if (workspaceIds.length === 0 || needle === '') return [];
  const deckRows = await db
    .select({ id: decks.id, currentRevisionId: decks.currentRevisionId })
    .from(decks)
    .where(and(inArray(decks.workspaceId, [...workspaceIds]), openToViewer(access)))
    .orderBy(asc(decks.createdAt));
  if (deckRows.length === 0) return [];
  const deckIds = deckRows.map((deck) => deck.id);
  const deckOfRevision = new Map(
    deckRows.flatMap((deck) => (deck.currentRevisionId ? [[deck.currentRevisionId, deck.id]] : [])),
  );

  const [slideRows, commentRows] = await Promise.all([
    deckOfRevision.size === 0
      ? []
      : db
          .select({
            revisionId: slideVersions.revisionId,
            slideId: slideVersions.slideId,
            position: slideVersions.position,
            title: slideVersions.title,
            shapes: slideVersions.shapes,
          })
          .from(slideVersions)
          .where(inArray(slideVersions.revisionId, [...deckOfRevision.keys()]))
          .orderBy(asc(slideVersions.position)),
    db
      .select({
        deckId: comments.deckId,
        slideId: comments.slideId,
        author: comments.author,
        body: comments.body,
      })
      .from(comments)
      .where(
        and(
          inArray(comments.deckId, deckIds),
          // PowerPoint comments deleted in the file are kept, but shown nowhere (BER-114).
          isNull(comments.removedInSourceAt),
        ),
      )
      .orderBy(asc(comments.createdAt)),
  ]);

  const found = new Map<string, { hitCount: number; hits: DeckSearchHit[] }>();
  const add = (deckId: string, hit: DeckSearchHit) => {
    const entry = found.get(deckId) ?? { hitCount: 0, hits: [] };
    entry.hitCount += 1;
    if (entry.hits.length < DECK_SEARCH_HITS_PER_DECK) entry.hits.push(hit);
    found.set(deckId, entry);
  };

  // Slide numbers of the current versions, also for the comments on those slides.
  const slideNumbers = new Map<string, number>();
  const ordinal = new Map<string, number>();
  for (const row of slideRows) {
    const deckId = deckOfRevision.get(row.revisionId)!;
    const number = (ordinal.get(deckId) ?? 0) + 1;
    ordinal.set(deckId, number);
    slideNumbers.set(row.slideId, number);
  }
  for (const row of slideRows) {
    // One hit per slide: its title is usually also the text of a box.
    for (const text of [row.title ?? '', ...row.shapes.map((shape) => shape.text)]) {
      const snippet = snippetOf(text, needle);
      if (!snippet) continue;
      add(deckOfRevision.get(row.revisionId)!, {
        kind: 'slide',
        slideId: row.slideId,
        slideNumber: slideNumbers.get(row.slideId) ?? null,
        author: null,
        ...snippet,
      });
      break;
    }
  }
  for (const row of commentRows) {
    const snippet = snippetOf(row.body, needle);
    if (!snippet) continue;
    const slideNumber = row.slideId ? (slideNumbers.get(row.slideId) ?? null) : null;
    add(row.deckId, {
      kind: 'comment',
      slideId: slideNumber === null ? null : row.slideId,
      slideNumber,
      author: row.author.name,
      ...snippet,
    });
  }

  return deckIds.flatMap((deckId) => {
    const entry = found.get(deckId);
    return entry ? [{ deckId, ...entry }] : [];
  });
}

/**
 * The text around the first match of `needle` (already folded), on one line, cut with "…" –
 * or `null` without a match. Folding can change lengths (`ﬁ` → `fi`), so every folded character
 * remembers the original one it came from, and the match is cut from the original text.
 */
export function snippetOf(
  raw: string,
  needle: string,
): Pick<DeckSearchHit, 'snippet' | 'matchStart' | 'matchLength'> | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!needle || !searchFold(text).includes(needle)) return null;
  let folded = '';
  const origin: number[] = [];
  for (let index = 0; index < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(index)!);
    const fold = searchFold(char);
    folded += fold;
    for (let unit = 0; unit < fold.length; unit += 1) origin.push(index);
    index += char.length;
  }
  const at = folded.indexOf(needle);
  if (at < 0) return null;
  const start = origin[at]!;
  const last = origin[at + needle.length - 1]!;
  const end = last + String.fromCodePoint(text.codePointAt(last)!).length;

  // Cut between words: after the first space past the window's start, before the last in its end.
  let from = Math.max(0, start - SNIPPET_BEFORE);
  const space = from > 0 ? text.indexOf(' ', from) : -1;
  if (space >= 0 && space < start) from = space + 1;
  let to = Math.min(text.length, Math.max(end, from + SNIPPET_LENGTH));
  const lastSpace = to < text.length ? text.lastIndexOf(' ', to) : -1;
  if (lastSpace >= end) to = lastSpace;
  const cut = text.slice(from, to);
  const leading = cut.length - cut.trimStart().length;
  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  return {
    snippet: `${prefix}${cut.trim()}${suffix}`,
    matchStart: prefix.length + start - from - leading,
    matchLength: end - start,
  };
}
