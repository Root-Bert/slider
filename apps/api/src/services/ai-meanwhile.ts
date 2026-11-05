import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { OdpDocument } from '@slider/odp';
import { withChildren, type SlideOperation } from '@slider/shared';
import { aiProposals, deckEdits, revisions, users } from '../db/schema';
import type { AppDeps } from '../deps';

/**
 * What an AI run hears between its turns of what others changed on the deck meanwhile – people
 * in the editor, other requests to the AI. Read from the deck's steps (one small query a turn,
 * the steps only when the revision moved on), told in a few lines at the end of the next input:
 * nothing in the cached part before it changes, no extra turn, no extra model call.
 */

/** Where the run last looked: the revision's step and file then. */
export interface Seen {
  seq: number;
  key: string | null;
}

/** Most lines told at once – the rest counted. */
const MAX_LINES = 12;
/** Most steps read at once. */
const MAX_STEPS = 30;

const WHAT: Record<SlideOperation['type'], string> = {
  setText: 'text changed',
  setRichText: 'text changed',
  setBox: 'moved or resized',
  setShapeStyle: 'look changed (fill, border or text style)',
  addElement: 'added',
  addImage: 'picture added',
  copyElement: 'copied',
  replaceImage: 'picture replaced',
  setTilt: 'tilted',
  setLocked: 'locked or unlocked',
  setCornerRadius: 'corners changed',
  setImageFit: 'picture fit changed',
  deleteElement: 'deleted',
  moveElement: 'moved in front or behind',
  groupElements: 'grouped',
  ungroupElements: 'ungrouped',
  deleteSlide: 'removed',
  setSlideHidden: 'hidden or shown',
  setSlideBackground: 'background changed',
  setSlideTransition: 'transition changed',
  moveSlide: 'moved',
  duplicateSlide: 'copied',
  addSlide: 'added',
  setSlideNotes: 'notes changed',
  addVariant: 'variant added',
  useVariant: 'variant used instead',
};

/** The request's last message, short, and who asked: „Name [points at …]: words“. */
const requestOf = (prompt: string) => {
  const last = prompt.split('\n\n').at(-1)?.trim() ?? '';
  const said = /^([^:[\n]{1,80}?)(?: \[[^\]\n]*\])?: ([\s\S]*)$/.exec(last);
  const words = (said?.[2] ?? last).trim();
  const short = words.length > 60 ? `${words.slice(0, 60)}…` : words;
  return `request „${short}“${said ? ` by ${said[1]!.trim()}` : ''}`;
};

/**
 * The lines of what changed since `seen` – none when nothing did – and where the run has looked
 * now. `base`: the file the run began on, to name slides and elements by.
 */
export async function changedMeanwhile(
  deps: AppDeps,
  revisionId: string,
  base: OdpDocument,
  seen: Seen,
): Promise<{ lines: string[]; seen: Seen }> {
  const [now] = await deps.db
    .select({ seq: revisions.editSeq, key: revisions.pptxKey })
    .from(revisions)
    .where(eq(revisions.id, revisionId));
  if (!now || (now.seq === seen.seq && now.key === seen.key)) return { lines: [], seen };
  // Gone back (undo): the steps between are taken back; else they are new.
  const back = now.seq < seen.seq;
  const [from, to] = back ? [now.seq, seen.seq] : [seen.seq, now.seq];
  const steps = await deps.db
    .select({
      operations: deckEdits.operations,
      source: deckEdits.source,
      author: users.name,
      prompt: aiProposals.prompt,
      changes: aiProposals.changes,
    })
    .from(deckEdits)
    .leftJoin(users, eq(users.id, deckEdits.authorId))
    .leftJoin(aiProposals, eq(aiProposals.appliedEditId, deckEdits.id))
    .where(
      and(eq(deckEdits.revisionId, revisionId), gt(deckEdits.seq, from), lte(deckEdits.seq, to)),
    )
    .orderBy(asc(deckEdits.seq))
    .limit(MAX_STEPS);

  const pageIds = base.pageIds();
  const slideOf = new Map<string, number>();
  const nameOf = new Map<string, string>();
  for (const slide of base.slides()) {
    for (const element of withChildren(slide.elements)) {
      slideOf.set(element.id, slide.index);
      if (element.name) nameOf.set(element.id, element.name);
    }
  }
  const slideLabel = (index: number | undefined) =>
    index === undefined || index < 0 ? 'a new slide' : `slide ${index + 1}`;
  const pageLabel = (pageId: string) => slideLabel(pageIds.indexOf(pageId));
  const elementLabel = (id: string) =>
    `${slideLabel(slideOf.get(id))}, element ${id}${nameOf.has(id) ? ` (${nameOf.get(id)})` : ''}`;

  const lines: string[] = [];
  for (const step of steps) {
    if (step.source === 'original') continue;
    const who =
      step.source === 'ai'
        ? step.prompt
          ? requestOf(step.prompt)
          : 'the AI'
        : (step.author ?? 'someone');
    const what = new Set<string>();
    for (const op of step.operations) {
      if (op.type === 'addElement' || op.type === 'addImage') {
        slideOf.set(op.elementId, pageIds.indexOf(op.pageId));
      }
      const place =
        op.type === 'groupElements'
          ? `${slideLabel(slideOf.get(op.elementIds[0]!))}, elements ${op.elementIds.slice(0, 4).join(', ')}`
          : op.type === 'addSlide'
            ? 'a new slide'
            : 'elementId' in op && op.type !== 'copyElement'
              ? elementLabel(op.elementId)
              : 'pageId' in op
                ? pageLabel(op.pageId)
                : 'the deck';
      what.add(`${place}: ${WHAT[op.type]}`);
    }
    if (step.operations.length === 0) {
      for (const change of step.changes ?? []) {
        const word =
          change.before === null ? 'added' : change.after === null ? 'removed' : 'changed';
        what.add(`${change.before === null ? 'a new slide' : slideLabel(change.index)}: ${word}`);
      }
      if (what.size === 0) what.add('slides changed');
    }
    for (const line of what) lines.push(`- ${back ? 'taken back – ' : ''}${line} (${who})`);
  }
  if (lines.length === 0) lines.push('- the deck changed (a step taken back and another made)');
  const told =
    lines.length > MAX_LINES
      ? [...lines.slice(0, MAX_LINES - 1), `- … and ${lines.length - MAX_LINES + 1} more changes`]
      : lines;
  return { lines: told, seen: { seq: now.seq, key: now.key } };
}

/** The text block told to the AI – `null` when nothing changed. */
export const meanwhileNote = (lines: readonly string[]): string | null =>
  lines.length === 0
    ? null
    : `Meanwhile on the deck – others changed it since you last looked. Your copy still shows the deck as before; when saved, your change is merged with theirs element by element and attribute by attribute, so leave what they changed to them unless your request is about it:\n${lines.join('\n')}`;
