import { coverCrop, type ElementPicture, type PictureFit, type PictureFocus } from '@slider/shared';
import type { CmBox } from './geometry';
import { imageSize } from './image-size';
import { graphicPropsOf, shapeStyleRef } from './live';
import type { StyleSink } from './live-write';
import type { StyleIndex } from './styles';
import {
  attr,
  childrenOf,
  element,
  firstChild,
  removeAttr,
  setAttr,
  tagOf,
  type XmlNode,
} from './xml';

/*
 * How a picture fills its frame (`setImageFit`): cropped to it („Füllen“) or stretched
 * („Strecken“). The file says it as LibreOffice and PowerPoint read it – the frame's `fo:clip`,
 * `rect(top, right, bottom, left)` cut off the picture in its own size – and the frame notes the
 * choice for Slider (`slider:picture`): the fit, the part shown and the picture's size.
 *
 * A picture's own size is LibreOffice's: its pixels at its resolution – a PNG's `pHYs`, else
 * 96 dpi (LibreOffice 26.8 reads no JPEG's density for it; tried with 72 and 300 dpi).
 */

const MARK = 'slider:picture';

interface PictureMark {
  fit: PictureFit;
  focus?: PictureFocus;
  /** The picture's own size, cm. */
  w: number;
  h: number;
}

const DEFAULT_DPI = 96;

/** A picture's own size (cm) as LibreOffice takes it, `null` for one it cannot tell. */
export function pictureCmSize(bytes: Uint8Array): { w: number; h: number } | null {
  const size = imageSize(bytes);
  if (!size || size.width <= 0 || size.height <= 0) return null;
  const { x, y } = (size.mediaType === 'image/png' && pngDpi(bytes)) || {
    x: DEFAULT_DPI,
    y: DEFAULT_DPI,
  };
  return { w: (size.width / x) * 2.54, h: (size.height / y) * 2.54 };
}

/** A PNG's resolution from its `pHYs` chunk (dots per inch), `null` without one in metres. */
function pngDpi(bytes: Uint8Array): { x: number; y: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === 'IDAT' || type === 'IEND') return null;
    if (type === 'pHYs' && length >= 9) {
      const x = view.getUint32(at + 8);
      const y = view.getUint32(at + 12);
      // Unit 1: per metre; 0 says only the proportion.
      if (bytes[at + 16] !== 1 || x <= 0 || y <= 0) return null;
      return { x: x * 0.0254, y: y * 0.0254 };
    }
    at += 12 + length;
  }
  return null;
}

function readMark(node: XmlNode): PictureMark | null {
  const raw = attr(node, MARK);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<PictureMark>;
    if ((data.fit !== 'fill' && data.fit !== 'stretch') || !(data.w! > 0) || !(data.h! > 0))
      return null;
    const focus = data.focus;
    const valid =
      focus &&
      [focus.x, focus.y, focus.zoom].every((n) => typeof n === 'number' && Number.isFinite(n));
    return { fit: data.fit, w: data.w!, h: data.h!, ...(valid && { focus }) };
  } catch {
    return null;
  }
}

/** The picture a frame shows (`Pictures/…`), `null` for none of the file's own. */
export function framePicture(node: XmlNode): string | null {
  const image = childrenOf(node).find((child) => tagOf(child) === 'draw:image');
  const href = image && attr(image, 'xlink:href');
  return href && href.startsWith('Pictures/') ? href : null;
}

/** What has no own size noted yet (`slider:picture`): asked for before a fit is set. */
export const needsPictureSize = (node: XmlNode): boolean => readMark(node) === null;

/** Fitted in Slider (its fit and size noted): its `fo:clip` is the part `shownCrop` names. */
export const fittedInSlider = (node: XmlNode): boolean => readMark(node) !== null;

/** A picture frame's picture and fit (`EditableElement.picture`). */
export function readPicture(index: StyleIndex, node: XmlNode): ElementPicture {
  const mark = readMark(node);
  const src = framePicture(node);
  if (mark) {
    return { src, aspect: mark.w / mark.h, fit: mark.fit, focus: mark.focus ?? null };
  }
  // Not fitted in Slider: cropped when the file cuts something off.
  return { src, aspect: null, fit: clipOf(index, node) ? 'fill' : 'stretch', focus: null };
}

const CLIP = /^rect\(\s*([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s)]+)\s*\)$/;

/** Whether the frame cuts anything off its picture. */
export function clipOf(index: StyleIndex, node: XmlNode): boolean {
  const clip = graphicPropsOf(index, node)['fo:clip'];
  const parts = clip?.trim().match(CLIP);
  return !!parts && parts.slice(1).some((part) => part !== 'auto' && parseFloat(part) > 0);
}

const cm = (value: number) => `${Math.max(0, Math.round(value * 10000) / 10000)}cm`;

/**
 * Sets how the picture fills its frame (`box`, cm): `fill` cropped to it around `focus` (else the
 * part noted before, else the middle), `stretch` all of it. `size`: the picture's own size, when
 * the frame notes none yet.
 */
export function writePictureFit(
  sink: StyleSink,
  node: XmlNode,
  box: CmBox,
  fit: PictureFit,
  focus: PictureFocus | undefined,
  size: { w: number; h: number } | null,
): boolean {
  const mark = readMark(node);
  const own = mark ?? (size && { fit, w: size.w, h: size.h });
  if (!own) return false;
  const next: PictureMark = { fit, w: own.w, h: own.h };
  const kept = focus ?? mark?.focus;
  if (fit === 'fill' && kept) next.focus = kept;
  setAttr(node, MARK, JSON.stringify(next));
  writeClip(sink, node, box, next);
  return true;
}

/** A frame resized (`setBox`): a filled picture is cropped to its new proportions. */
export function refitPicture(sink: StyleSink, node: XmlNode, box: CmBox): void {
  const mark = readMark(node);
  if (mark?.fit === 'fill') writeClip(sink, node, box, mark);
}

/** A new picture in the frame (fitted to it): all of it, filled, its size noted. */
export function resetPicture(
  sink: StyleSink,
  node: XmlNode,
  size: { w: number; h: number } | null,
): void {
  if (size) setAttr(node, MARK, JSON.stringify({ fit: 'fill', w: size.w, h: size.h }));
  else removeAttr(node, MARK);
  setClip(sink, node, null);
}

function writeClip(sink: StyleSink, node: XmlNode, box: CmBox, mark: PictureMark): void {
  if (mark.fit === 'stretch' || box.w <= 0 || box.h <= 0) {
    setClip(sink, node, null);
    return;
  }
  const crop = coverCrop(mark.w / mark.h, box.w / box.h, mark.focus ?? null);
  setClip(
    sink,
    node,
    `rect(${cm(crop.y * mark.h)}, ${cm((1 - crop.x - crop.w) * mark.w)}, ` +
      `${cm((1 - crop.y - crop.h) * mark.h)}, ${cm(crop.x * mark.w)})`,
  );
}

/** The frame's `fo:clip` set (`null`: none – also over one its styles name). */
function setClip(sink: StyleSink, node: XmlNode, clip: string | null): void {
  const ref = shapeStyleRef(node);
  const automatic = ref.name ? sink.automatic(ref.family, ref.name) : undefined;
  const style = automatic
    ? structuredClone(automatic)
    : element('style:style', {
        'style:family': ref.family,
        ...(ref.name && sink.index.has(ref.family, ref.name)
          ? { 'style:parent-style-name': ref.name }
          : {}),
      });
  removeAttr(style, 'style:name');
  let properties = firstChild(style, 'style:graphic-properties');
  if (!properties) {
    properties = element('style:graphic-properties');
    childrenOf(style).unshift(properties);
  }
  removeAttr(properties, 'fo:clip');
  // Cut before (here or by a style it derives from): nothing cut off, said outright.
  const cutBefore = !clip && clipOf(sink.index, node);
  if (clip || cutBefore) setAttr(properties, 'fo:clip', clip ?? 'rect(0cm, 0cm, 0cm, 0cm)');
  setAttr(node, ref.attribute, sink.add(style));
}
