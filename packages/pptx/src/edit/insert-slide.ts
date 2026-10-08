import JSZip from 'jszip';
import { Archive, REL, relsPathOf } from '../archive';
import { PptxError } from '../types';
import { attr, child, children, path, type XmlElement } from '../xml';

/**
 * Inserts an empty slide into a PPTX – the only write Slider does to a PowerPoint (BER-128).
 *
 * The edit is a minimal patch so the file stays PowerPoint's own: the new slide and its
 * relationships are added, `presentation.xml`, its relationships, `[Content_Types].xml`, the
 * sections and the slide count in `docProps/app.xml` get one entry each by string insertion.
 * Every other part keeps its exact content.
 */

const PRESENTATION_PATH = 'ppt/presentation.xml';
const CONTENT_TYPES_PATH = '[Content_Types].xml';
const APP_PROPERTIES_PATH = 'docProps/app.xml';
const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const PML_NAMESPACES =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** `p:sldId/@id` must lie in [256, 2^31). */
const MIN_SLIDE_ID = 256;
const MAX_SLIDE_ID = 2_147_483_647;

/** Layout placeholders that stay on the layout (PowerPoint does not copy them to new slides). */
const LAYOUT_ONLY_PLACEHOLDERS = new Set(['dt', 'ftr', 'sldNum', 'hdr']);
/** Placeholders for objects rather than text get no `p:txBody`. */
const OBJECT_PLACEHOLDERS = new Set(['pic', 'tbl', 'chart', 'dgm', 'media', 'clipArt']);

export class SlideInsertError extends Error {
  constructor(
    readonly code: 'slide_not_found',
    message: string,
  ) {
    super(message);
    this.name = 'SlideInsertError';
  }
}

export interface InsertSlideOptions {
  /** `p:sldId/@id` of the slide the new one follows; `null` inserts it as the first slide. */
  afterSldId: number | null;
}

export interface InsertSlideResult {
  bytes: Uint8Array;
  /** `p:sldId/@id` of the new slide. */
  sldId: number;
  /** Zip path of the new slide part, e.g. `ppt/slides/slide7.xml`. */
  path: string;
}

/**
 * Adds an empty slide after `afterSldId`. It uses the layout of its neighbour (the slide before
 * it, or the first slide when inserted at the start) and carries that layout's content
 * placeholders empty, as PowerPoint's "New Slide" does.
 *
 * @throws {SlideInsertError} `slide_not_found` when `afterSldId` is not in the deck.
 * @throws {PptxError} for files that cannot be read.
 */
export async function insertSlide(
  data: Uint8Array,
  { afterSldId }: InsertSlideOptions,
): Promise<InsertSlideResult> {
  const archive = await Archive.open(data);
  const zip = await JSZip.loadAsync(data);
  const presentationXml = await readText(zip, PRESENTATION_PATH);
  const presentation = await archive.readXml(PRESENTATION_PATH);
  if (!presentationXml || !presentation) {
    throw new PptxError('not_pptx', 'The file is not a PowerPoint (.pptx) package.');
  }

  const slideIds = children(child(presentation, 'p:sldIdLst'), 'p:sldId').map((element) => ({
    id: Number(attr(element, 'id')),
    relId: attr(element, 'r:id') ?? '',
  }));
  const neighbour =
    afterSldId === null ? slideIds[0] : slideIds.find((slide) => slide.id === afterSldId);
  if (afterSldId !== null && !neighbour) {
    throw new SlideInsertError('slide_not_found', `Slide ${afterSldId} is not in the deck.`);
  }

  const sldId = nextSlideId(slideIds.map((slide) => slide.id));
  const slidePath = `ppt/slides/slide${nextPartNumber(zip, /^ppt\/slides\/slide(\d+)\.xml$/)}.xml`;
  const presentationRels = await readText(zip, relsPathOf(PRESENTATION_PATH));
  const contentTypes = await readText(zip, CONTENT_TYPES_PATH);
  if (!presentationRels || !contentTypes) {
    throw new PptxError('corrupt', 'The package has no relationships or content types.');
  }
  const relId = nextRelationshipId(presentationRels);

  // The neighbour decides the layout; an empty deck falls back to the master's first layout.
  const layoutPath = await layoutFor(archive, neighbour?.relId);

  zip.file(slidePath, slideXml(await archive.readXml(layoutPath)));
  zip.file(
    relsPathOf(slidePath),
    `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NS}">` +
      `<Relationship Id="rId1" Type="${REL.slideLayout}" Target="${relativeTarget(slidePath, layoutPath)}"/>` +
      '</Relationships>',
  );
  zip.file(
    relsPathOf(PRESENTATION_PATH),
    insertBefore(
      presentationRels,
      '</Relationships>',
      `<Relationship Id="${relId}" Type="${REL.slide}" Target="${relativeTarget(PRESENTATION_PATH, slidePath)}"/>`,
    ),
  );
  zip.file(
    PRESENTATION_PATH,
    patchPresentation(presentationXml, { afterSldId, firstSldId: slideIds[0]?.id, sldId, relId }),
  );
  zip.file(
    CONTENT_TYPES_PATH,
    insertBefore(
      contentTypes,
      '</Types>',
      `<Override PartName="/${slidePath}" ContentType="${SLIDE_CONTENT_TYPE}"/>`,
    ),
  );

  const appProperties = await readText(zip, APP_PROPERTIES_PATH);
  if (appProperties) {
    zip.file(
      APP_PROPERTIES_PATH,
      appProperties.replace(
        /<Slides>(\d+)<\/Slides>/,
        (_, count: string) => `<Slides>${Number(count) + 1}</Slides>`,
      ),
    );
  }

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes, sldId, path: slidePath };
}

async function readText(zip: JSZip, partPath: string): Promise<string | null> {
  const entry = zip.file(partPath);
  return entry ? entry.async('string') : null;
}

function nextSlideId(existing: number[]): number {
  const id = Math.max(MIN_SLIDE_ID - 1, ...existing) + 1;
  if (id <= MAX_SLIDE_ID) return id;
  // The range is used up at the top; take the lowest free id instead.
  const used = new Set(existing);
  for (let candidate = MIN_SLIDE_ID; candidate <= MAX_SLIDE_ID; candidate++) {
    if (!used.has(candidate)) return candidate;
  }
  throw new PptxError('corrupt', 'The presentation has no free slide id.');
}

function nextPartNumber(zip: JSZip, pattern: RegExp): number {
  let max = 0;
  zip.forEach((relativePath) => {
    const match = pattern.exec(relativePath);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return max + 1;
}

function nextRelationshipId(relsXml: string): string {
  const used = new Set([...relsXml.matchAll(/\sId="([^"]+)"/g)].map((match) => match[1]));
  let number = used.size + 1;
  while (used.has(`rId${number}`)) number++;
  return `rId${number}`;
}

async function layoutFor(archive: Archive, slideRelId: string | undefined): Promise<string> {
  if (slideRelId) {
    const slide = await archive.relationshipById(PRESENTATION_PATH, slideRelId);
    const [layout] = slide ? await archive.relationshipsOfType(slide.target, REL.slideLayout) : [];
    if (layout) return layout.target;
  }
  const [master] = await archive.relationshipsOfType(PRESENTATION_PATH, REL.slideMaster);
  const [layout] = master ? await archive.relationshipsOfType(master.target, REL.slideLayout) : [];
  if (!layout) throw new PptxError('corrupt', 'The presentation has no slide layout.');
  return layout.target;
}

/** The layout's content placeholders, empty – what PowerPoint puts on a new slide. */
function slideXml(layout: XmlElement | null): string {
  const placeholders = children(path(layout, 'p:cSld', 'p:spTree'), 'p:sp').flatMap((shape) => {
    const ph = path(shape, 'p:nvSpPr', 'p:nvPr', 'p:ph');
    return ph && !LAYOUT_ONLY_PLACEHOLDERS.has(attr(ph, 'type') ?? '') ? [{ shape, ph }] : [];
  });

  const shapes = placeholders.map(({ shape, ph }, index) => {
    const type = attr(ph, 'type');
    const name = attr(path(shape, 'p:nvSpPr', 'p:cNvPr'), 'name') ?? `Placeholder ${index + 1}`;
    const phAttributes = ['type', 'orient', 'sz', 'idx']
      .flatMap((key) => {
        const value = attr(ph, key);
        return value === undefined ? [] : [` ${key}="${escapeXml(value)}"`];
      })
      .join('');
    const text =
      type && OBJECT_PLACEHOLDERS.has(type)
        ? ''
        : '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="de-DE"/></a:p></p:txBody>';
    return (
      `<p:sp><p:nvSpPr><p:cNvPr id="${index + 2}" name="${escapeXml(name)}"/>` +
      '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
      `<p:nvPr><p:ph${phAttributes}/></p:nvPr></p:nvSpPr><p:spPr/>${text}</p:sp>`
    );
  });

  return (
    `${XML_DECLARATION}<p:sld ${PML_NAMESPACES}><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    `${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

/** Adds the slide to `p:sldIdLst` and to the section of its neighbour. */
function patchPresentation(
  xml: string,
  {
    afterSldId,
    firstSldId,
    sldId,
    relId,
  }: { afterSldId: number | null; firstSldId: number | undefined; sldId: number; relId: string },
): string {
  const entry = `<p:sldId id="${sldId}" r:id="${relId}"/>`;
  let patched: string;
  if (afterSldId === null) {
    patched = /<p:sldIdLst\s*\/>/.test(xml)
      ? xml.replace(/<p:sldIdLst\s*\/>/, `<p:sldIdLst>${entry}</p:sldIdLst>`)
      : insertAfterMatch(xml, /<p:sldIdLst(\s[^>]*)?>/, entry);
  } else {
    // Entries of the main list carry `r:id`, so this never hits a section's `p14:sldId`.
    patched = insertAfterMatch(
      xml,
      new RegExp(`<p:sldId\\s(?=[^>]*\\sr:id=)(?=[^>]*(?<![:\\w])id="${afterSldId}")[^>]*/>`),
      entry,
    );
  }

  // Sections list slides by id only (`<p14:sldId id="…"/>`); the new slide joins its neighbour's.
  const neighbour = afterSldId ?? firstSldId;
  if (neighbour === undefined) return patched;
  const match = new RegExp(`<(\\w+):sldId\\s+id="${neighbour}"\\s*/>`).exec(patched);
  if (!match) return patched;
  const at = afterSldId === null ? match.index : match.index + match[0].length;
  return `${patched.slice(0, at)}<${match[1]}:sldId id="${sldId}"/>${patched.slice(at)}`;
}

function insertAfterMatch(source: string, pattern: RegExp, insertion: string): string {
  const match = pattern.exec(source);
  if (!match) throw new PptxError('corrupt', 'The presentation has no slide list.');
  const at = match.index + match[0].length;
  return source.slice(0, at) + insertion + source.slice(at);
}

function insertBefore(source: string, closingTag: string, insertion: string): string {
  const at = source.lastIndexOf(closingTag);
  if (at < 0) throw new PptxError('corrupt', `Missing ${closingTag}.`);
  return source.slice(0, at) + insertion + source.slice(at);
}

/** Relationship target of `to`, relative to the folder of `from` (both zip paths). */
function relativeTarget(from: string, to: string): string {
  const fromDir = from.split('/').slice(0, -1);
  const toParts = to.split('/');
  let common = 0;
  while (common < fromDir.length && fromDir[common] === toParts[common]) common++;
  return [...fromDir.slice(common).map(() => '..'), ...toParts.slice(common)].join('/');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
