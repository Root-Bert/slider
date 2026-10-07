import { normaliseText } from './hash';
import type { ParsedSlide } from './types';

/**
 * Slide matching between two revisions of a deck (BER-108). Pure and deterministic.
 *
 * 1. Phase A: slides with the same PowerPoint `sldId` are the same slide, however much their
 *    content changed – unless most `sldId` pairs disagree on content, which means the ids were
 *    reassigned (a deck rebuilt or renumbered); then all `sldId` pairs are dropped.
 * 2. Phase B: the rest are paired by content similarity (text, title, layout, neighbours,
 *    position) with an optimal assignment, above {@link MATCH_THRESHOLD}.
 * 3. Unmatched new slides are `new`, unmatched old ones `deleted`. Matched slides are `modified`
 *    when their content changed and `moved` when they left the longest run of slides that kept
 *    their relative order (so an insert does not mark every later slide as moved).
 */

export interface SlideFingerprint {
  /** Caller's id for the slide, echoed back in the results (e.g. Slider slide id). */
  key: string;
  sldId: number | null;
  position: number;
  title: string | null;
  layoutName: string | null;
  textHash: string | null;
  /** All text on the slide. */
  text: string;
  /** Hash of the rendered image: equal hashes mean visually identical slides. */
  renderHash?: string | null;
  /** {@link shapeSignature} of the shapes, used when no render hashes are available. */
  shapeSignature?: string | null;
}

export type SlideMatchStatus = 'unchanged' | 'moved' | 'modified' | 'new' | 'deleted';

export interface SlideMatchResult {
  prevKey: string | null;
  nextKey: string | null;
  status: SlideMatchStatus;
  /** The slide left its relative order (also set for modified slides). */
  moved: boolean;
  /** 0–1, two decimals. For new/deleted slides: how sure we are there is no counterpart. */
  confidence: number;
  matchedBy: 'sldId' | 'content' | null;
  previousPosition: number | null;
  position: number | null;
}

export interface MatchOptions {
  /** Minimum content score for a phase B pair; default {@link MATCH_THRESHOLD}. */
  threshold?: number;
}

export const MATCH_THRESHOLD = 0.45;
/**
 * Minimum text similarity for an `sldId` pair to count as "agreeing" in the renumber guard.
 * A single disagreeing pair is still matched; only the deck-wide ratio matters.
 */
const SLDID_MIN_TEXT_SIM = 0.25;
/** With at least this many `sldId` pairs, fewer than half trusted means "renumbered". */
const RENUMBER_MIN_PAIRS = 3;
/** Above this size the O(n³) assignment gives way to a greedy best-first one. */
const HUNGARIAN_MAX = 300;

const WEIGHTS = { text: 0.55, title: 0.15, layout: 0.1, neighbour: 0.12, position: 0.08 };

// ── Fingerprints ────────────────────────────────────────────────────────────

interface ShapeLike {
  id: string;
  bbox: { x: number; y: number; w: number; h: number };
  text: string;
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Stable string of the shapes' ids, rounded boxes and text: equal when nothing visible moved. */
export function shapeSignature(shapes: readonly ShapeLike[]): string {
  return JSON.stringify(
    shapes.map((shape) => [
      shape.id,
      round4(shape.bbox.x),
      round4(shape.bbox.y),
      round4(shape.bbox.w),
      round4(shape.bbox.h),
      shape.text,
    ]),
  );
}

/** Fingerprint of a freshly parsed slide. `key` defaults to its index. */
export function fingerprintFromParsed(
  slide: ParsedSlide,
  options: { key?: string; renderHash?: string | null } = {},
): SlideFingerprint {
  return fingerprintFromShapes({
    key: options.key ?? String(slide.index),
    sldId: slide.sldId,
    position: slide.index,
    title: slide.title,
    layoutName: slide.layoutName,
    textHash: slide.textHash,
    shapes: slide.shapes,
    renderHash: options.renderHash ?? null,
  });
}

/** Fingerprint from stored data (e.g. a `slide_versions` row). */
export function fingerprintFromShapes(input: {
  key: string;
  sldId: number | null;
  position: number;
  title: string | null;
  layoutName: string | null;
  textHash: string | null;
  shapes: readonly ShapeLike[];
  renderHash?: string | null;
}): SlideFingerprint {
  return {
    key: input.key,
    sldId: input.sldId,
    position: input.position,
    title: input.title,
    layoutName: input.layoutName,
    textHash: input.textHash,
    text: input.shapes.map((shape) => shape.text).join('\n'),
    renderHash: input.renderHash ?? null,
    shapeSignature: shapeSignature(input.shapes),
  };
}

// ── Similarity features ─────────────────────────────────────────────────────

/** Normalised words of at least two letters or digits. */
export function tokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(
    normaliseText(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 2),
  );
}

/** |A ∩ B| / |A ∪ B|; `null` when both sets are empty. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number | null {
  if (a.size === 0 && b.size === 0) return null;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / (a.size + b.size - common);
}

interface Prepared {
  fp: SlideFingerprint;
  index: number;
  textTokens: Set<string>;
  titleTokens: Set<string>;
}

const prepare = (fps: readonly SlideFingerprint[]): Prepared[] =>
  [...fps]
    .sort((a, b) => a.position - b.position)
    .map((fp, index) => ({
      fp,
      index,
      textTokens: tokens(fp.text),
      titleTokens: tokens(fp.title),
    }));

const renderEqual = (a: SlideFingerprint, b: SlideFingerprint) =>
  Boolean(a.renderHash && b.renderHash && a.renderHash === b.renderHash);

function textSim(a: Prepared, b: Prepared): number | null {
  if (a.textTokens.size === 0 && b.textTokens.size === 0) return null;
  if (a.fp.textHash && a.fp.textHash === b.fp.textHash) return 1;
  return jaccard(a.textTokens, b.textTokens);
}

function titleSim(a: Prepared, b: Prepared): number | null {
  if (a.fp.title === null && b.fp.title === null) return null;
  return jaccard(a.titleTokens, b.titleTokens) ?? 1;
}

function layoutEq(a: Prepared, b: Prepared): number | null {
  if (a.fp.layoutName === null || b.fp.layoutName === null) return null;
  return a.fp.layoutName === b.fp.layoutName ? 1 : 0;
}

const relative = (index: number, count: number) => (count <= 1 ? 0 : index / (count - 1));

interface Context {
  prev: Prepared[];
  next: Prepared[];
  /** prev index → next index of phase A anchors. */
  anchors: Map<number, number>;
}

/**
 * Do the neighbours agree? The slide before `p` must be anchored to the slide before `n`, and
 * the same after. Two missing neighbours (deck edge) agree; `null` without any anchors.
 */
function neighbourSim(ctx: Context, p: number, n: number): number | null {
  if (ctx.anchors.size === 0) return null;
  const side = (dp: number, dn: number): number => {
    const pn = p + dp;
    const nn = n + dn;
    const prevExists = pn >= 0 && pn < ctx.prev.length;
    const nextExists = nn >= 0 && nn < ctx.next.length;
    if (!prevExists && !nextExists) return 1;
    if (!prevExists || !nextExists) return 0;
    return ctx.anchors.get(pn) === nn ? 1 : 0;
  };
  return (side(-1, -1) + side(1, 1)) / 2;
}

/** Weighted mean of the available features, 0–1. Identical renders score 1 outright. */
function score(ctx: Context, a: Prepared, b: Prepared): number {
  if (renderEqual(a.fp, b.fp)) return 1;
  const features: [number | null, number][] = [
    [textSim(a, b), WEIGHTS.text],
    [titleSim(a, b), WEIGHTS.title],
    [layoutEq(a, b), WEIGHTS.layout],
    [neighbourSim(ctx, a.index, b.index), WEIGHTS.neighbour],
    [
      1 - Math.abs(relative(a.index, ctx.prev.length) - relative(b.index, ctx.next.length)),
      WEIGHTS.position,
    ],
  ];
  let sum = 0;
  let weight = 0;
  for (const [value, w] of features) {
    if (value === null) continue;
    sum += value * w;
    weight += w;
  }
  return weight === 0 ? 0 : sum / weight;
}

// ── Assignment ──────────────────────────────────────────────────────────────

/**
 * Minimum-cost assignment of rows to columns (Hungarian algorithm with potentials, O(n²m)).
 * Works for rectangular matrices; returns for each row its column, or -1.
 */
export function hungarian(cost: readonly (readonly number[])[]): number[] {
  const rows = cost.length;
  const cols = rows === 0 ? 0 : (cost[0]?.length ?? 0);
  if (rows === 0 || cols === 0) return Array<number>(rows).fill(-1);
  if (rows > cols) {
    const transposed = Array.from({ length: cols }, (_, c) =>
      Array.from({ length: rows }, (_, r) => cost[r]?.[c] ?? 0),
    );
    const byCol = hungarian(transposed);
    const result = Array<number>(rows).fill(-1);
    byCol.forEach((r, c) => {
      if (r >= 0) result[r] = c;
    });
    return result;
  }
  // 1-based arrays as in the classic formulation; p[j] = row assigned to column j.
  const u = new Float64Array(rows + 1);
  const v = new Float64Array(cols + 1);
  const p = new Int32Array(cols + 1);
  const way = new Int32Array(cols + 1);
  for (let i = 1; i <= rows; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(cols + 1).fill(Infinity);
    const used = new Uint8Array(cols + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0] ?? 0;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= cols; j++) {
        if (used[j]) continue;
        const cur = (cost[i0 - 1]?.[j - 1] ?? 0) - (u[i0] ?? 0) - (v[j] ?? 0);
        if (cur < (minv[j] ?? Infinity)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if ((minv[j] ?? Infinity) < delta) {
          delta = minv[j] ?? Infinity;
          j1 = j;
        }
      }
      for (let j = 0; j <= cols; j++) {
        if (used[j]) {
          u[p[j] ?? 0] = (u[p[j] ?? 0] ?? 0) + delta;
          v[j] = (v[j] ?? 0) - delta;
        } else {
          minv[j] = (minv[j] ?? Infinity) - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0] ?? 0;
      p[j0] = p[j1] ?? 0;
      j0 = j1;
    } while (j0 !== 0);
  }
  const result = Array<number>(rows).fill(-1);
  for (let j = 1; j <= cols; j++) {
    const row = p[j] ?? 0;
    if (row > 0) result[row - 1] = j - 1;
  }
  return result;
}

/** Best-first pairing for very large decks, where O(n³) would be too slow. */
function greedyAssign(scores: readonly (readonly number[])[]): number[] {
  const cells: [number, number, number][] = [];
  scores.forEach((row, r) => row.forEach((s, c) => cells.push([s, r, c])));
  cells.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const result = Array<number>(scores.length).fill(-1);
  const takenCols = new Set<number>();
  for (const [, r, c] of cells) {
    if (result[r] !== -1 || takenCols.has(c)) continue;
    result[r] = c;
    takenCols.add(c);
  }
  return result;
}

/**
 * Pairs rows with columns so the summed score is maximal, ignoring pairs below `threshold`.
 * Returns for each row its column, or -1.
 */
export function assignPairs(
  scores: readonly (readonly number[])[],
  threshold = MATCH_THRESHOLD,
): number[] {
  const eligible = scores.map((row) => row.map((s) => (s >= threshold ? s : 0)));
  const rows = eligible.length;
  const cols = rows === 0 ? 0 : (eligible[0]?.length ?? 0);
  const assignment =
    Math.max(rows, cols) > HUNGARIAN_MAX
      ? greedyAssign(eligible)
      : hungarian(eligible.map((row) => row.map((s) => 1 - s)));
  return assignment.map((c, r) => (c >= 0 && (eligible[r]?.[c] ?? 0) > 0 ? c : -1));
}

/** Indexes (into `values`) of one longest strictly increasing subsequence. */
export function longestIncreasingSubsequence(values: readonly number[]): Set<number> {
  const tails: number[] = []; // index into values of the smallest tail for each length
  const parent = Array<number>(values.length).fill(-1);
  values.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((values[tails[mid] ?? 0] ?? 0) < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) parent[i] = tails[lo - 1] ?? -1;
    tails[lo] = i;
  });
  const result = new Set<number>();
  let cursor = tails.length > 0 ? (tails[tails.length - 1] ?? -1) : -1;
  while (cursor >= 0) {
    result.add(cursor);
    cursor = parent[cursor] ?? -1;
  }
  return result;
}

// ── Matching ────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

function contentChanged(a: SlideFingerprint, b: SlideFingerprint): boolean {
  if (a.renderHash && b.renderHash) return a.renderHash !== b.renderHash;
  if ((a.textHash ?? null) !== (b.textHash ?? null)) return true;
  if ((a.layoutName ?? null) !== (b.layoutName ?? null)) return true;
  if (a.shapeSignature && b.shapeSignature) return a.shapeSignature !== b.shapeSignature;
  return false;
}

interface Pair {
  p: number;
  n: number;
  confidence: number;
  matchedBy: 'sldId' | 'content';
}

/** Matches the slides of the previous revision to the next one. See the file comment. */
export function matchSlides(
  previous: readonly SlideFingerprint[],
  nextSlides: readonly SlideFingerprint[],
  options: MatchOptions = {},
): SlideMatchResult[] {
  const threshold = options.threshold ?? MATCH_THRESHOLD;
  const ctx: Context = { prev: prepare(previous), next: prepare(nextSlides), anchors: new Map() };
  const { prev, next } = ctx;

  // Phase A: same sldId.
  const nextBySldId = new Map<number, number>();
  for (const slide of next) {
    if (slide.fp.sldId !== null && !nextBySldId.has(slide.fp.sldId))
      nextBySldId.set(slide.fp.sldId, slide.index);
  }
  const candidates: { p: number; n: number; trusted: boolean }[] = [];
  const usedNext = new Set<number>();
  for (const slide of prev) {
    if (slide.fp.sldId === null) continue;
    const n = nextBySldId.get(slide.fp.sldId);
    if (n === undefined || usedNext.has(n)) continue;
    usedNext.add(n);
    const other = next[n];
    if (!other) continue;
    const text = textSim(slide, other);
    const trusted =
      renderEqual(slide.fp, other.fp) ||
      (text !== null && text >= SLDID_MIN_TEXT_SIM) ||
      (text === null && layoutEq(slide, other) !== 0);
    candidates.push({ p: slide.index, n, trusted });
  }
  const trustedCount = candidates.filter((c) => c.trusted).length;
  const renumbered =
    candidates.length >= RENUMBER_MIN_PAIRS && trustedCount < candidates.length / 2;
  const pairs: Pair[] = [];
  if (!renumbered) {
    // Same sldId = same slide, even when its content was rewritten (comments must follow it).
    for (const c of candidates) ctx.anchors.set(c.p, c.n);
    for (const [p, n] of ctx.anchors) {
      const a = prev[p];
      const b = next[n];
      if (!a || !b) continue;
      const exact =
        renderEqual(a.fp, b.fp) || Boolean(a.fp.textHash && a.fp.textHash === b.fp.textHash);
      const confidence = exact ? 1 : Math.min(1, 0.7 + 0.3 * score(ctx, a, b));
      pairs.push({ p, n, confidence, matchedBy: 'sldId' });
    }
  }

  // Phase B: content similarity among the rest.
  const matchedPrev = new Set(pairs.map((pair) => pair.p));
  const matchedNext = new Set(pairs.map((pair) => pair.n));
  const restPrev = prev.filter((slide) => !matchedPrev.has(slide.index));
  const restNext = next.filter((slide) => !matchedNext.has(slide.index));
  const scores = restPrev.map((a) => restNext.map((b) => score(ctx, a, b)));
  const assignment = assignPairs(scores, threshold);
  assignment.forEach((c, r) => {
    const a = restPrev[r];
    const b = restNext[c];
    if (c < 0 || !a || !b) return;
    pairs.push({ p: a.index, n: b.index, confidence: scores[r]?.[c] ?? 0, matchedBy: 'content' });
  });

  const bestByPrev = new Map<number, number>();
  const bestByNext = new Map<number, number>();
  restPrev.forEach((a, r) =>
    restNext.forEach((b, c) => {
      const s = scores[r]?.[c] ?? 0;
      bestByPrev.set(a.index, Math.max(bestByPrev.get(a.index) ?? 0, s));
      bestByNext.set(b.index, Math.max(bestByNext.get(b.index) ?? 0, s));
    }),
  );

  // Moved: matched slides outside the longest run that kept its relative order.
  const inNextOrder = [...pairs].sort((x, y) => x.n - y.n);
  const keep = longestIncreasingSubsequence(inNextOrder.map((pair) => pair.p));
  const movedByNext = new Map(inNextOrder.map((pair, i) => [pair.n, !keep.has(i)]));
  const pairByNext = new Map(pairs.map((pair) => [pair.n, pair]));
  const pairedPrev = new Set(pairs.map((pair) => pair.p));

  const results: SlideMatchResult[] = next.map((b) => {
    const pair = pairByNext.get(b.index);
    const a = pair ? prev[pair.p] : undefined;
    if (!pair || !a) {
      return {
        prevKey: null,
        nextKey: b.fp.key,
        status: 'new',
        moved: false,
        confidence: round2(1 - (bestByNext.get(b.index) ?? 0)),
        matchedBy: null,
        previousPosition: null,
        position: b.fp.position,
      };
    }
    const moved = movedByNext.get(b.index) ?? false;
    const status = contentChanged(a.fp, b.fp) ? 'modified' : moved ? 'moved' : 'unchanged';
    return {
      prevKey: a.fp.key,
      nextKey: b.fp.key,
      status,
      moved,
      confidence: round2(pair.confidence),
      matchedBy: pair.matchedBy,
      previousPosition: a.fp.position,
      position: b.fp.position,
    };
  });
  for (const a of prev) {
    if (pairedPrev.has(a.index)) continue;
    results.push({
      prevKey: a.fp.key,
      nextKey: null,
      status: 'deleted',
      moved: false,
      confidence: round2(1 - (bestByPrev.get(a.index) ?? 0)),
      matchedBy: null,
      previousPosition: a.fp.position,
      position: null,
    });
  }
  return results;
}

// ── Re-linking slides deleted in an earlier revision ────────────────────────

/** Minimum content similarity for a new slide to be recognised as an earlier deleted one. */
export const RELINK_THRESHOLD = 0.8;

/**
 * Content-only similarity for {@link relinkDeletedSlides}: positions and neighbours of slides
 * deleted revisions ago mean nothing, so only render, text, title and layout count. Slides
 * without text only qualify with an identical render.
 */
function relinkScore(a: Prepared, b: Prepared): number {
  if (renderEqual(a.fp, b.fp)) return 1;
  const text = textSim(a, b);
  if (text === null) return 0;
  const features: [number | null, number][] = [
    [text, 0.7],
    [titleSim(a, b), 0.2],
    [layoutEq(a, b), 0.1],
  ];
  let sum = 0;
  let weight = 0;
  for (const [value, w] of features) {
    if (value === null) continue;
    sum += value * w;
    weight += w;
  }
  const base = weight === 0 ? 0 : sum / weight;
  // The same sldId breaks ties between equally similar candidates.
  const sameId = a.fp.sldId !== null && a.fp.sldId === b.fp.sldId;
  return Math.min(1, base + (sameId ? 0.01 : 0));
}

/**
 * Recognises slides that came back: `deleted` are slides missing from the previous revision
 * (with their last version), `added` the slides {@link matchSlides} reported as `new`. Returns
 * added key → deleted key for pairs with a content similarity of at least `threshold`, so a
 * restored slide gets its old identity (and comments) back. Optimal one-to-one assignment.
 */
export function relinkDeletedSlides(
  deleted: readonly SlideFingerprint[],
  added: readonly SlideFingerprint[],
  threshold = RELINK_THRESHOLD,
): Map<string, string> {
  const result = new Map<string, string>();
  if (deleted.length === 0 || added.length === 0) return result;
  const a = prepare(deleted);
  const b = prepare(added);
  const scores = b.map((next) => a.map((prev) => relinkScore(prev, next)));
  assignPairs(scores, threshold).forEach((c, r) => {
    const next = b[r];
    const prev = a[c];
    if (c >= 0 && next && prev) result.set(next.fp.key, prev.fp.key);
  });
  return result;
}
