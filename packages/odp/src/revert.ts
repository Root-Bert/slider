import type { OdpDocument } from './document';
import { mergeSlide, sameSlide } from './merge';

/*
 * Taking back one change of a deck – one person's undo – while others went on changing it: what
 * the change did goes back slide by slide, merged three ways with what came since, so the others'
 * changes stay. A slide someone changed the same way meanwhile stays as it is (a conflict).
 */

/** What taking a change back did. */
export interface RevertOutcome {
  /** Something went back: the document changed. */
  changed: boolean;
  /** Slides left as they are – someone changed the same things since. */
  conflicts: number;
}

/**
 * Pages of `after` that moved against `before`: of the pages both have, those not in their
 * longest common order. Page ids are unique, so both hold the same pages in another order and
 * that order is the longest run of `after` whose places in `before` rise – found by patience
 * sorting in n log n, so an undo on a deck of thousands of slides stays quick.
 */
function movedPages(before: readonly string[], after: readonly string[]): Set<string> {
  const inBoth = new Set(after);
  const a = before.filter((id) => inBoth.has(id));
  const placeOf = new Map(a.map((id, index) => [id, index]));
  const b = after.filter((id) => placeOf.has(id));
  const places = b.map((id) => placeOf.get(id) as number);
  /** `tails[k]`: index in `b` of the smallest last place of a rising run of length k + 1. */
  const tails: number[] = [];
  const previous = new Array<number>(b.length).fill(-1);
  for (let j = 0; j < places.length; j += 1) {
    const place = places[j] as number;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((places[tails[middle] as number] as number) < place) low = middle + 1;
      else high = middle;
    }
    if (low > 0) previous[j] = tails[low - 1] as number;
    tails[low] = j;
  }
  const kept = new Set<string>();
  for (let j = tails.at(-1) ?? -1; j !== -1; j = previous[j] as number) kept.add(b[j] as string);
  return new Set(a.filter((id) => !kept.has(id)));
}

const same = (a: string, b: string) => a === b || sameSlide(a, b);

/**
 * Takes the change from `before` to `after` back in `document` (the deck now, which came from
 * `after` and maybe others' changes since). Slides it rewrote get their XML of before, merged
 * with what changed since; slides it added go, unless changed since; slides it removed come back,
 * and slides it moved go back – unless someone moved them again since –, after the slide
 * before them in `before`. Styles and pictures the slides need come
 * along from `before`. All three must have their page ids (`ensureIds`).
 */
export async function revertChange(
  document: OdpDocument,
  before: OdpDocument,
  after: OdpDocument,
): Promise<RevertOutcome> {
  const was = before.pageIds();
  const became = after.pageIds();
  const now = document.pageIds();
  const moved = movedPages(was, became);
  /** Pages moved since the change (against `after`): one the change moved too stays put. */
  const movedSince = moved.size > 0 ? movedPages(became, now) : new Set<string>();
  const indexOf = (ids: readonly string[]) => new Map(ids.map((id, index) => [id, index]));
  const wasAt = indexOf(was);
  const becameAt = indexOf(became);
  const nowAt = indexOf(now);
  /** A slide's XML, read only once it is compared (most slides of a big deck never are). */
  const xmlOf = (doc: OdpDocument, at: Map<string, number>, id: string) => {
    const index = at.get(id);
    return index === undefined ? null : doc.slideXml(index);
  };

  let conflicts = 0;
  const removed = new Set<string>();
  /** Slides that go (back) to where they were in `before`. */
  const placed = new Set<string>();
  const written = new Map<string, string>();
  for (const pageId of new Set([...was, ...became])) {
    const inBefore = wasAt.has(pageId);
    const inAfter = becameAt.has(pageId);
    const inNow = nowAt.has(pageId);
    if (!inBefore && inAfter) {
      // Added by the change: goes, unless someone changed it since.
      if (!inNow) continue;
      const to = xmlOf(after, becameAt, pageId) as string;
      if (same(to, xmlOf(document, nowAt, pageId) as string)) removed.add(pageId);
      else conflicts += 1;
    } else if (inBefore && !inAfter) {
      // Removed by the change: comes back.
      const from = xmlOf(before, wasAt, pageId) as string;
      if (!inNow) {
        written.set(pageId, from);
        placed.add(pageId);
      } else if (!same(from, xmlOf(document, nowAt, pageId) as string)) conflicts += 1;
    } else if (inBefore && inAfter) {
      if (!inNow) {
        // Someone removed it since: nothing to take back on it.
        if (moved.has(pageId)) conflicts += 1;
        else if (!same(xmlOf(before, wasAt, pageId)!, xmlOf(after, becameAt, pageId)!)) {
          conflicts += 1;
        }
        continue;
      }
      // Moved by the change: goes back – unless someone moved it again since. Then it stays
      // where they put it, a conflict, and only what else the change did on it goes back.
      let conflict = moved.has(pageId) && movedSince.has(pageId);
      if (moved.has(pageId) && !conflict) placed.add(pageId);
      const from = xmlOf(before, wasAt, pageId) as string;
      const to = xmlOf(after, becameAt, pageId) as string;
      if (from !== to && !same(from, to)) {
        const current = xmlOf(document, nowAt, pageId) as string;
        const merged = mergeSlide(to, from, current);
        if (merged.xml === null) {
          // Left as it is – where it is too.
          conflict = true;
          placed.delete(pageId);
        } else if (!same(merged.xml, current)) written.set(pageId, merged.xml);
      }
      if (conflict) conflicts += 1;
    }
  }

  // Everyone else keeps their order; the slides placed go after the one before them in `before`
  // that is in the deck by then. Walking `before` once: `anchor` is that slide for the next one
  // placed, and what goes after which slide is chained (each slide is followed by one at most).
  const order = now.filter((id) => !removed.has(id) && !placed.has(id));
  const inOrder = new Set(order);
  const placedAfter = new Map<string | null, string>();
  let anchor: string | null = null;
  for (const pageId of was) {
    if (placed.has(pageId)) {
      placedAfter.set(anchor, pageId);
      inOrder.add(pageId);
      anchor = pageId;
    } else if (inOrder.has(pageId)) anchor = pageId;
  }
  if (placedAfter.size > 0) {
    const arranged: string[] = [];
    const follow = (from: string | null) => {
      for (let id = placedAfter.get(from); id !== undefined; id = placedAfter.get(id)) {
        arranged.push(id);
      }
    };
    follow(null);
    for (const id of order) {
      arranged.push(id);
      follow(id);
    }
    order.splice(0, order.length, ...arranged);
  }
  const reordered = order.length !== now.length || order.some((id, i) => id !== now[i]);
  if (written.size === 0 && !reordered) return { changed: false, conflicts };
  // A deck keeps a slide: taking back the change that added the only one leaves it.
  if (order.length === 0) return { changed: false, conflicts: conflicts + 1 };

  document.arrange(order, written);
  // What the slides written name and the deck no longer has comes from before – with what that
  // names in turn (parent and list styles, gradients, fill pictures, …) – and their pictures.
  await document.takeWhatSlidesNeedFrom(before, [...written.keys()]);
  return { changed: true, conflicts };
}
