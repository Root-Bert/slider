import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { format } from 'prettier';
import { clamp01, type Rect } from '@slider/shared';
import {
  fingerprintFromShapes,
  matchSlides,
  openPptx,
  trackBoxes,
  svgForRenderHash,
  type ParsedShape,
  type SlideFingerprint,
  type SlideMatchResult,
} from '../../src';
import { buildPptx } from '../fixtures/build-pptx';
import { toDeckSpec, type CorpusCase } from './spec';

/**
 * Runs one corpus case the way the API's sync import does (apps/api/src/sync/sync-import.ts):
 * fingerprints from `fingerprintFromShapes` over clamped shapes (apps/api/src/import/common.ts
 * `toShape`) with `renderHash = sha256(renderSlideSvg)`, the slide's `contentHash` and
 * `creationId`, then `matchSlides(prev, next)`.
 * Slide keys are the labels from the case definition.
 */

export interface SlideSummary {
  label: string;
  sldId: number;
  part: string;
  hidden: boolean;
  title: string | null;
  layoutName: string | null;
  section: string | null;
}

export interface CommentSummary {
  slide: string;
  format: 'modern' | 'legacy';
  status: 'open' | 'done';
  author: string;
  providerId: string | null;
  anchor: 'slide' | 'point' | 'shape' | 'rect';
  text: string;
  replies: number;
}

export interface DeckSummary {
  author: string | null;
  slides: SlideSummary[];
  sections: { name: string; slides: string[] }[];
  comments: CommentSummary[];
}

export type MatchSummary = Omit<SlideMatchResult, 'prevKey' | 'nextKey'> & {
  prev: string | null;
  next: string | null;
};

/** A box that now lives on another slide (`trackBoxes`): comments bound to it move along. */
export interface MovedBox {
  prev: string;
  shape: string;
  next: string;
  nextShape: string;
}

export interface Expected {
  case: string;
  tags: string[];
  synthetic: boolean;
  matches: MatchSummary[];
  /** Only when a box left its slide. */
  movedBoxes?: MovedBox[];
  prev: DeckSummary;
  next: DeckSummary;
}

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex');
const round2 = (n: number) => Math.round(n * 100) / 100;

/** apps/api/src/import/common.ts `clampRect`: shapes may hang off the slide, anchors may not. */
function clampRect(rect: Rect): Rect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(rect.w - (x - rect.x), 1 - x)),
    h: Math.max(0, Math.min(rect.h - (y - rect.y), 1 - y)),
  };
}

const toShape = (shape: ParsedShape) => ({
  id: shape.id,
  name: shape.name,
  bbox: clampRect(shape.bbox),
  text: shape.text,
});

async function analyse(
  bytes: Uint8Array,
  labels: string[] | ((index: number) => string),
): Promise<{ fingerprints: SlideFingerprint[]; summary: DeckSummary }> {
  const pkg = await openPptx(bytes);
  const { presentation } = pkg;
  const labelOf = (index: number) => {
    const label = typeof labels === 'function' ? labels(index) : labels[index];
    if (label === undefined) throw new Error(`No label for slide ${index}`);
    return label;
  };
  if (Array.isArray(labels) && labels.length !== presentation.slides.length) {
    throw new Error(`${labels.length} labels for ${presentation.slides.length} slides`);
  }
  const fingerprints: SlideFingerprint[] = [];
  for (const slide of presentation.slides) {
    fingerprints.push(
      fingerprintFromShapes({
        key: labelOf(slide.index),
        sldId: slide.sldId,
        position: slide.index,
        title: slide.title,
        layoutName: slide.layoutName,
        textHash: slide.textHash,
        shapes: slide.shapes.map(toShape),
        renderHash: sha256(svgForRenderHash(await pkg.renderSlideSvg(slide))),
        contentHash: slide.contentHash,
        creationId: slide.creationId,
        hidden: slide.hidden,
      }),
    );
  }

  const labelBySldId = new Map(presentation.slides.map((s) => [s.sldId, labelOf(s.index)]));
  const slideLabel = (sldId: number) => labelBySldId.get(sldId) ?? `sldId:${sldId}`;
  const sectionOf = (sldId: number) =>
    presentation.sections.find((section) => section.slideIds.includes(sldId))?.name ?? null;

  return {
    fingerprints,
    summary: {
      author: presentation.author,
      slides: presentation.slides.map((slide) => ({
        label: labelOf(slide.index),
        sldId: slide.sldId,
        part: slide.path,
        hidden: slide.hidden,
        title: slide.title,
        layoutName: slide.layoutName,
        section: sectionOf(slide.sldId),
      })),
      sections: presentation.sections.map((section) => ({
        name: section.name,
        slides: section.slideIds.map(slideLabel),
      })),
      comments: presentation.comments.map((comment) => ({
        slide: slideLabel(comment.sldId),
        format: comment.format,
        status: comment.status,
        author: comment.author.name,
        providerId: comment.author.providerId ?? null,
        anchor: comment.anchor.type,
        text: comment.text,
        replies: comment.replies.length,
      })),
    },
  };
}

export interface CaseMeta {
  id: string;
  tags: string[];
  synthetic: boolean;
  /** Slide labels of v1 and v2; positional `v1:1`, `v2:1`, … when absent (real files). */
  labels?: { v1: string[]; v2: string[] };
}

/** Matches v2 against v1 and summarises both decks. */
export async function runCase(meta: CaseMeta, v1: Uint8Array, v2: Uint8Array): Promise<Expected> {
  const prev = await analyse(v1, meta.labels?.v1 ?? ((i) => `v1:${i + 1}`));
  const next = await analyse(v2, meta.labels?.v2 ?? ((i) => `v2:${i + 1}`));
  const results = matchSlides(prev.fingerprints, next.fingerprints);
  const counterpart = new Map(results.map((r) => [r.prevKey, r.nextKey]));
  const movedBoxes: MovedBox[] = [];
  for (const [prevKey, boxes] of trackBoxes(prev.fingerprints, next.fingerprints, results))
    for (const [shape, target] of boxes)
      if (target && target.key !== counterpart.get(prevKey))
        movedBoxes.push({ prev: prevKey, shape, next: target.key, nextShape: target.shapeId });
  const matches = results.map(({ prevKey, nextKey, ...rest }) => ({
    prev: prevKey,
    next: nextKey,
    ...rest,
    confidence: round2(rest.confidence),
  }));
  return {
    case: meta.id,
    tags: meta.tags,
    synthetic: meta.synthetic,
    matches,
    ...(movedBoxes.length > 0 ? { movedBoxes } : {}),
    prev: prev.summary,
    next: next.summary,
  };
}

export const metaOf = (c: CorpusCase): CaseMeta => ({
  id: c.id,
  tags: c.tags,
  synthetic: c.tags.includes('synthetic'),
  labels: { v1: c.v1.slides.map((s) => s.label), v2: c.v2.slides.map((s) => s.label) },
});

export async function buildCase(c: CorpusCase): Promise<{ v1: Uint8Array; v2: Uint8Array }> {
  const [v1, v2] = await Promise.all([buildPptx(toDeckSpec(c.v1)), buildPptx(toDeckSpec(c.v2))]);
  return { v1, v2 };
}

/** JSON as the repo's Prettier writes it, so `bun run format` leaves the files alone. */
export async function formatExpected(expected: Expected): Promise<string> {
  return format(JSON.stringify(expected), { parser: 'json', printWidth: 100 });
}

/** Writes `<dir>/<id>/v1.pptx`, `v2.pptx` and `expected.json`. */
export async function writeCase(dir: string, c: CorpusCase): Promise<Expected> {
  const { v1, v2 } = await buildCase(c);
  const expected = await runCase(metaOf(c), v1, v2);
  const caseDir = join(dir, c.id);
  await mkdir(caseDir, { recursive: true });
  await writeFile(join(caseDir, 'v1.pptx'), v1);
  await writeFile(join(caseDir, 'v2.pptx'), v2);
  await writeFile(join(caseDir, 'expected.json'), await formatExpected(expected));
  return expected;
}
