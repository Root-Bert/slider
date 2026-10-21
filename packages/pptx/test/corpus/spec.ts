import type { DeckSpec, SlideSpec } from '../fixtures/build-pptx';

/**
 * Building blocks of the BER-106 corpus: decks whose slides carry a stable `label`, and pure
 * transforms that turn a v1 deck into its v2 (insert, delete, move, hide, …). Labels are the
 * slide keys in `expected.json`; they come from the case definition, never from parsing, so a
 * renumbered or renamed slide cannot leak into the keys.
 */

export interface CorpusSlide extends SlideSpec {
  /** Unique within its deck; the same label in v1 and v2 means "this is the same slide". */
  label: string;
}

export interface CorpusDeck extends Omit<DeckSpec, 'slides' | 'sections'> {
  slides: CorpusSlide[];
  /** Sections by slide label (the builder wants indexes). */
  sections?: { name: string; labels: string[] }[];
}

export type CorpusTag =
  'basis' | 'structure' | 'content' | 'visibility' | 'comments' | 'producer' | 'synthetic';

export interface CorpusCase {
  /** Folder name under `decks/`. */
  id: string;
  title: string;
  description: string;
  tags: CorpusTag[];
  /** For synthetic producer cases: what is imitated and why it cannot be a real file (yet). */
  synthetic?: string;
  v1: CorpusDeck;
  v2: CorpusDeck;
}

/** The builder's input: labels stripped, sections turned into slide indexes. */
export function toDeckSpec(deck: CorpusDeck): DeckSpec {
  const { slides, sections, ...rest } = deck;
  const labels = slides.map((slide) => slide.label);
  if (new Set(labels).size !== labels.length) {
    throw new Error(`Duplicate slide labels: ${labels.join(', ')}`);
  }
  const indexOf = (label: string) => {
    const index = labels.indexOf(label);
    if (index < 0) throw new Error(`Section names unknown slide "${label}"`);
    return index;
  };
  return {
    ...rest,
    slides: slides.map(({ label: _label, ...slide }) => slide),
    ...(sections
      ? { sections: sections.map((s) => ({ name: s.name, slides: s.labels.map(indexOf) })) }
      : {}),
  };
}

// ── Transforms (all pure; they never mutate their input) ────────────────────

const find = (deck: CorpusDeck, label: string): CorpusSlide => {
  const slide = deck.slides.find((s) => s.label === label);
  if (!slide) throw new Error(`No slide "${label}"`);
  return slide;
};

/** Next free sldId, as PowerPoint assigns it (max + 1). */
export const nextSldId = (deck: CorpusDeck): number =>
  Math.max(255, ...deck.slides.map((slide, index) => slide.sldId ?? 256 + index)) + 1;

/** Gives every slide its sldId explicitly, so later reorders keep them. */
export function withExplicitIds(deck: CorpusDeck): CorpusDeck {
  return {
    ...deck,
    slides: deck.slides.map((slide, index) => ({ ...slide, sldId: slide.sldId ?? 256 + index })),
  };
}

export function insertAt(deck: CorpusDeck, index: number, slide: CorpusSlide): CorpusDeck {
  const slides = [...deck.slides];
  slides.splice(index, 0, { sldId: nextSldId(deck), ...slide });
  return { ...deck, slides };
}

export function remove(deck: CorpusDeck, label: string): CorpusDeck {
  find(deck, label);
  return {
    ...deck,
    slides: deck.slides.filter((slide) => slide.label !== label),
    sections: deck.sections?.map((s) => ({ ...s, labels: s.labels.filter((l) => l !== label) })),
  };
}

/** Moves a slide to `index` of the resulting deck. */
export function move(deck: CorpusDeck, label: string, index: number): CorpusDeck {
  const slide = find(deck, label);
  const slides = deck.slides.filter((s) => s.label !== label);
  slides.splice(index, 0, slide);
  return { ...deck, slides };
}

/** Moves a whole section (its slides and its place in the section list) to the end. */
export function moveSectionToEnd(deck: CorpusDeck, name: string): CorpusDeck {
  const section = deck.sections?.find((s) => s.name === name);
  if (!section) throw new Error(`No section "${name}"`);
  const moving = new Set(section.labels);
  return {
    ...deck,
    slides: [
      ...deck.slides.filter((s) => !moving.has(s.label)),
      ...deck.slides.filter((s) => moving.has(s.label)),
    ],
    sections: [...(deck.sections ?? []).filter((s) => s.name !== name), section],
  };
}

/** PowerPoint "Duplicate slide": an identical copy right after the original, new sldId. */
export function duplicate(deck: CorpusDeck, label: string, copyLabel: string): CorpusDeck {
  const original = find(deck, label);
  const index = deck.slides.indexOf(original);
  const slides = [...deck.slides];
  slides.splice(index + 1, 0, { ...original, label: copyLabel, sldId: nextSldId(deck) });
  return {
    ...deck,
    slides,
    sections: deck.sections?.map((s) => {
      const at = s.labels.indexOf(label);
      if (at < 0) return s;
      const labels = [...s.labels];
      labels.splice(at + 1, 0, copyLabel);
      return { ...s, labels };
    }),
  };
}

/** Replaces fields of one slide. */
export function edit(deck: CorpusDeck, label: string, patch: Partial<SlideSpec>): CorpusDeck {
  find(deck, label);
  return {
    ...deck,
    slides: deck.slides.map((slide) => (slide.label === label ? { ...slide, ...patch } : slide)),
  };
}

/** Applies a patch to every slide (e.g. a producer's quirks). */
export function mapSlides(
  deck: CorpusDeck,
  patch: (slide: CorpusSlide, index: number) => Partial<SlideSpec>,
): CorpusDeck {
  return {
    ...deck,
    slides: deck.slides.map((slide, index) => ({ ...slide, ...patch(slide, index) })),
  };
}

/** Deterministic 32-bit id from a label (FNV-1a), for synthetic `p14:creationId`s. */
export function stableId(label: string): number {
  let hash = 0x811c9dc5;
  for (const char of label) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
