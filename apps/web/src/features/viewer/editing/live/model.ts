import {
  findElement,
  hasShapeOutline,
  nativeFill,
  NO_EFFECTS,
  NEW_LINES,
  NEW_SHAPES,
  textAreaInset,
  turnedCorners,
  turnedLine,
  type AddElementOperation,
  type AddImageOperation,
  type EditableElement,
  type FillLayer,
  type GroupElementsOperation,
  type LiveElement,
  type LiveParagraph,
  type LiveRun,
  type LiveTextStyle,
  type RichParagraph,
  type SlideOperation,
  type TextAlign,
  type TextList,
  withChildren,
} from '@slider/shared';
import {
  DEFAULT_STYLE,
  LIST_INDENT,
  LIST_LABEL_WIDTH,
  listBullet,
  listOf,
  plainParagraph,
} from '@slider/shared/live-text';

export { DEFAULT_STYLE, listOf, plainParagraph };

/*
 * The live editor's text and boxes as plain data: what an operation does to an element before
 * the server answers (shown at once, replaced by the server's reading), and formatting a stretch
 * of text. Positions in text are (paragraph, character) pairs.
 */

export type TextStylePatch = Partial<LiveTextStyle>;

/** The format bar: the focus going there does not end typing on the slide. */
export const TEXT_TOOLBAR_ATTR = 'data-live-toolbar';

/** A button press in the bar must not take the focus out of the text being typed. */
export const keepFocus = (event: { target: EventTarget | null; preventDefault: () => void }) => {
  if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
};

export const styleOf = (run: LiveTextStyle): LiveTextStyle => ({
  font: run.font,
  size: run.size,
  color: run.color,
  bold: run.bold,
  italic: run.italic,
  underline: run.underline,
  ...(run.strike ? { strike: true } : {}),
  ...(run.caps ? { caps: run.caps } : {}),
  ...(run.letterSpacing ? { letterSpacing: run.letterSpacing } : {}),
  ...(run.kerning === false ? { kerning: false as const } : {}),
  ...(run.opacity !== undefined && run.opacity < 1 ? { opacity: run.opacity } : {}),
});

export const sameStyle = (a: LiveTextStyle, b: LiveTextStyle) =>
  a.font === b.font &&
  a.size === b.size &&
  a.color.toLowerCase() === b.color.toLowerCase() &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  !!a.strike === !!b.strike &&
  (a.caps ?? 'none') === (b.caps ?? 'none') &&
  (a.letterSpacing ?? 0) === (b.letterSpacing ?? 0) &&
  a.kerning === b.kerning &&
  (a.opacity ?? 1) === (b.opacity ?? 1);

/** Runs without empty ones, neighbours of one style joined. */
export function normalizeRuns(runs: readonly LiveRun[]): LiveRun[] {
  const out: LiveRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = out.at(-1);
    if (last && sameStyle(last, run)) last.text += run.text;
    else out.push({ ...run });
  }
  return out;
}

export const paragraphText = (paragraph: { runs: readonly LiveRun[] }) =>
  paragraph.runs.map((run) => run.text).join('');

/**
 * The editor's paragraphs as they are written: an empty paragraph keeps its style as an empty
 * run (the file gives it to the paragraph, so its line keeps its height). Lists and line spacing
 * go along – the file changes only what differs.
 */
export const richFromLive = (paragraphs: readonly LiveParagraph[]): RichParagraph[] =>
  paragraphs.map((paragraph) => {
    const runs = normalizeRuns(paragraph.runs);
    return {
      align: paragraph.align,
      runs: runs.length > 0 ? runs : [{ ...styleOf(paragraph.mark), text: '' }],
      list: listOf(paragraph),
      lineSpacing: paragraph.lineSpacing,
    };
  });

/** The style a paragraph's bullet takes after: its first run's, or its mark's. */
const leadOf = (paragraph: LiveParagraph): LiveTextStyle =>
  paragraph.runs.find((run) => run.text.trim()) ?? paragraph.runs[0] ?? paragraph.mark;

/**
 * A paragraph put in a list (`null`: out of it) as it shows until the file says how: with the
 * bullet of a paragraph of `others` in such a list, else the one it had at that level, else as
 * Slider writes a list of its own.
 */
export function withList(
  paragraph: LiveParagraph,
  list: TextList | null,
  others: readonly LiveParagraph[],
): LiveParagraph {
  // Without a bullet it is in none (a list's header line keeps its indent).
  if (!list) {
    return paragraph.bullet
      ? { ...paragraph, level: 0, bullet: null, marginLeft: 0, indent: 0 }
      : paragraph;
  }
  const same = (other: LiveParagraph) => {
    const its = listOf(other);
    return its?.kind === list.kind && its.level === list.level;
  };
  const like = [paragraph, ...others].find(same);
  if (like?.bullet) {
    return {
      ...paragraph,
      level: list.level,
      bullet: { ...like.bullet },
      marginLeft: like.marginLeft,
      indent: like.indent,
    };
  }
  const kept = paragraph.bullet && paragraph.level === list.level ? paragraph.bullet : null;
  const at = kept?.at ?? (list.level - 1) * LIST_INDENT;
  const width = kept?.width ?? LIST_LABEL_WIDTH;
  const lead = leadOf(paragraph);
  const look = { font: null, size: lead.size, color: lead.color, at, width };
  return {
    ...paragraph,
    level: list.level,
    bullet:
      list.kind === 'bullet'
        ? { char: listBullet(list.level), ...look }
        : { char: '', ...look, number: '1', suffix: '.' },
    marginLeft: at + width,
    indent: 0,
  };
}

/**
 * Written paragraphs over the ones there were: each keeps the look of the paragraph at its
 * place (beyond the old ones, of the last), with the new text, runs and alignment.
 */
export function liveFromRich(
  old: readonly LiveParagraph[],
  rich: readonly RichParagraph[],
): LiveParagraph[] {
  return rich.map((paragraph, i) => {
    const runs = normalizeRuns(paragraph.runs);
    const template =
      old[Math.min(i, old.length - 1)] ??
      plainParagraph(paragraph.runs[0] ? styleOf(paragraph.runs[0]) : DEFAULT_STYLE);
    const last = runs.at(-1) ?? paragraph.runs[0];
    const look: LiveParagraph = {
      ...template,
      runs,
      align: paragraph.align,
      mark: last ? styleOf(last) : template.mark,
      ...(paragraph.lineSpacing ? { lineSpacing: paragraph.lineSpacing } : {}),
    };
    return paragraph.list === undefined ? look : withList(look, paragraph.list, old);
  });
}

/** A fill of one colour as layers (`null`: none). */
export const solidFills = (color: string | null): FillLayer[] =>
  color ? [{ type: 'solid', color: color.toLowerCase(), opacity: 1, visible: true }] : [];

/** Moved on the slide by hand: the file lets it, and it is not locked (`setLocked`). */
export const canMove = (element: EditableElement): boolean => element.movable && !element.locked;

/** Sized on the slide by hand too. */
export const canSize = (element: EditableElement): boolean => canMove(element) && element.resizable;

/**
 * A new box's fill, and the border it gets once one is turned on (Rahmen) – a new box has none:
 * slide content, not the app's colours.
 */
export const NEW_BOX = { fill: '#dbeafe', stroke: { color: '#1e40af', width: 1 } };

/** The page's width over its height when the caller does not say: a group's box round turned parts. */
const ASPECT = 16 / 9;

/** Half a box's shorter side in pt: the most its corners round (as `corners.ts` in odp). */
export const maxCornerRadius = (
  box: { w: number; h: number },
  pageSize: { width: number; height: number },
) => (Math.min(box.w * pageSize.width, box.h * pageSize.height) / 2) * (72 / 2.54);

/**
 * A rounded box resized: its corners' radius as the file keeps it – a share of its shorter side –
 * so the server's answer does not change it again.
 */
function roundedAlong(
  element: EditableElement,
  box: { w: number; h: number },
  aspect: number,
): Partial<EditableElement> | undefined {
  const radius = element.cornerRadius;
  if (!radius) return undefined;
  const before = Math.min(element.bbox.w * aspect, element.bbox.h);
  const after = Math.min(box.w * aspect, box.h);
  if (before <= 0 || after === before) return undefined;
  const cornerRadius = (radius * after) / before;
  return {
    cornerRadius,
    ...(element.paint?.outline === 'rect' && {
      paint: { ...element.paint, radius: cornerRadius },
    }),
  };
}

/**
 * An element as it is right after the operation, before the server says how it is. A group also
 * takes one on an element in it (entered, Figma): that element changed in its `children`, its box
 * the one round them again – as LibreOffice's, which a group has no place of its own for.
 */
export function applyToElement(
  element: EditableElement,
  operation: SlideOperation,
  aspect = ASPECT,
): EditableElement | null {
  if (
    element.children &&
    'elementId' in operation &&
    operation.type !== 'copyElement' &&
    operation.elementId !== element.id
  )
    return applyInGroup(element, element.children, operation, aspect);
  switch (operation.type) {
    case 'deleteElement':
      return null;
    case 'setBox':
      // A group moves, its parts with it (it neither turns nor changes size).
      if (element.children) {
        const dx = operation.box.x - element.bbox.x;
        const dy = operation.box.y - element.bbox.y;
        return moved(element, dx, dy);
      }
      // A line: its ends the box's corners, as `flip` says; turned, they turn round its centre.
      if (element.line) {
        const laid = turnedLine(
          operation.box,
          operation.flip ?? element.flip,
          operation.rotation ?? 0,
          aspect,
        );
        return { ...element, bbox: laid.box, flip: laid.flip, rotation: 0 };
      }
      return {
        ...element,
        ...(element.resizable && roundedAlong(element, operation.box, aspect)),
        bbox: element.resizable
          ? operation.box
          : { ...operation.box, w: element.bbox.w, h: element.bbox.h },
        rotation:
          operation.rotation !== undefined && element.resizable
            ? ((operation.rotation % 360) + 360) % 360
            : element.rotation,
        flip: operation.flip && element.flip ? operation.flip : element.flip,
      };
    case 'setText':
      return {
        ...element,
        paragraphs: operation.paragraphs,
        live: element.live && {
          ...element.live,
          placeholder: false,
          paragraphs: liveFromRich(
            element.live.paragraphs,
            operation.paragraphs.map((text, i) => {
              const old =
                element.live!.paragraphs[Math.min(i, element.live!.paragraphs.length - 1)];
              const style = old ? styleOf(old.runs[0] ?? old.mark) : DEFAULT_STYLE;
              return { align: old?.align ?? 'left', runs: [{ ...style, text }] };
            }),
          ),
        },
      };
    case 'setRichText':
      return {
        ...element,
        paragraphs: operation.paragraphs.map(paragraphText),
        live: element.live && {
          ...element.live,
          placeholder:
            element.live.placeholder &&
            !operation.paragraphs.some((paragraph) => paragraphText(paragraph).trim()),
          paragraphs: liveFromRich(element.live.paragraphs, operation.paragraphs),
        },
      };
    case 'setShapeStyle': {
      // A line: its stroke and heads, nothing else.
      if (element.line) {
        return {
          ...element,
          ...(operation.heads && { line: { heads: operation.heads } }),
          look: element.look && {
            ...element.look,
            ...(operation.stroke !== undefined ? { stroke: operation.stroke } : {}),
          },
        };
      }
      // As the file reads it back: one colour shown is the fill's colour, anything else none.
      const fills =
        operation.fills ?? (operation.fill === undefined ? undefined : solidFills(operation.fill));
      const shown = fills && nativeFill(fills);
      const fill =
        fills === undefined
          ? {}
          : {
              fill:
                shown && shown !== 'composite' && shown.type === 'solid'
                  ? shown.color.toLowerCase()
                  : null,
            };
      return {
        ...element,
        look: element.look && {
          ...element.look,
          ...fill,
          ...(fills !== undefined
            ? {
                fills,
                fillAspect: shown === 'composite' ? (operation.composite?.aspect ?? null) : null,
              }
            : {}),
          ...(operation.stroke !== undefined ? { stroke: operation.stroke } : {}),
          ...(operation.effects ? { effects: operation.effects } : {}),
        },
        live: element.live && {
          ...element.live,
          ...fill,
          ...(operation.stroke !== undefined ? { stroke: operation.stroke } : {}),
          ...(operation.verticalAlign ? { verticalAlign: operation.verticalAlign } : {}),
        },
      };
    }
    case 'setTilt':
      return {
        ...element,
        tilt: operation.tilt,
        // Typed in on the slide tilted or flat alike.
      };
    case 'setLocked':
      return { ...element, locked: operation.locked || undefined };
    case 'setCornerRadius':
      return element.cornerRadius === undefined
        ? element
        : {
            ...element,
            cornerRadius: operation.radius,
            // Drawn by the browser: its corners round in the same frame (docs/do-not-break.md).
            ...(element.paint?.outline === 'rect' && {
              paint: { ...element.paint, radius: Math.max(0, operation.radius) },
            }),
          };
    case 'setImageFit':
      return element.picture
        ? {
            ...element,
            picture: {
              ...element.picture,
              fit: operation.fit,
              focus: operation.fit === 'fill' ? (operation.focus ?? element.picture.focus) : null,
            },
          }
        : element;
    default:
      return element;
  }
}

/** An operation on an element in a group, applied to it there; the group unchanged without it. */
function applyInGroup(
  group: EditableElement,
  children: readonly EditableElement[],
  operation: SlideOperation & { elementId: string },
  aspect: number,
): EditableElement | null {
  const id = operation.elementId;
  const at = children.findIndex((child) => child.id === id);
  if (operation.type === 'moveElement' && at >= 0) {
    const rest = children.filter((_, index) => index !== at);
    const to = Math.min(operation.to, rest.length);
    return regrouped(group, [...rest.slice(0, to), children[at]!, ...rest.slice(to)], aspect);
  }
  if (operation.type === 'ungroupElements' && at >= 0) {
    const inner = children[at]!.children;
    if (!inner) return group;
    return regrouped(group, children.toSpliced(at, 1, ...inner), aspect);
  }
  let changed = false;
  const next = children.flatMap((child) => {
    if (child.id !== id && !(child.children && findElement(child.children, id))) return [child];
    changed = true;
    const after = applyToElement(child, operation, aspect);
    return after ? [after] : [];
  });
  return changed ? regrouped(group, next, aspect) : group;
}

/**
 * A group with `children` as its parts: the box round them as they show (turned ones by their
 * corners); none left, no group (the file's goes too).
 */
export function regrouped(
  group: EditableElement,
  children: readonly EditableElement[],
  aspect = ASPECT,
): EditableElement | null {
  if (children.length === 0) return null;
  const corners = children.flatMap((child) => turnedCorners(child, aspect));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    ...group,
    bbox: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
    children: [...children],
    ...(group.members && { members: children.map((child) => child.id) }),
  };
}

/**
 * A slide's elements with group `groupId` entered (a double click, Figma): its elements each one
 * of the slide's in its place – a group it lies in taken apart as far as it.
 */
export function enteredIn(
  elements: readonly EditableElement[],
  groupId: string,
): readonly EditableElement[] {
  return elements.flatMap((element) =>
    element.id === groupId && element.children
      ? element.children
      : element.children && findElement(element.children, groupId)
        ? enteredIn(element.children, groupId)
        : [element],
  );
}

/** An element moved by `dx`/`dy` (page fractions) – a group with all its parts. */
export function moved(element: EditableElement, dx: number, dy: number): EditableElement {
  return {
    ...element,
    bbox: { ...element.bbox, x: element.bbox.x + dx, y: element.bbox.y + dy },
    ...(element.children && {
      children: element.children.map((child) => moved(child, dx, dy)),
    }),
  };
}

/**
 * A copy of an element put into group `groupId` (in `top`, at any depth), on top of its parts –
 * `copyElement` with a group; `top` unchanged when the group is not in it.
 */
export function withCopyIn(
  top: EditableElement,
  groupId: string,
  copy: EditableElement,
  aspect = ASPECT,
): EditableElement {
  if (!top.children) return top;
  if (top.id === groupId) return regrouped(top, [...top.children, copy], aspect) ?? top;
  if (!findElement(top.children, groupId)) return top;
  return (
    regrouped(
      top,
      top.children.map((child) => withCopyIn(child, groupId, copy, aspect)),
      aspect,
    ) ?? top
  );
}

/**
 * The copy of `source` an element copied shows as until the server says how it is (`copyElement`):
 * in the box given – a group's parts moved with it, under the ids `partIds` gives them (the
 * file's then too), else ids of their own until the server gives them theirs.
 */
export function copiedElement(
  source: EditableElement,
  newElementId: string,
  box: EditableElement['bbox'],
  partIds?: Readonly<Record<string, string>>,
): EditableElement {
  const copy = moved(source, box.x - source.bbox.x, box.y - source.bbox.y);
  const renamed = (element: EditableElement, prefix: string): EditableElement => {
    const ids = element.children?.map(
      (child, i) =>
        (Object.hasOwn(partIds ?? {}, child.id) && partIds![child.id]) || `${prefix}-${i}`,
    );
    return {
      ...element,
      ...(element.children && {
        children: element.children.map((child, i) => renamed({ ...child, id: ids![i]! }, ids![i]!)),
      }),
      ...(element.members && ids && { members: ids }),
    };
  };
  return renamed({ ...copy, id: newElementId, bbox: box }, newElementId);
}

/**
 * The ids a copy of `source` gives its parts (`copyElement`'s `partIds`): new ones, made here –
 * none for an element without parts (or parts without ids of their own).
 */
export function newPartIds(
  source: EditableElement | null | undefined,
  newId: () => string,
): Record<string, string> | undefined {
  const parts = source?.children ? withChildren(source.children) : [];
  const named = parts.filter((part) => part.id);
  return named.length > 0 ? Object.fromEntries(named.map((part) => [part.id, newId()])) : undefined;
}

const PT_PER_CM = 72 / 2.54;

/**
 * „Hinzufügen“: the elements as the editor works on them – those held still (`frozen`, there when
 * it began) locked, in the editor only; the others as they are.
 */
export function heldStill(
  elements: readonly EditableElement[],
  frozen: ReadonlySet<string> | null,
): readonly EditableElement[] {
  if (!frozen) return elements;
  return elements.map((element) =>
    frozen.has(element.id) && !element.locked ? { ...element, locked: true } : element,
  );
}

/**
 * The group `groupElements` makes of `members` (as shown, any order), before the server says how
 * it is: the box round them as they show, moved only – LibreOffice draws it (until its picture
 * comes, its elements stand in for it, `SlideCompositor`).
 */
export function groupedElement(
  operation: GroupElementsOperation,
  members: readonly EditableElement[],
  aspect: number,
): EditableElement {
  const corners = members.flatMap((member) => turnedCorners(member, aspect));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    id: operation.newElementId,
    kind: 'group',
    name: 'Gruppe',
    role: null,
    bbox: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
    rotation: 0,
    paragraphs: null,
    movable: true,
    resizable: false,
    live: null,
    credit: null,
    look: null,
    tilt: null,
    flip: null,
    members: members.map((member) => member.id),
    // Drawn from them, as the server's will be (`SlideCompositor`), entered as it.
    children: [...members],
  };
}

/**
 * `groupElements` of parts of a group (entered, ⌘G in it): the new group in their group (in `top`,
 * at any depth) where the topmost of them was, as the server makes it; `top` unchanged when they
 * are no parts of one group in it.
 */
export function withGroupIn(
  top: EditableElement,
  operation: GroupElementsOperation,
  aspect = ASPECT,
): EditableElement {
  const children = top.children;
  const first = operation.elementIds[0];
  if (!children || !first) return top;
  const ids = new Set(operation.elementIds);
  const members = children.filter((child) => ids.has(child.id));
  if (members.length >= 2) {
    const below = children.slice(0, children.indexOf(members.at(-1)!));
    const at = below.filter((child) => !ids.has(child.id)).length;
    const rest = children.filter((child) => !ids.has(child.id));
    const group = groupedElement(operation, members, aspect);
    return regrouped(top, rest.toSpliced(at, 0, group), aspect) ?? top;
  }
  if (!findElement(children, first)) return top;
  const next = children.map((child) =>
    child.children && findElement(child.children, first)
      ? withGroupIn(child, operation, aspect)
      : child,
  );
  return regrouped(top, next, aspect) ?? top;
}

/** A new line as the editor adds it (`addElement` kind `line`): drawn by the browser at once. */
function addedLine(operation: AddElementOperation): EditableElement {
  const heads = operation.heads ?? 'none';
  return {
    id: operation.elementId,
    kind: 'line',
    name: NEW_LINES[heads === 'none' ? 'line' : 'arrow'],
    role: null,
    bbox: operation.box,
    rotation: 0,
    paragraphs: null,
    movable: true,
    resizable: true,
    live: null,
    credit: null,
    look: {
      fill: null,
      fills: [],
      fillAspect: null,
      stroke: operation.stroke,
      effects: NO_EFFECTS,
    },
    tilt: null,
    flip: operation.flip ?? { x: false, y: false },
    line: { heads },
    paint: { outline: 'line', radius: 0 },
  };
}

/** A new text box, box or line as the editor adds it (`addElement`). */
export function addedElement(
  operation: AddElementOperation,
  pageSize: { width: number; height: number },
): EditableElement {
  if (operation.kind === 'line') return addedLine(operation);
  const text = operation.kind === 'text';
  const padding = { top: 0.125 * PT_PER_CM, bottom: 0.125 * PT_PER_CM };
  const textArea = text
    ? null
    : textAreaInset(
        { type: operation.shape ?? 'rectangle' },
        operation.box.w * pageSize.width,
        operation.box.h * pageSize.height,
      );
  const live: LiveElement = {
    fill: operation.fill,
    stroke: operation.stroke,
    padding: { ...padding, left: 0.25 * PT_PER_CM, right: 0.25 * PT_PER_CM },
    ...(textArea ? { textArea } : {}),
    verticalAlign: text ? 'top' : 'middle',
    autoGrow: text,
    placeholder: false,
    paragraphs: liveFromRich([], operation.paragraphs),
  };
  return {
    id: operation.elementId,
    kind: text ? 'text' : 'shape',
    name: text ? 'Textfeld' : NEW_SHAPES[operation.shape ?? 'rectangle'],
    role: null,
    bbox: operation.box,
    rotation: 0,
    paragraphs: operation.paragraphs.map(paragraphText),
    movable: true,
    resizable: true,
    live,
    credit: null,
    look: {
      fill: operation.fill,
      fills: solidFills(operation.fill),
      fillAspect: null,
      stroke: operation.stroke,
      effects: NO_EFFECTS,
    },
    tilt: null,
    // A box is a drawn shape, it mirrors; a text frame does not.
    flip: text ? null : { x: false, y: false },
    // A triangle's frame follows its outline at once, as the file's will (`outlineOf`).
    ...(!text && hasShapeOutline(operation.shape) && { outline: { type: operation.shape } }),
  };
}

/** A new picture frame as the editor adds it (`addImage`): shown once its slide is drawn anew. */
export const addedImage = (operation: AddImageOperation): EditableElement => ({
  id: operation.elementId,
  kind: 'image',
  name: 'Bild',
  role: null,
  bbox: operation.box,
  rotation: 0,
  paragraphs: null,
  movable: true,
  resizable: true,
  live: null,
  credit: null,
  look: null,
  tilt: null,
  flip: { x: false, y: false },
});

/**
 * The steps that add a new element (`addElement`, `addImage`) turned by `rotation` – it comes
 * unturned, so a turn follows in the same apply (one step, one undo).
 */
export function addedTurned(
  operation: AddElementOperation | AddImageOperation,
  rotation: number,
): SlideOperation[] {
  if (rotation % 360 === 0) return [operation];
  return [
    operation,
    { type: 'setBox', elementId: operation.elementId, box: operation.box, rotation },
  ];
}

// ── Formatting a stretch of text ─────────────────────────────────────────

export interface TextPoint {
  paragraph: number;
  offset: number;
}

export interface TextRange {
  start: TextPoint;
  end: TextPoint;
}

export const isCollapsed = (range: TextRange) =>
  range.start.paragraph === range.end.paragraph && range.start.offset === range.end.offset;

/** The runs of a paragraph with `patch` applied between two offsets. */
function patchBetween(runs: readonly LiveRun[], from: number, to: number, patch: TextStylePatch) {
  const out: LiveRun[] = [];
  let at = 0;
  for (const run of runs) {
    const start = at;
    const end = at + run.text.length;
    at = end;
    const a = Math.max(from, start) - start;
    const b = Math.min(to, end) - start;
    if (b <= a) {
      out.push(run);
      continue;
    }
    if (a > 0) out.push({ ...run, text: run.text.slice(0, a) });
    out.push({ ...run, ...patch, text: run.text.slice(a, b) });
    if (b < run.text.length) out.push({ ...run, text: run.text.slice(b) });
  }
  return normalizeRuns(out);
}

/** The word around an offset (for formatting at a caret, like PowerPoint). */
export function wordAt(text: string, offset: number): [number, number] {
  const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_-]/u.test(char);
  let start = offset;
  let end = offset;
  while (isWord(text[start - 1])) start -= 1;
  while (isWord(text[end])) end += 1;
  return [start, end];
}

/**
 * Applies a style to a stretch of the paragraphs. A caret formats the word it is in; in no word
 * (an empty line, between spaces) it sets what is typed there next (the paragraph's mark).
 */
export function formatRange(
  paragraphs: readonly LiveParagraph[],
  range: TextRange | null,
  patch: TextStylePatch,
): LiveParagraph[] {
  if (!range) {
    return paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: normalizeRuns(paragraph.runs.map((run) => ({ ...run, ...patch }))),
      mark: { ...paragraph.mark, ...patch },
    }));
  }
  if (isCollapsed(range)) {
    const index = range.start.paragraph;
    const paragraph = paragraphs[index];
    if (!paragraph) return [...paragraphs];
    const [from, to] = wordAt(paragraphText(paragraph), range.start.offset);
    return paragraphs.map((item, i) =>
      i !== index
        ? item
        : from === to
          ? { ...item, mark: { ...item.mark, ...patch } }
          : { ...item, runs: patchBetween(item.runs, from, to, patch) },
    );
  }
  return paragraphs.map((paragraph, i) => {
    if (i < range.start.paragraph || i > range.end.paragraph) return paragraph;
    const from = i === range.start.paragraph ? range.start.offset : 0;
    const to = i === range.end.paragraph ? range.end.offset : Infinity;
    const runs = patchBetween(paragraph.runs, from, to, patch);
    // A paragraph formatted to its end types on in the new style.
    const mark =
      to >= paragraphText(paragraph).length ? { ...paragraph.mark, ...patch } : paragraph.mark;
    return { ...paragraph, runs, mark };
  });
}

/** What the format panel sets on whole paragraphs. */
export interface ParagraphPatch {
  align?: TextAlign;
  /** Of single. */
  lineSpacing?: number;
  /** Into a list of bullets or numbers (at its level, the first), `null`: out of it. */
  list?: TextList['kind'] | null;
  /** A level deeper (1) or less deep (-1) – paragraphs in a list only. */
  levelBy?: 1 | -1;
}

/** Whether a paragraph is one a range touches (all without a range). */
const touched = (range: TextRange | null, i: number) =>
  !range || (i >= range.start.paragraph && i <= range.end.paragraph);

/** The paragraphs a range touches (all without a range). */
export const paragraphsIn = (paragraphs: readonly LiveParagraph[], range: TextRange | null) =>
  paragraphs.filter((_, i) => touched(range, i));

/** Changes the paragraphs a range touches (all without a range). */
export function paragraphRange(
  paragraphs: readonly LiveParagraph[],
  range: TextRange | null,
  patch: ParagraphPatch,
): LiveParagraph[] {
  return paragraphs.map((paragraph, i) => {
    if (!touched(range, i)) return paragraph;
    let next = paragraph;
    if (patch.align) next = { ...next, align: patch.align };
    if (patch.lineSpacing !== undefined) {
      next = { ...next, lineSpacing: { type: 'proportional', value: patch.lineSpacing } };
    }
    const others = paragraphs.filter((_, j) => j !== i);
    if (patch.list !== undefined) {
      const level = Math.max(1, next.level);
      next = withList(next, patch.list && { kind: patch.list, level }, others);
    }
    const list = listOf(next);
    if (patch.levelBy && list) {
      const level = Math.min(9, Math.max(1, list.level + patch.levelBy));
      if (level !== list.level) next = withList(next, { ...list, level }, others);
    }
    return next;
  });
}

/** One value when every paragraph has it, else `null`. */
export function commonOf<T>(paragraphs: readonly LiveParagraph[], read: (p: LiveParagraph) => T) {
  const values = paragraphs.map(read);
  const first = values[0];
  return first !== undefined && values.every((value) => value === first) ? first : null;
}

/** The list kind every paragraph is in (`none`: in none), else `null`. */
export const commonList = (paragraphs: readonly LiveParagraph[]) =>
  commonOf(paragraphs, (paragraph) => listOf(paragraph)?.kind ?? 'none');

/** The proportional line spacing every paragraph has, else `null`. */
export const commonLineSpacing = (paragraphs: readonly LiveParagraph[]) =>
  commonOf(paragraphs, (paragraph) =>
    paragraph.lineSpacing.type === 'proportional'
      ? Math.round(paragraph.lineSpacing.value * 100) / 100
      : null,
  );

/** The style at a point: of the character before it, at a paragraph's start of the first one. */
export function styleAt(paragraphs: readonly LiveParagraph[], point: TextPoint): LiveTextStyle {
  const paragraph = paragraphs[point.paragraph] ?? paragraphs[0];
  if (!paragraph) return DEFAULT_STYLE;
  let at = 0;
  for (const run of paragraph.runs) {
    const end = at + run.text.length;
    if (point.offset <= end && (point.offset > at || at === 0)) return styleOf(run);
    at = end;
  }
  return styleOf(paragraph.mark);
}

/** One value when every run (and empty line) in the paragraphs has it, else `null`. */
export function commonValue<K extends keyof LiveTextStyle>(
  paragraphs: readonly LiveParagraph[],
  key: K,
): LiveTextStyle[K] | null {
  const values = paragraphs.flatMap((paragraph) =>
    paragraph.runs.some((run) => run.text)
      ? paragraph.runs.map((run) => run[key])
      : [paragraph.mark[key]],
  );
  const first = values[0];
  return first !== undefined && values.every((value) => value === first) ? first : null;
}
