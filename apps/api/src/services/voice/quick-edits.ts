import { z } from 'zod';
import { slidePlaceholders, type OdpDocument } from '@slider/odp';
import {
  freeFontName,
  lineBetween,
  NEW_LINE_STROKE,
  NO_EFFECTS,
  slideTransitionSchema,
} from '@slider/shared';
import { DEFAULT_STYLE, plainParagraph } from '@slider/shared/live-text';
import type {
  AddElementOperation,
  ElementBox,
  ElementEffects,
  EditableElement,
  EditableSlide,
  FillLayer,
  LiveTextStyle,
  NewShape,
  RichParagraph,
  SlideOperation,
} from '@slider/shared';

/*
 * Changes said so plainly that the editor's own operations do them – „die Box nach oben links“,
 * „den Titel fett“, „den Kreis rot“, „das Bild weg“. The router gives them with the comment;
 * they are applied at once, in a second or two, instead of waiting for the AI that edits the
 * slides (half a minute and more). Anything one of them cannot say – or an element that cannot
 * take it – sends the whole comment to that AI, as before.
 */

/** Changes of one comment at most. */
export const MAX_QUICK_EDITS = 12;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
export const PLACES = [
  'top_left',
  'top',
  'top_right',
  'left',
  'center',
  'right',
  'bottom_left',
  'bottom',
  'bottom_right',
] as const;
type Place = (typeof PLACES)[number];
const percent = z.number().min(-100).max(200);

/**
 * What can be added – what the editor's „Text“ and „Form“ make (`InsertFrameChooser`): a text
 * box, the shapes on offer, a line or an arrow.
 */
export const NEW_KINDS = [
  'text',
  'rectangle',
  'ellipse',
  'isosceles-triangle',
  'diamond',
  'hexagon',
  'right-arrow',
  'star5',
  'line',
  'arrow',
] as const;
export type NewKind = (typeof NEW_KINDS)[number];
export const NEXT_TO_SIDES = ['right', 'left', 'below', 'above'] as const;
const reference = z.string().min(1).max(200);
/** One end of a new line: an element (its edge facing the other end), or a point (%). */
const lineEnd = z.union([z.object({ element: reference }), z.object({ x: percent, y: percent })]);

export const quickEditSchema = z.object({
  /** The element changed – its id, or the `name` of one added before in the same edits. */
  element: reference.nullish(),
  /** A new element of this kind instead – on top, as the editor adds it. */
  add: z.enum(NEW_KINDS).nullish(),
  /** A new copy of this element instead (look, text, size) – the editor's ⌘D. */
  copy_of: reference.nullish(),
  /** What later edits call the new element (`element`, `align_with`, `next_to`, …). */
  name: z.string().min(1).max(60).nullish(),
  /** A new element's size, % of the slide – when it has no `box`; one of them: proportional. */
  size: z.object({ w: percent.positive().nullish(), h: percent.positive().nullish() }).nullish(),
  /** Beside another element – a gap (% of the slide's width or height) between, lined up. */
  next_to: z
    .object({
      element: reference,
      side: z.enum(NEXT_TO_SIDES),
      gap: z.number().min(0).max(100).nullish(),
    })
    .nullish(),
  /** A new line's ends. */
  from: lineEnd.nullish(),
  to: lineEnd.nullish(),
  /** A new line's arrow heads. */
  heads: z.enum(['none', 'start', 'end', 'both']).nullish(),
  /** Where in the content area it goes – worked out here, clear of the others. */
  place: z.enum(PLACES).nullish(),
  /** Lined up with other elements, by an edge or its middle – worked out here. */
  align_with: z
    .array(
      z.object({
        element: z.string().min(1).max(200),
        edge: z.enum(['left', 'right', 'top', 'bottom', 'center_x', 'center_y']),
      }),
    )
    .max(2)
    .nullish(),
  /** As wide and/or as high as another element – worked out here. */
  size_like: z
    .object({
      element: z.string().min(1).max(200),
      width: z.boolean().nullish(),
      height: z.boolean().nullish(),
    })
    .nullish(),
  /** Where it goes, in % of the slide's width (x, w) and height (y, h) – before it is turned. */
  box: z.object({ x: percent, y: percent, w: percent.positive(), h: percent.positive() }).nullish(),
  /** `none`: no fill. */
  fill: z.union([hex, z.literal('none')]).nullish(),
  /** `none`: no border; width in pt. */
  border: z
    .union([z.object({ color: hex, width: z.number().min(0).max(50) }), z.literal('none')])
    .nullish(),
  vertical_align: z.enum(['top', 'middle', 'bottom']).nullish(),
  /** Its text anew, one string per paragraph; formatting stays. */
  text: z.array(z.string().max(5_000)).max(200).nullish(),
  /** pt, all of its text. */
  font_size: z.number().min(1).max(400).nullish(),
  /** Every size of its text times this – for text of mixed sizes. */
  font_scale: z.number().min(0.1).max(10).nullish(),
  font: z.string().min(1).max(100).nullish(),
  text_color: hex.nullish(),
  bold: z.boolean().nullish(),
  italic: z.boolean().nullish(),
  underline: z.boolean().nullish(),
  align: z.enum(['left', 'center', 'right', 'justify']).nullish(),
  order: z.enum(['front', 'back']).nullish(),
  /** The element – or with `slide` the slide – deleted. */
  delete: z.boolean().nullish(),
  /** These elements of one slide grouped, instead of `element` (⌘G); `name`: the group's. */
  group: z.array(reference).min(2).max(50).nullish(),
  /** A group taken apart (⇧⌘G). */
  ungroup: z.boolean().nullish(),
  locked: z.boolean().nullish(),
  /** Effects as the editor's „Effekte“ make them: on (its default look) or off. */
  shadow: z.boolean().nullish(),
  /** On, off, or on in this colour. */
  glow: z.union([z.boolean(), hex]).nullish(),
  soft_edge: z.boolean().nullish(),
  /** Frosted glass: what lies behind shows blurred through its fill. */
  backdrop_blur: z.boolean().nullish(),
  /** A rectangle's corners rounded by this many pt (0: sharp). */
  corner_radius: z.number().min(0).max(2000).nullish(),
  /** Turned clockwise to this many degrees. */
  rotation: z.number().min(-360).max(360).nullish(),
  /** Mirrored (once more: back) – pictures and drawn shapes. */
  mirror: z.enum(['horizontal', 'vertical']).nullish(),
  /** How a picture fills its frame: cropped to it, or stretched. */
  picture_fit: z.enum(['fill', 'stretch']).nullish(),
  /** A slide (its number, 1 = first, as before these edits) changed, instead of `element`. */
  slide: z.number().int().min(1).max(10_000).nullish(),
  /**
   * A new slide instead of `element`: right after slide `after` (0: first), of a layout (by its
   * name; none: as the slide before) or a copy of slide `copy_of` – `title` and `text` (its body,
   * one string per point) go into its placeholders.
   */
  new_slide: z
    .object({
      after: z.number().int().min(0).max(10_000),
      layout: z.string().min(1).max(200).nullish(),
      copy_of: z.number().int().min(1).max(10_000).nullish(),
    })
    .nullish(),
  /** A new slide's title. */
  title: z.string().max(1_000).nullish(),
  /** A slide's own background colour – `master`: as in the master again. */
  background: z.union([hex, z.literal('master')]).nullish(),
  transition: slideTransitionSchema.nullish(),
  /** A slide's speaker notes anew, one string per paragraph (empty: none). */
  notes: z.array(z.string().max(5_000)).max(200).nullish(),
  /** A slide hidden (true) or shown again. */
  hidden: z.boolean().nullish(),
  /** A slide moved right after slide n (0: first). */
  move_after: z.number().int().min(0).max(10_000).nullish(),
  /** A slide copied, the copy right after it. */
  duplicate: z.boolean().nullish(),
});
export type QuickEdit = z.infer<typeof quickEditSchema>;

/** The edits of a router action that can be read – `null` when one cannot (none then). */
export function readQuickEdits(input: unknown): QuickEdit[] | null {
  if (input === null || input === undefined) return null;
  const list = z.array(quickEditSchema).min(1).max(MAX_QUICK_EDITS).safeParse(input);
  return list.success && list.data.every(saysWhich) ? list.data : null;
}

/**
 * An edit names one element or slide, or makes one: exactly one of `element`, `add`, `copy_of`,
 * `group`, `slide` and `new_slide`.
 */
export const saysWhich = (edit: QuickEdit): boolean =>
  [edit.element, edit.add, edit.copy_of, edit.group, edit.slide, edit.new_slide].filter(given)
    .length === 1;

const TEXT_STYLE_KEYS = [
  'font_size',
  'font_scale',
  'font',
  'text_color',
  'bold',
  'italic',
  'underline',
  'align',
] as const;

const given = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;

const fraction = (box: { x: number; y: number; w: number; h: number }): ElementBox => ({
  x: box.x / 100,
  y: box.y / 100,
  w: box.w / 100,
  h: box.h / 100,
});

/** The content area of a slide: inside its margins, shares of the slide. */
export interface ContentArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Without margins set: where the slide's placeholders (else its elements) lie, else a frame. */
function contentAreaOf(elements: readonly EditableElement[]): ContentArea {
  const inside = (box: ElementBox) => box.w * box.h < BACKGROUND_AREA && onSlide(box);
  const placeholders = elements.filter((each) => each.role && inside(each.bbox));
  const boxes = (
    placeholders.length > 0 ? placeholders : elements.filter((each) => inside(each.bbox))
  ).map((each) => each.bbox);
  const frame = { left: 0.05, top: 0.06, right: 0.95, bottom: 0.94 };
  if (boxes.length === 0) return frame;
  const area = {
    left: Math.min(...boxes.map((box) => box.x)),
    top: Math.min(...boxes.map((box) => box.y)),
    right: Math.max(...boxes.map((box) => box.x + box.w)),
    bottom: Math.max(...boxes.map((box) => box.y + box.h)),
  };
  // Placeholders say where the margins are – but a title slide's only span its middle: at least
  // the frame.
  return {
    left: Math.min(area.left, frame.left),
    top: Math.min(area.top, frame.top),
    right: Math.max(area.right, frame.right),
    bottom: Math.max(area.bottom, frame.bottom),
  };
}

/** A box of `size` at a place of the content area. */
function placed(place: Place, size: ElementBox, area: ContentArea): ElementBox {
  const [vertical, horizontal] = place.includes('_')
    ? (place.split('_') as [string, string])
    : place === 'top' || place === 'bottom'
      ? [place, 'center']
      : ['center', place];
  const x =
    horizontal === 'left'
      ? area.left
      : horizontal === 'right'
        ? area.right - size.w
        : (area.left + area.right - size.w) / 2;
  const y =
    vertical === 'top'
      ? area.top
      : vertical === 'bottom'
        ? area.bottom - size.h
        : (area.top + area.bottom - size.h) / 2;
  return { x, y, w: size.w, h: size.h };
}

/**
 * A text sent to a corner or edge goes there itself, not only its box: a wide title moved „nach
 * unten rechts“ would still show its text in the middle. Right or left aligns its lines so (not
 * those of a list), bottom or top puts them at that edge of the box – unless the edit says, or
 * the box shows itself.
 */
function withTextPlaced(edit: QuickEdit, element: EditableElement): QuickEdit {
  if (!edit.place || !element.live) return edit;
  // A box that shows (filled, framed) keeps its text where it is in it.
  const look = element.look;
  if (look && (look.fill || look.fills.length > 0 || look.stroke)) return edit;
  const sides = edit.place.split('_');
  const listed = element.live.paragraphs.some((paragraph) => paragraph.bullet || paragraph.level);
  const side = sides.find((each) => each === 'left' || each === 'right');
  const edge = sides.find((each) => each === 'top' || each === 'bottom');
  return {
    ...edit,
    ...(side && !listed && !given(edit.align) ? { align: side as 'left' | 'right' } : {}),
    ...(edge && !given(edit.vertical_align) ? { vertical_align: edge as 'top' | 'bottom' } : {}),
  };
}

/** Whether a box still lies in the half of the content area a place names („unten“: lower). */
function inHalf(place: Place, area: ContentArea): (box: ElementBox) => boolean {
  const middle = { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
  return (box) =>
    place.split('_').every((side) => {
      const x = box.x + box.w / 2;
      const y = box.y + box.h / 2;
      if (side === 'left') return x <= middle.x;
      if (side === 'right') return x >= middle.x;
      if (side === 'top') return y <= middle.y;
      if (side === 'bottom') return y >= middle.y;
      return true;
    });
}

/** A box lined up with another by an edge or its middle. */
function lineUp(
  box: ElementBox,
  other: ElementBox,
  edge: 'left' | 'right' | 'top' | 'bottom' | 'center_x' | 'center_y',
): ElementBox {
  switch (edge) {
    case 'left':
      return { ...box, x: other.x };
    case 'right':
      return { ...box, x: other.x + other.w - box.w };
    case 'center_x':
      return { ...box, x: other.x + other.w / 2 - box.w / 2 };
    case 'top':
      return { ...box, y: other.y };
    case 'bottom':
      return { ...box, y: other.y + other.h - box.h };
    case 'center_y':
      return { ...box, y: other.y + other.h / 2 - box.h / 2 };
  }
}

/** Room kept to an element moved out of the way, as a share of the slide. */
const GAP = { x: 0.02, y: 0.03 };
/** An element covering this much of the slide is a background: anything may lie on it. */
const BACKGROUND_AREA = 0.5;
/** Overlaps thinner than this (share of the slide) do not count – boxes touching, padding. */
const SLACK = 0.005;

const overlaps = (a: ElementBox, b: ElementBox) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > SLACK &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > SLACK;

const onSlide = (box: ElementBox) =>
  box.x >= -SLACK && box.y >= -SLACK && box.x + box.w <= 1 + SLACK && box.y + box.h <= 1 + SLACK;

/**
 * Where a moved element goes so it covers nothing it did not cover before: the fast model says
 * „oben links“ right but now and then puts the box over the title there. Then it goes the least
 * way beside what it would cover – below, above, right or left of it, a gap between – as long as
 * that is on the slide and covers nothing new either. `null`: nowhere free there.
 */
export function clearOf(
  box: ElementBox,
  from: ElementBox,
  others: readonly ElementBox[],
  /** Where a place out of the way may be – in the half of the slide that was asked for. */
  keep: (box: ElementBox) => boolean = () => true,
): ElementBox | null {
  const solid = others.filter(
    (other) => other.w * other.h < BACKGROUND_AREA && !overlaps(other, from),
  );
  const free = (candidate: ElementBox) =>
    onSlide(candidate) && !solid.some((other) => overlaps(candidate, other));
  if (free(box)) return box;
  let best: ElementBox | null = null;
  let way = Infinity;
  for (const other of solid.filter((each) => overlaps(box, each))) {
    for (const candidate of [
      { ...box, y: other.y + other.h + GAP.y },
      { ...box, y: other.y - GAP.y - box.h },
      { ...box, x: other.x + other.w + GAP.x },
      { ...box, x: other.x - GAP.x - box.w },
    ]) {
      const distance = Math.hypot(candidate.x - box.x, candidate.y - box.y);
      if (distance < way && free(candidate) && keep(candidate)) {
        best = candidate;
        way = distance;
      }
    }
  }
  return best;
}

/** A slide the edits work on: its elements – and its page id, where elements are added. */
export type QuickSlide = Pick<EditableSlide, 'elements'> & { pageId?: string | null };

/** What the edits make: the operations, and the ids the new elements got (with their names). */
export interface QuickPlan {
  operations: SlideOperation[];
  added: { name: string | null; id: string }[];
  /**
   * Texts for the placeholders of slides the operations add – their ids are known only once the
   * slide is there (`applyQuickEdits` fills them in).
   */
  fills: QuickFill[];
}

/** What goes into a new slide's title and body placeholders. */
export interface QuickFill {
  pageId: string;
  title: string | null;
  text: string[] | null;
}

/** A layout a new slide can take: a master page, its placeholders and the slides on it. */
export interface QuickLayout {
  name: string;
  displayName: string | null;
  kinds: readonly string[];
  /** Page ids of the slides on it. */
  pages: readonly string[];
}

/** Why the edits cannot be made so – `index`: the edit that cannot (`-1`: none in particular). */
export interface QuickProblem {
  problem: string;
  index: number;
}

/** The default page: 16:9 in cm. */
const PAGE = { width: 28, height: 15.75 };
/** A new box's fill until another is asked for – the editor's (`NEW_BOX`). */
export const NEW_BOX_FILL = '#dbeafe';
/** Room between a line's end and the element it starts or ends at, cm. */
const LINE_GAP_CM = 0.2;
/** A line shorter than this (cm) is not seen as one: room is to be made first. */
const MIN_LINE_CM = 1;

/**
 * The operations the edits make on the deck's `slides` (element ids are the file's, one of a
 * kind) – `null` when one of them cannot be done this way (an element not there, a picture given
 * a fill, text the live editor cannot write, nothing said): then the AI does the whole request.
 */
export function quickOperations(
  edits: readonly QuickEdit[],
  slides: readonly QuickSlide[],
  /** The content area inside the slide's margins (shares of the slide), when they are set. */
  margins: ContentArea | null = null,
  options: QuickOptions = {},
): SlideOperation[] | null {
  const plan = quickPlan(edits, slides, margins, options);
  return 'operations' in plan ? plan.operations : null;
}

export interface QuickOptions {
  /** The page, cm – new elements' sizes and the gaps of lines (16:9 when not said). */
  page?: { width: number; height: number };
  /** The slide (of `slides`) new elements go on when they name no element there. */
  on?: number;
  /** The id of a new element or slide (the editor's: `sl…`). */
  newId?: () => string;
  /** The layouts a new slide can take (none: no new slide but copies). */
  layouts?: readonly QuickLayout[];
  /** Kinds of edits refused, and why – e.g. the slide tools the full AI has for them. */
  refuse?: (edit: QuickEdit) => string | null;
}

/**
 * The edits as the editor's operations, one after another: an edit may add an element (`add`, a
 * copy with `copy_of`) – on top, as the editor adds it: the deck's text style, its id `sl…` – and
 * later edits name it by its `name`. Places worked out as for any element.
 */
export function quickPlan(
  edits: readonly QuickEdit[],
  slides: readonly QuickSlide[],
  margins: ContentArea | null = null,
  options: QuickOptions = {},
): QuickPlan | QuickProblem {
  const page = options.page ?? PAGE;
  const newId = options.newId ?? (() => `sl${crypto.randomUUID()}`);
  const names = new Map<string, string>();
  const resolve = (ref: string) => names.get(ref) ?? ref;
  // The slides as the edits leave them – new elements on top, moved ones where they went.
  const working = slides.map((slide) => ({
    pageId: slide.pageId ?? null,
    elements: [...slide.elements],
  }));
  const deleted = new Set(
    edits.flatMap((edit) => (edit.delete && edit.element ? [edit.element] : [])),
  );
  const boxOf = new Map<string, ElementBox>();
  for (const slide of slides) {
    for (const element of slide.elements) {
      const moved = edits.findLast((each) => each.element === element.id && each.box)?.box;
      boxOf.set(element.id, moved ? fraction(moved) : element.bbox);
    }
  }
  // Where the edits before moved an element – where the next edit of it starts from.
  const movedBy = new Map<string, ElementBox>();
  const slideOf = (id: string) =>
    working.find((slide) => slide.elements.some((element) => element.id === id));
  const othersOn = (slide: (typeof working)[number], self: string | null) =>
    new Map(
      slide.elements.flatMap((other) =>
        other.id === self || deleted.has(other.id)
          ? []
          : [[other.id, boxOf.get(other.id) ?? other.bbox] as const],
      ),
    );
  const operations: SlideOperation[] = [];
  const added: QuickPlan['added'] = [];
  const fills: QuickFill[] = [];
  const kinds = new Map<string, NewKind>();
  for (const [at, edit] of edits.entries()) {
    if (!edit.slide && !edit.new_slide) continue;
    const other = Object.keys(edit).find(
      (key) => !SLIDE_KEYS.has(key) && given(edit[key as keyof QuickEdit]),
    );
    if (other) return { problem: `a slide has no ${other} – give it its elements`, index: at };
  }
  for (const [asked, index] of slideTexts(edits, slides)) {
    const fail = (problem: string): QuickProblem => ({ problem, index });
    if (!saysWhich(asked)) {
      return fail('give exactly one of element, add, copy_of, group, slide and new_slide');
    }
    const refused = options.refuse?.(asked);
    if (refused) return fail(refused);
    const edit = resolved(asked, resolve);
    if (edit.slide || edit.new_slide) {
      const made = slideEdit(edit, slides, options.layouts ?? [], newId);
      if ('problem' in made) return fail(made.problem);
      operations.push(...made.operations);
      if (made.fill) fills.push(made.fill);
      continue;
    }
    if (edit.group) {
      const slide = slideOf(edit.group[0]!);
      if (!slide || !edit.group.every((id) => slide.elements.some((each) => each.id === id))) {
        return fail('the elements grouped must all be on one slide');
      }
      if (new Set(edit.group).size < 2) return fail('a group needs two elements or more');
      if (asked.name && names.has(asked.name)) return fail(`the name ${asked.name} is taken`);
      const id = newId();
      operations.push({ type: 'groupElements', elementIds: [...edit.group], newElementId: id });
      if (asked.name) names.set(asked.name, id);
      added.push({ name: asked.name ?? null, id });
      continue;
    }
    if (edit.add || edit.copy_of) {
      const anchor =
        edit.copy_of ??
        edit.next_to?.element ??
        (edit.from && 'element' in edit.from ? edit.from.element : undefined) ??
        (edit.to && 'element' in edit.to ? edit.to.element : undefined) ??
        edit.align_with?.[0]?.element ??
        edit.size_like?.element;
      const slide = anchor ? slideOf(anchor) : working[options.on ?? 0];
      if (!slide) return fail(`there is no element ${anchor ?? ''} on the slide`);
      if (!slide.pageId) return fail('nothing can be added on this slide');
      if (asked.name && names.has(asked.name)) return fail(`the name ${asked.name} is taken`);
      const id = newId();
      const area = margins ?? contentAreaOf(slide.elements);
      const made = newElementOperations(edit, {
        id,
        pageId: slide.pageId,
        elements: slide.elements,
        boxes: othersOn(slide, null),
        area,
        page,
        alike: (other) => !!edit.add && kinds.get(other) === edit.add,
      });
      if ('problem' in made) return fail(made.problem);
      operations.push(...made.operations);
      slide.elements.push(made.element);
      boxOf.set(id, made.element.bbox);
      if (asked.name) names.set(asked.name, id);
      if (edit.add) kinds.set(id, edit.add);
      added.push({ name: asked.name ?? null, id });
      continue;
    }
    const slide = slideOf(edit.element!);
    const element = slide?.elements.find((candidate) => candidate.id === edit.element);
    if (!slide || !element) return fail(`there is no element ${asked.element}`);
    const area = margins ?? contentAreaOf(slide.elements);
    const made = elementOperations(
      edit,
      { ...element, bbox: movedBy.get(element.id) ?? element.bbox },
      slide.elements.length,
      othersOn(slide, element.id),
      area,
    );
    if (!made || made.length === 0) {
      return fail(
        'the editor cannot change the element so (it may not move, have no text the editor can take, or the change says nothing, or there is no free place there)',
      );
    }
    for (const operation of made) {
      if (operation.type !== 'setBox') continue;
      boxOf.set(operation.elementId, operation.box);
      movedBy.set(operation.elementId, operation.box);
    }
    operations.push(...made);
  }
  return operations.length > 0
    ? { operations, added, fills }
    : { problem: 'nothing to do', index: -1 };
}

/** The layout a new slide asks for by name – or, none named, the one fitting what goes in. */
function layoutFor(
  asked: string | null | undefined,
  layouts: readonly QuickLayout[],
  like: string,
  wants: { title: boolean; text: boolean },
): QuickLayout | string {
  if (layouts.length === 0) return 'this deck has no layouts for a new slide';
  if (asked) {
    const key = asked
      .replace(/[„“"']/g, '')
      .trim()
      .toLowerCase();
    const found = layouts.find(
      (layout) => layout.name.toLowerCase() === key || layout.displayName?.toLowerCase() === key,
    );
    return found ?? `there is no layout ${asked} – the layouts: ${layoutNames(layouts)}`;
  }
  const fits = (layout: QuickLayout) =>
    (!wants.title || layout.kinds.includes('title')) &&
    (!wants.text || layout.kinds.includes('outline'));
  const before = layouts.find((layout) => layout.pages.includes(like));
  if (before && fits(before)) return before;
  // The fitting one most slides are on – a deck's content layout rather than its title slide's.
  const fitting = layouts.filter(fits).sort((a, b) => b.pages.length - a.pages.length);
  return fitting[0] ?? before ?? layouts[0]!;
}

const layoutNames = (layouts: readonly QuickLayout[]) =>
  layouts.map((layout) => `„${layout.displayName ?? layout.name}“`).join(', ');

/** The operations of an edit of a slide, or of a new one – and what goes into a new one. */
function slideEdit(
  edit: QuickEdit,
  slides: readonly QuickSlide[],
  layouts: readonly QuickLayout[],
  newId: () => string,
): { operations: SlideOperation[]; fill: QuickFill | null } | QuickProblem {
  const problem = (text: string): QuickProblem => ({ problem: text, index: -1 });
  const pageOf = (number: number): string | null => slides[number - 1]?.pageId ?? null;
  const operations: SlideOperation[] = [];
  let pageId: string;
  let fill: QuickFill | null = null;
  if (edit.new_slide) {
    const { after, copy_of: copyOf, layout } = edit.new_slide;
    if (after > slides.length) return problem(`there is no slide ${after}`);
    const afterPage = after === 0 ? null : pageOf(after);
    const like = pageOf(Math.max(1, after));
    if ((after > 0 && !afterPage) || !like) return problem('slides cannot be added here');
    pageId = newId();
    if (copyOf) {
      const source = pageOf(copyOf);
      if (!source) return problem(`there is no slide ${copyOf} to copy`);
      operations.push({
        type: 'duplicateSlide',
        pageId: source,
        newPageId: pageId,
        after: afterPage,
      });
    } else {
      const chosen = layoutFor(layout, layouts, like, {
        title: given(edit.title),
        text: given(edit.text) && edit.text.length > 0,
      });
      if (typeof chosen === 'string') return problem(chosen);
      operations.push({
        type: 'addSlide',
        like,
        newPageId: pageId,
        after: afterPage,
        master: chosen.name,
      });
    }
    if (given(edit.title) || given(edit.text)) {
      fill = { pageId, title: edit.title ?? null, text: edit.text ?? null };
    }
  } else {
    const page = pageOf(edit.slide!);
    if (!page) return problem(`there is no slide ${edit.slide}`);
    pageId = page;
    if (given(edit.title) || given(edit.text)) {
      return problem('a slide’s texts are its elements’ – change them by their ids');
    }
    if (edit.delete) return { operations: [{ type: 'deleteSlide', pageId }], fill: null };
    if (edit.duplicate) {
      operations.push({ type: 'duplicateSlide', pageId, newPageId: newId(), after: pageId });
    }
    if (given(edit.move_after)) {
      if (edit.move_after > slides.length) return problem(`there is no slide ${edit.move_after}`);
      const after = edit.move_after === 0 ? null : pageOf(edit.move_after);
      if (after === pageId) return problem('a slide cannot go right after itself');
      operations.push({ type: 'moveSlide', pageId, after });
    }
  }
  if (given(edit.hidden)) operations.push({ type: 'setSlideHidden', pageId, hidden: edit.hidden });
  if (given(edit.background)) {
    operations.push({
      type: 'setSlideBackground',
      pageId,
      color: edit.background === 'master' ? null : edit.background.toLowerCase(),
    });
  }
  if (given(edit.transition)) {
    operations.push({ type: 'setSlideTransition', pageId, transition: edit.transition });
  }
  if (given(edit.notes)) {
    operations.push({ type: 'setSlideNotes', pageId, text: edit.notes.join('\n') });
  }
  if (operations.length === 0) return problem('the edit says nothing to do with the slide');
  return { operations, fill };
}

/** The deck's layouts for new slides: its master pages, their placeholders, the slides on them. */
export function quickLayouts(document: OdpDocument): QuickLayout[] {
  const pages = document.pageIds();
  const users = new Map<string, string[]>();
  pages.forEach((pageId, index) => {
    const master = /draw:master-page-name="([^"]*)"/.exec(document.slideXml(index))?.[1];
    if (master) users.set(master, [...(users.get(master) ?? []), pageId]);
  });
  return document.masterPages().map((page) => ({
    name: page.name,
    displayName: page.displayName,
    // What a new slide of it gets (a title master's subtitle stands for its text frame).
    kinds: [...new Set(slidePlaceholders(page).map((placeholder) => placeholder.kind))],
    pages: users.get(page.name) ?? [],
  }));
}

/** The layouts in a line each, for the fast models: „name“ (its placeholders). */
export function layoutLines(layouts: readonly QuickLayout[]): string[] {
  return layouts
    .slice(0, 30)
    .map(
      (layout) =>
        `„${layout.displayName ?? layout.name}“ (${layout.kinds.map((kind) => (kind === 'outline' ? 'text' : kind)).join(', ') || 'empty'})`,
    );
}

/**
 * The edits applied to `document` one after another, as the editor's operations – texts for a
 * new slide's placeholders once it is there. The operations made, or why not (the document then
 * half changed: throw it away).
 */
export function applyQuickEdits(
  document: OdpDocument,
  edits: readonly QuickEdit[],
  margins: ContentArea | null,
  options: Omit<QuickOptions, 'layouts'> = {},
): QuickPlan | QuickProblem {
  const page = options.page ?? document.pageSize();
  const plan = quickPlan(edits, document.slides(), margins, {
    ...options,
    page,
    layouts: quickLayouts(document),
  });
  if ('problem' in plan) return plan;
  document.apply(plan.operations);
  const operations = [...plan.operations];
  for (const fill of plan.fills) {
    const slides = document.slides();
    const slide = slides.find((each) => each.pageId === fill.pageId);
    if (!slide) return { problem: 'the new slide is not there', index: -1 };
    const title = slide.elements.find((element) => element.role === 'title');
    const body =
      slide.elements.find((element) => element.role === 'outline') ??
      slide.elements.find((element) => element.role === 'subtitle');
    if (fill.title !== null && !title) {
      return { problem: 'the new slide’s layout has no title', index: -1 };
    }
    if (fill.text !== null && fill.text.length > 0 && !body) {
      return { problem: 'the new slide’s layout has no text placeholder', index: -1 };
    }
    const texts: QuickEdit[] = [
      ...(fill.title !== null && title ? [{ element: title.id, text: [fill.title] }] : []),
      ...(fill.text !== null && fill.text.length > 0 && body
        ? [{ element: body.id, text: fill.text }]
        : []),
    ];
    if (texts.length === 0) continue;
    const filled = quickPlan(texts, slides, margins, { ...options, page });
    if ('problem' in filled) return filled;
    document.apply(filled.operations);
    operations.push(...filled.operations);
  }
  return { operations, added: plan.added, fills: plan.fills };
}

/** What an edit of a slide (or a new one) may say. */
const SLIDE_KEYS = new Set([
  'slide',
  'new_slide',
  'title',
  'text',
  'background',
  'transition',
  'notes',
  'hidden',
  'move_after',
  'duplicate',
  'delete',
  'text_color',
]);

/**
 * A slide's `text_color` (its background turned dark: light text) as an edit of each of its
 * texts the editor writes, after it.
 */
function slideTexts(
  edits: readonly QuickEdit[],
  slides: readonly QuickSlide[],
): [edit: QuickEdit, index: number][] {
  return edits.flatMap((edit, index): [QuickEdit, number][] => {
    if (!edit.slide || !given(edit.text_color)) return [[edit, index]];
    const texts = (slides[edit.slide - 1]?.elements ?? []).filter(
      (element) => element.live && element.paragraphs?.some((paragraph) => paragraph.trim()),
    );
    const rest = { ...edit, text_color: null };
    // Nothing else of the slide said: only its texts.
    const more = Object.keys(rest).some(
      (key) => key !== 'slide' && given(rest[key as keyof QuickEdit]),
    );
    return [
      ...(more ? [[rest, index] as [QuickEdit, number]] : []),
      ...texts.map((element): [QuickEdit, number] => [
        { element: element.id, text_color: edit.text_color },
        index,
      ]),
    ];
  });
}

/** The edit with the names of new elements it refers to replaced by their ids. */
function resolved(edit: QuickEdit, resolve: (ref: string) => string): QuickEdit {
  const end = (value: QuickEdit['from']) =>
    value && 'element' in value ? { element: resolve(value.element) } : value;
  return {
    ...edit,
    ...(edit.element ? { element: resolve(edit.element) } : {}),
    ...(edit.copy_of ? { copy_of: resolve(edit.copy_of) } : {}),
    ...(edit.group ? { group: edit.group.map(resolve) } : {}),
    ...(edit.next_to
      ? { next_to: { ...edit.next_to, element: resolve(edit.next_to.element) } }
      : {}),
    ...(edit.align_with
      ? {
          align_with: edit.align_with.map((align) => ({
            ...align,
            element: resolve(align.element),
          })),
        }
      : {}),
    ...(edit.size_like
      ? { size_like: { ...edit.size_like, element: resolve(edit.size_like.element) } }
      : {}),
    ...(edit.from ? { from: end(edit.from) } : {}),
    ...(edit.to ? { to: end(edit.to) } : {}),
  };
}

/** A new text looks like the slide's body text (not its title), else plain – as the editor's. */
function textStyleOn(elements: readonly EditableElement[]): LiveTextStyle {
  const body = elements.find(
    (element) => element.live && element.role !== 'title' && !element.live.placeholder,
  );
  const mark = body?.live?.paragraphs[0]?.mark;
  if (!mark) return DEFAULT_STYLE;
  return {
    font: mark.font,
    size: Math.min(mark.size, 28),
    color: mark.color,
    bold: false,
    italic: false,
    underline: false,
  };
}

interface NewPlace {
  id: string;
  pageId: string;
  /** The slide's elements (new ones of the edits before included). */
  elements: readonly EditableElement[];
  /** The others' boxes as the edits leave them, by id. */
  boxes: ReadonlyMap<string, ElementBox>;
  area: ContentArea;
  page: { width: number; height: number };
  /** Whether an element is one of the same kind added by the edits before. */
  alike?: (id: string) => boolean;
}

/** The operations that add an element as the edit asks, and the element as the editor sees it. */
function newElementOperations(
  edit: QuickEdit,
  place: NewPlace,
): { operations: SlideOperation[]; element: EditableElement } | QuickProblem {
  const problem = (text: string): QuickProblem => ({ problem: text, index: -1 });
  const { id, pageId, boxes, page } = place;
  const aspect = page.width / page.height;
  const placement = { ...edit, box: null, place: null, align_with: null, size_like: null };
  if (edit.copy_of) {
    const source = place.elements.find((element) => element.id === edit.copy_of);
    if (!source) return problem(`there is no element ${edit.copy_of} to copy`);
    const from = boxes.get(source.id) ?? source.bbox;
    const box = newBox(edit, { w: from.w, h: from.h }, place, {
      ...from,
      x: from.x + from.w + GAP.x,
    });
    if ('problem' in box) return box;
    const element: EditableElement = { ...source, id, bbox: box, locked: false };
    const operations: SlideOperation[] = [
      { type: 'copyElement', elementId: source.id, pageId, newElementId: id, box },
    ];
    // What else it asks, as of any element.
    const rest = elementOperations(
      placement,
      element,
      place.elements.length + 1,
      boxes,
      place.area,
    );
    if (!rest) return problem('the copy cannot be changed so');
    return { operations: [...operations, ...rest], element };
  }
  const kind = edit.add!;
  if (kind === 'line' || kind === 'arrow') {
    const ends = lineEnds(edit, boxes, page);
    if ('problem' in ends) return ends;
    if (edit.border === 'none') return problem('a line needs a border (its colour and width)');
    const stroke = edit.border
      ? { color: edit.border.color.toLowerCase(), width: edit.border.width }
      : NEW_LINE_STROKE;
    const { box, flip } = lineBetween(ends.from, ends.to);
    const heads = edit.heads ?? (kind === 'arrow' ? 'end' : 'none');
    const operation: AddElementOperation = {
      type: 'addElement',
      pageId,
      elementId: id,
      kind: 'line',
      box,
      flip,
      heads,
      fill: null,
      stroke,
      paragraphs: [],
    };
    const element: EditableElement = {
      id,
      kind: 'line',
      name: kind === 'arrow' ? 'Pfeil' : 'Linie',
      role: null,
      bbox: box,
      rotation: 0,
      paragraphs: null,
      movable: true,
      resizable: true,
      live: null,
      credit: null,
      look: { fill: null, fills: [], fillAspect: null, stroke, effects: NO_EFFECTS },
      tilt: null,
      flip,
      line: { heads },
    };
    return { operations: [operation, ...orderOperations(edit, id)], element };
  }
  const text = kind === 'text';
  const base = textStyleOn(place.elements);
  const style: LiveTextStyle = {
    ...base,
    ...(given(edit.font_size) ? { size: edit.font_size } : {}),
    ...(given(edit.font) ? { font: freeFontName(edit.font) } : {}),
    ...(given(edit.text_color) ? { color: edit.text_color.toLowerCase() } : {}),
    ...(given(edit.bold) ? { bold: edit.bold } : {}),
    ...(given(edit.italic) ? { italic: edit.italic } : {}),
    ...(given(edit.underline) ? { underline: edit.underline } : {}),
  };
  const align = edit.align ?? (text ? 'left' : 'center');
  const lines = edit.text && edit.text.length > 0 ? edit.text : [''];
  const paragraphs: RichParagraph[] = lines.map((line) => ({
    align,
    runs: [{ ...style, text: line }],
  }));
  const fill =
    edit.fill === 'none' ? null : (edit.fill?.toLowerCase() ?? (text ? null : NEW_BOX_FILL));
  const stroke =
    edit.border && edit.border !== 'none'
      ? { color: edit.border.color.toLowerCase(), width: edit.border.width }
      : null;
  // Text: as high as its lines (it grows with them in the file); shapes: square.
  const lineHeight = (style.size * 1.2 * 2.54) / 72;
  const size = text
    ? { w: 0.3, h: (lines.length * lineHeight + 0.25) / page.height }
    : { w: 0.12, h: 0.12 * aspect };
  const box = newBox(edit, size, place, null, text);
  if ('problem' in box) return box;
  const shape = text ? undefined : (kind as NewShape);
  const operation: AddElementOperation = {
    type: 'addElement',
    pageId,
    elementId: id,
    kind: text ? 'text' : 'rect',
    ...(shape ? { shape } : {}),
    box,
    fill,
    stroke,
    paragraphs,
  };
  const operations: SlideOperation[] = [operation];
  const verticalAlign = edit.vertical_align ?? null;
  if (verticalAlign && verticalAlign !== (text ? 'top' : 'middle')) {
    operations.push({ type: 'setShapeStyle', elementId: id, verticalAlign });
  }
  operations.push(...orderOperations(edit, id));
  const element: EditableElement = {
    id,
    kind: text ? 'text' : 'shape',
    name: text ? 'Textfeld' : String(shape),
    role: null,
    bbox: box,
    rotation: 0,
    paragraphs: lines,
    movable: true,
    resizable: true,
    live: {
      fill,
      stroke,
      padding: { top: 3.5, bottom: 3.5, left: 7, right: 7 },
      verticalAlign: verticalAlign ?? (text ? 'top' : 'middle'),
      autoGrow: text,
      placeholder: false,
      paragraphs: paragraphs.map((paragraph) => ({
        ...plainParagraph(style),
        align: paragraph.align,
        runs: paragraph.runs.filter((run) => run.text),
      })),
    },
    credit: null,
    look: {
      fill,
      fills: [],
      fillAspect: null,
      stroke,
      effects: NO_EFFECTS,
    },
    tilt: null,
    flip: text ? null : { x: false, y: false },
  };
  // Effects, corners, a turn asked with it: as of any element.
  const extra = {
    shadow: edit.shadow,
    glow: edit.glow,
    soft_edge: edit.soft_edge,
    backdrop_blur: edit.backdrop_blur,
    corner_radius: edit.corner_radius,
    rotation: edit.rotation,
    mirror: edit.mirror,
    locked: edit.locked,
  };
  if (Object.values(extra).some(given)) {
    const rest = elementOperations(extra, element, place.elements.length + 1, boxes, place.area);
    if (!rest) return problem('the new element cannot be changed so');
    operations.push(...rest);
  }
  return { operations, element };
}

/** A new element sent to the back (it comes on top). */
const orderOperations = (edit: QuickEdit, id: string): SlideOperation[] =>
  edit.order === 'back' ? [{ type: 'moveElement', elementId: id, to: 0 }] : [];

/**
 * Where a new element goes: its `box`; else beside another (`next_to`), at a place in words
 * (clear of the others), or `fallback`; its size the box's, `size`, like another's or `size`
 * given here – then lined up (`align_with`). Never off the slide.
 */
function newBox(
  edit: QuickEdit,
  defaultSize: { w: number; h: number },
  place: NewPlace,
  fallback: ElementBox | null,
  /** A text: as high as its lines whatever its width. */
  textLike = false,
): ElementBox | QuickProblem {
  const problem = (text: string): QuickProblem => ({ problem: text, index: -1 });
  const { boxes, area } = place;
  let size = edit.box ? { w: edit.box.w / 100, h: edit.box.h / 100 } : defaultSize;
  if (!edit.box && edit.size) {
    // One side given: the other as the default's proportions say – a text keeps its lines' height.
    const w = given(edit.size.w) ? edit.size.w / 100 : null;
    const h = given(edit.size.h) ? edit.size.h / 100 : null;
    size = {
      w: w ?? (h !== null ? (defaultSize.w * h) / defaultSize.h : defaultSize.w),
      h: h ?? (w !== null && !textLike ? (defaultSize.h * w) / defaultSize.w : defaultSize.h),
    };
  }
  if (edit.size_like) {
    const like = boxes.get(edit.size_like.element);
    if (!like) return problem(`there is no element ${edit.size_like.element} to size it like`);
    // Neither said: as big as it.
    const both = !edit.size_like.width && !edit.size_like.height;
    size = {
      w: both || edit.size_like.width ? like.w : size.w,
      h: both || edit.size_like.height ? like.h : size.h,
    };
  } else if (!edit.box && !edit.size && edit.next_to && place.alike?.(edit.next_to.element)) {
    // Beside one of its kind made just before („zwei Kreise“): as big as that one.
    const like = boxes.get(edit.next_to.element);
    if (like) size = { w: like.w, h: like.h };
  }
  let box: ElementBox | null = null;
  // With `next_to` or `place` a box gives only the size (the fast model fills its x, y anyhow).
  if (edit.box && !edit.next_to && !edit.place) box = fraction(edit.box);
  else if (edit.next_to) {
    const other = boxes.get(edit.next_to.element);
    if (!other) return problem(`there is no element ${edit.next_to.element} to put it next to`);
    const side = edit.next_to.side;
    const across = side === 'right' || side === 'left';
    const gap = given(edit.next_to.gap) ? edit.next_to.gap / 100 : across ? GAP.x : GAP.y;
    box =
      side === 'right'
        ? { ...size, x: other.x + other.w + gap, y: other.y + other.h / 2 - size.h / 2 }
        : side === 'left'
          ? { ...size, x: other.x - gap - size.w, y: other.y + other.h / 2 - size.h / 2 }
          : side === 'below'
            ? { ...size, x: other.x, y: other.y + other.h + gap }
            : { ...size, x: other.x, y: other.y - gap - size.h };
  } else if (edit.place) {
    box = clearOf(
      placed(edit.place, { x: 0, y: 0, ...size }, area),
      { x: -1, y: -1, w: 0, h: 0 },
      [...boxes.values()],
      inHalf(edit.place, area),
    );
    if (!box) return problem('there is no free room at that place');
  } else if (fallback) box = { ...fallback, ...size };
  if (!box) return problem('say where it goes: box, next_to or place');
  for (const align of edit.align_with ?? []) {
    const other = boxes.get(align.element);
    if (!other) return problem(`there is no element ${align.element} to line it up with`);
    box = lineUp(box, other, align.edge);
  }
  if (box.w <= 0 || box.h <= 0) return problem('it needs a width and a height');
  if (!onSlide(box))
    return problem('it would leave the slide – make it smaller or put it elsewhere');
  return box;
}

/**
 * A new line's ends: from an element's edge facing the other end to the other (or a point) – a
 * line between two elements side by side or one above the other runs straight across, a gap
 * from each. Else the corners of its `box`.
 */
function lineEnds(
  edit: QuickEdit,
  boxes: ReadonlyMap<string, ElementBox>,
  page: { width: number; height: number },
): { from: { x: number; y: number }; to: { x: number; y: number } } | QuickProblem {
  const ends = lineEndsOf(edit, boxes, page);
  if ('problem' in ends) return ends;
  const length = Math.hypot(
    (ends.to.x - ends.from.x) * page.width,
    (ends.to.y - ends.from.y) * page.height,
  );
  return length < MIN_LINE_CM
    ? {
        problem: `the line would be only ${length.toFixed(1)} cm long – make room between its ends first (move or resize them)`,
        index: -1,
      }
    : ends;
}

function lineEndsOf(
  edit: QuickEdit,
  boxes: ReadonlyMap<string, ElementBox>,
  page: { width: number; height: number },
): { from: { x: number; y: number }; to: { x: number; y: number } } | QuickProblem {
  const problem = (text: string): QuickProblem => ({ problem: text, index: -1 });
  if (!edit.from || !edit.to) {
    if (!edit.box) return problem('a line needs from and to (or a box from corner to corner)');
    const box = fraction(edit.box);
    return { from: { x: box.x, y: box.y }, to: { x: box.x + box.w, y: box.y + box.h } };
  }
  const end = (value: NonNullable<QuickEdit['from']>) => {
    if ('element' in value) {
      const box = boxes.get(value.element);
      return box ? { box } : null;
    }
    return { point: { x: value.x / 100, y: value.y / 100 } };
  };
  const a = end(edit.from);
  const b = end(edit.to);
  if (!a || !b) return problem('a line end names no element of the slide');
  const gapX = LINE_GAP_CM / page.width;
  const gapY = LINE_GAP_CM / page.height;
  if (a.box && b.box) {
    const [p, q] = [a.box, b.box];
    const top = Math.max(p.y, q.y);
    const bottom = Math.min(p.y + p.h, q.y + q.h);
    const left = Math.max(p.x, q.x);
    const right = Math.min(p.x + p.w, q.x + q.w);
    // Side by side: straight across, in the middle of what they share.
    if (bottom > top && (p.x + p.w <= q.x || q.x + q.w <= p.x)) {
      const y = (top + bottom) / 2;
      return p.x < q.x
        ? { from: { x: p.x + p.w + gapX, y }, to: { x: q.x - gapX, y } }
        : { from: { x: p.x - gapX, y }, to: { x: q.x + q.w + gapX, y } };
    }
    if (right > left && (p.y + p.h <= q.y || q.y + q.h <= p.y)) {
      const x = (left + right) / 2;
      return p.y < q.y
        ? { from: { x, y: p.y + p.h + gapY }, to: { x, y: q.y - gapY } }
        : { from: { x, y: p.y - gapY }, to: { x, y: q.y + q.h + gapY } };
    }
  }
  const centre = (side: NonNullable<typeof a>) =>
    side.box ? { x: side.box.x + side.box.w / 2, y: side.box.y + side.box.h / 2 } : side.point!;
  const [ca, cb] = [centre(a), centre(b)];
  // From a box's centre towards the other end: where that leaves the box, a gap beyond.
  const exit = (box: ElementBox | undefined, from: { x: number; y: number }, to: typeof from) => {
    if (!box) return from;
    const dx = (to.x - from.x) * page.width;
    const dy = (to.y - from.y) * page.height;
    const length = Math.hypot(dx, dy);
    if (length === 0) return null;
    const t = Math.min(
      dx === 0 ? Infinity : (box.w * page.width) / 2 / Math.abs(dx),
      dy === 0 ? Infinity : (box.h * page.height) / 2 / Math.abs(dy),
    );
    const s = t + LINE_GAP_CM / length;
    if (s >= 1) return null;
    return { x: from.x + (dx * s) / page.width, y: from.y + (dy * s) / page.height };
  };
  const from = exit(a.box, ca, cb);
  const to = exit(b.box, cb, ca);
  if (!from || !to) return problem('the line’s ends overlap – nothing to draw between them');
  return { from, to };
}

function elementOperations(
  asked: QuickEdit,
  element: EditableElement,
  count: number,
  /** The slide's other elements as the edits leave them, by id. */
  boxes: ReadonlyMap<string, ElementBox>,
  area: ContentArea,
): SlideOperation[] | null {
  const id = element.id;
  if (asked.delete) return [{ type: 'deleteElement', elementId: id }];
  const edit = withTextPlaced(asked, element);
  const operations: SlideOperation[] = [];
  if (edit.box || edit.place || edit.align_with?.length || edit.size_like) {
    if (!element.movable) return null;
    let box: ElementBox | null = edit.box ? fraction(edit.box) : { ...element.bbox };
    // „Like itself“, or neither width nor height: says nothing – left out.
    const sizeLike =
      edit.size_like &&
      edit.size_like.element !== id &&
      (edit.size_like.width || edit.size_like.height)
        ? edit.size_like
        : null;
    if (sizeLike) {
      const like = boxes.get(sizeLike.element);
      if (!like) return null;
      if (sizeLike.width) box = { ...box, w: like.w };
      if (sizeLike.height) box = { ...box, h: like.h };
    }
    // An element that only moves keeps its size.
    if (!element.resizable) box = { ...box, w: element.bbox.w, h: element.bbox.h };
    if (box.w <= 0 || box.h <= 0) return null;
    // A place in words is worked out clear of the others – nowhere free there, the AI makes
    // room. A box the model worked out stays: it may lie on another element on purpose.
    if (edit.place) {
      box = clearOf(
        placed(edit.place, box, area),
        element.bbox,
        [...boxes.values()],
        inHalf(edit.place, area),
      );
    }
    for (const align of edit.align_with ?? []) {
      const other = boxes.get(align.element);
      if (!other || !box) return null;
      box = lineUp(box, other, align.edge);
    }
    if (!box) return null;
    operations.push({ type: 'setBox', elementId: id, box });
  }
  if (given(edit.rotation) || given(edit.mirror)) {
    if (!element.movable) return null;
    const flip = element.flip;
    if (given(edit.mirror) && !flip) return null;
    const turned = {
      ...(given(edit.rotation) ? { rotation: edit.rotation } : {}),
      ...(given(edit.mirror) && flip
        ? {
            flip: edit.mirror === 'horizontal' ? { ...flip, x: !flip.x } : { ...flip, y: !flip.y },
          }
        : {}),
    };
    const moved = operations.find((operation) => operation.type === 'setBox');
    if (moved) Object.assign(moved, turned);
    else operations.push({ type: 'setBox', elementId: id, box: { ...element.bbox }, ...turned });
  }
  if (given(edit.fill) || given(edit.border) || given(edit.vertical_align)) {
    // Fill and border only where the editor sets them; the text's place in a text frame too.
    if ((given(edit.fill) || given(edit.border)) && !element.look) return null;
    if (given(edit.vertical_align) && !element.live) return null;
    operations.push({
      type: 'setShapeStyle',
      elementId: id,
      ...(given(edit.fill) ? { fill: edit.fill === 'none' ? null : edit.fill.toLowerCase() } : {}),
      ...(given(edit.border)
        ? {
            stroke:
              edit.border === 'none'
                ? null
                : { color: edit.border.color.toLowerCase(), width: edit.border.width },
          }
        : {}),
      ...(given(edit.vertical_align) ? { verticalAlign: edit.vertical_align } : {}),
    });
  }
  // An empty list placeholder (a layout's „Text“) filled: its paragraphs are its points – plain
  // paragraphs there show no bullets.
  const points = given(edit.text) && element.role === 'outline' && !!element.live?.placeholder;
  if (given(edit.text) && !points) {
    if (element.paragraphs === null) return null;
    operations.push({ type: 'setText', elementId: id, paragraphs: edit.text });
  }
  if (points || TEXT_STYLE_KEYS.some((key) => given(edit[key]))) {
    const paragraphs = styledText(edit, element);
    if (!paragraphs) return null;
    operations.push({
      type: 'setRichText',
      elementId: id,
      paragraphs: points
        ? paragraphs.map((paragraph) => ({ ...paragraph, list: { kind: 'bullet', level: 1 } }))
        : paragraphs,
    });
  }
  if (given(edit.order)) {
    // Counted from the bottom without the element itself.
    operations.push({
      type: 'moveElement',
      elementId: id,
      to: edit.order === 'back' ? 0 : Math.max(0, count - 1),
    });
  }
  const effects = effectsAsked(edit, element);
  if (effects === null) return null;
  if (effects) operations.push(effects);
  if (given(edit.heads)) {
    if (element.kind !== 'line') return null;
    operations.push({ type: 'setShapeStyle', elementId: id, heads: edit.heads });
  }
  if (given(edit.corner_radius)) {
    if (element.kind !== 'shape') return null;
    operations.push({ type: 'setCornerRadius', elementId: id, radius: edit.corner_radius });
  }
  if (given(edit.picture_fit)) {
    if (element.kind !== 'image') return null;
    operations.push({ type: 'setImageFit', elementId: id, fit: edit.picture_fit });
  }
  if (given(edit.locked))
    operations.push({ type: 'setLocked', elementId: id, locked: edit.locked });
  if (edit.ungroup) {
    if (element.kind !== 'group') return null;
    operations.push({ type: 'ungroupElements', elementId: id });
  }
  return operations;
}

/** Effects as the editor's „Effekte“ add them (`EffectControls`): their first look. */
const NEW_SHADOW = { x: 0, y: 4, blur: 12, color: '#000000', opacity: 0.25 };
const NEW_SOFT_EDGE = 6;
const NEW_GLOW = { radius: 8, color: '#ffcc00', opacity: 0.6 };
const NEW_BACKDROP = 12;
/** How opaque a fill is made when a backdrop blur comes and nothing would show through it. */
const GLASS_OPACITY = 0.4;

/**
 * The effects an edit asks for, as the editor sets them – `undefined`: it asks for none, `null`:
 * the element takes none (a line, a picture, …). A backdrop blur coming makes a fill nothing would
 * show through see-through, as the editor does.
 */
function effectsAsked(
  edit: QuickEdit,
  element: EditableElement,
): SlideOperation | null | undefined {
  if (![edit.shadow, edit.glow, edit.soft_edge, edit.backdrop_blur].some(given)) return undefined;
  const look = element.look;
  if (!look || element.kind === 'line' || element.kind === 'image' || element.kind === 'group') {
    return null;
  }
  const now = look.effects ?? NO_EFFECTS;
  const effects: ElementEffects = {
    ...now,
    ...(given(edit.shadow) ? { shadow: edit.shadow ? (now.shadow ?? NEW_SHADOW) : null } : {}),
    ...(given(edit.soft_edge) ? { blur: edit.soft_edge ? (now.blur ?? NEW_SOFT_EDGE) : null } : {}),
    ...(given(edit.glow)
      ? {
          glow:
            edit.glow === false
              ? null
              : {
                  ...(now.glow ?? NEW_GLOW),
                  ...(typeof edit.glow === 'string' ? { color: edit.glow.toLowerCase() } : {}),
                },
        }
      : {}),
    ...(given(edit.backdrop_blur)
      ? { backdrop: edit.backdrop_blur ? (now.backdrop ?? NEW_BACKDROP) : null }
      : {}),
  };
  const glass = effects.backdrop !== null && now.backdrop === null ? glassFills(look) : undefined;
  return {
    type: 'setShapeStyle',
    elementId: element.id,
    effects,
    ...(glass ? { fills: glass } : {}),
  };
}

/** The fill a backdrop blur comes with so it shows: see-through white, or its colour so. */
function glassFills(look: NonNullable<EditableElement['look']>): FillLayer[] | undefined {
  const shown = look.fills.filter((layer) => layer.visible);
  if (shown.length === 0 && !look.fill) {
    return [{ type: 'solid', color: '#ffffff', opacity: GLASS_OPACITY, visible: true }];
  }
  if (shown.length === 0 && look.fill) {
    return [{ type: 'solid', color: look.fill, opacity: GLASS_OPACITY, visible: true }];
  }
  const [only] = shown;
  if (shown.length !== 1 || only?.type !== 'solid' || only.opacity < 1) return undefined;
  return look.fills.map((layer) => (layer === only ? { ...layer, opacity: GLASS_OPACITY } : layer));
}

/**
 * The element's text in the style asked for, as the format panel writes it (`richFromLive`):
 * every run restyled, the paragraphs aligned. Text that is changed too goes first (`setText`)
 * – its paragraphs then are those asked for, each in the style of the first run it had.
 */
function styledText(edit: QuickEdit, element: EditableElement): RichParagraph[] | null {
  const live = element.live;
  if (!live) return null;
  const restyle = <T extends LiveTextStyle>(style: T): T => ({
    ...style,
    ...(given(edit.font_size) ? { size: edit.font_size } : {}),
    ...(given(edit.font_scale) && !given(edit.font_size)
      ? { size: Math.max(1, Math.round(style.size * edit.font_scale)) }
      : {}),
    ...(given(edit.font) ? { font: freeFontName(edit.font) } : {}),
    ...(given(edit.text_color) ? { color: edit.text_color.toLowerCase() } : {}),
    ...(given(edit.bold) ? { bold: edit.bold } : {}),
    ...(given(edit.italic) ? { italic: edit.italic } : {}),
    ...(given(edit.underline) ? { underline: edit.underline } : {}),
  });
  const source = given(edit.text)
    ? edit.text.map((text, index) => {
        const like = live.paragraphs[Math.min(index, live.paragraphs.length - 1)];
        const style = like?.runs[0] ?? like?.mark;
        return like && style
          ? { ...like, runs: text ? [{ ...style, text }] : [], mark: like.mark }
          : null;
      })
    : live.paragraphs;
  if (source.some((paragraph) => paragraph === null)) return null;
  return source.map((paragraph) => {
    const runs = paragraph!.runs.filter((run) => run.text).map((run) => restyle(run));
    return {
      align: given(edit.align) ? edit.align : paragraph!.align,
      // An empty paragraph keeps its style as an empty run – its line keeps its height.
      runs: runs.length > 0 ? runs : [{ ...restyle(paragraph!.mark), text: '' }],
    };
  });
}

const SIDES: Record<string, RegExp> = {
  left: /\blinks\b|\bleft\b/i,
  right: /\brechts\b|\bright\b/i,
  top: /\boben\b|\bnach oben\b|\btop\b/i,
  bottom: /\bunten\b|\bnach unten\b|\bbottom\b/i,
};
const OPPOSITE: Record<string, string> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
};

/**
 * Whether the places the edits name agree with what was said – the fast model now and then
 * takes „links“ for right: said only the other side, the AI does it rather than the wrong one.
 */
export function placesAgree(edits: readonly QuickEdit[], said: string): boolean {
  return edits.every((edit) => {
    if (!edit.place) return true;
    return edit.place.split('_').every((side) => {
      const opposite = OPPOSITE[side];
      if (!opposite) return true;
      return !(SIDES[opposite]!.test(said) && !SIDES[side]!.test(said));
    });
  });
}

/** New elements in German, one and several. */
const NEW_NAMES: Record<NewKind | 'copy', [string, string]> = {
  text: ['Textfeld', 'Textfelder'],
  rectangle: ['Rechteck', 'Rechtecke'],
  ellipse: ['Ellipse', 'Ellipsen'],
  'isosceles-triangle': ['Dreieck', 'Dreiecke'],
  diamond: ['Raute', 'Rauten'],
  hexagon: ['Sechseck', 'Sechsecke'],
  'right-arrow': ['Blockpfeil', 'Blockpfeile'],
  star5: ['Stern', 'Sterne'],
  line: ['Linie', 'Linien'],
  arrow: ['Pfeil', 'Pfeile'],
  copy: ['Kopie', 'Kopien'],
};

/** What the edits did, in German – the AI's answer in the comment's thread. */
export function quickSummary(edits: readonly QuickEdit[]): string {
  const did = new Set<string>();
  const made = new Map<string, number>();
  const named = new Set(edits.flatMap((edit) => (edit.name ? [edit.name] : [])));
  for (const edit of edits) {
    if (edit.new_slide) {
      did.add(edit.new_slide.copy_of ? 'Folie kopiert' : 'Folie eingefügt');
      continue;
    }
    if (edit.slide) {
      if (edit.delete) did.add('Folie gelöscht');
      if (edit.duplicate) did.add('Folie dupliziert');
      if (given(edit.move_after)) did.add('Folie verschoben');
      if (given(edit.hidden)) did.add(edit.hidden ? 'Folie ausgeblendet' : 'Folie eingeblendet');
      if (given(edit.background)) did.add('Hintergrund geändert');
      if (given(edit.text_color)) did.add('Schrift angepasst');
      if (given(edit.transition)) did.add('Übergang geändert');
      if (given(edit.notes)) did.add('Notizen geändert');
      continue;
    }
    if (edit.group) {
      did.add('gruppiert');
      continue;
    }
    const kind = edit.copy_of ? 'copy' : edit.add;
    if (kind) {
      made.set(kind, (made.get(kind) ?? 0) + 1);
      continue;
    }
    // Changes of a new one are part of making it.
    if (edit.element && named.has(edit.element)) continue;
    if (edit.delete) did.add('gelöscht');
    if (edit.box || edit.size_like) did.add('Position und Größe angepasst');
    else if (edit.place) did.add('verschoben');
    else if (edit.align_with?.length) did.add('ausgerichtet');
    if (given(edit.fill)) did.add('Füllung geändert');
    if (given(edit.border)) did.add('Rahmen geändert');
    if (given(edit.text)) did.add('Text geändert');
    if (TEXT_STYLE_KEYS.some((key) => given(edit[key])) || given(edit.vertical_align)) {
      did.add('Schrift angepasst');
    }
    if (given(edit.order))
      did.add(edit.order === 'front' ? 'nach vorn geholt' : 'nach hinten gelegt');
    if ([edit.shadow, edit.glow, edit.soft_edge, edit.backdrop_blur].some(given)) {
      did.add('Effekte geändert');
    }
    if (given(edit.rotation)) did.add('gedreht');
    if (given(edit.mirror)) did.add('gespiegelt');
    if (given(edit.corner_radius)) did.add('Ecken geändert');
    if (given(edit.heads)) did.add('Pfeilspitzen geändert');
    if (given(edit.picture_fit)) did.add('Bildeinpassung geändert');
    if (given(edit.locked)) did.add(edit.locked ? 'gesperrt' : 'entsperrt');
    if (edit.ungroup) did.add('Gruppierung aufgehoben');
  }
  const list = [
    ...[...made].map(([kind, n]) => {
      const [one, more] = NEW_NAMES[kind as NewKind | 'copy'];
      return `${n === 1 ? `${one} eingefügt` : `${n} ${more} eingefügt`}`;
    }),
    ...did,
  ];
  const text = list.length > 1 ? `${list.slice(0, -1).join(', ')} und ${list.at(-1)}` : list[0];
  return `Direkt umgesetzt: ${text ?? 'geändert'}.`;
}
