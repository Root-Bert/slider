import JSZip from 'jszip';
import {
  CONTENT_TYPES,
  contentTypesXml,
  corePropertiesXml,
  escapeXml,
  extendedPropertiesXml,
  NS,
  PML_NAMESPACES,
  PRES_PROPS_XML,
  REL_TYPES,
  relationshipsXml,
  SP_TREE_HEADER,
  slideLayoutXml,
  slideMasterXml,
  TABLE_STYLES_XML,
  THEME_XML,
  VIEW_PROPS_XML,
  XML_DECLARATION,
  xfrmXml,
  type EmuBox,
  type LayoutKind,
  type Relationship,
} from './ooxml';
import { TINY_PNG } from './png';

/**
 * Builds small but valid PPTX packages for tests and demos (BER-106). Every option maps to one
 * PresentationML feature the parser supports, so tests can state their input declaratively.
 * All coordinates are EMU (914 400 per inch; a 16:9 slide is 12 192 000 × 6 858 000).
 */

export interface DeckSpec {
  title?: string;
  /** Slide size in EMU; defaults to 16:9. */
  size?: { cx: number; cy: number };
  slides: SlideSpec[];
  /** Presentation sections; `slides` are 0-based indexes into {@link DeckSpec.slides}. */
  sections?: { name: string; slides: number[] }[];
}

export interface SlideSpec {
  /** `p:sldId/@id`; defaults to 256 + index. */
  sldId?: number;
  /** `title` → "Title Slide" (ctrTitle + subTitle), `content` (default) → "Title and Content". */
  layout?: LayoutKind;
  title?: string;
  /** Paragraphs of the body (or subtitle) placeholder. */
  body?: string | string[];
  hidden?: boolean;
  /** Solid background as `RRGGBB`. */
  background?: string;
  shapes?: ShapeSpec[];
  comments?: ModernCommentSpec[];
  legacyComments?: LegacyCommentSpec[];
}

export type ShapeSpec = RectSpec | PictureSpec | GroupSpec | TableSpec;

interface ShapeBase {
  /** `p:cNvPr/@id`; assigned sequentially when omitted (title = 2, body = 3, then 4, 5, …). */
  id?: number;
  name?: string;
  box: EmuBox;
}

export interface RectSpec extends ShapeBase {
  type: 'rect';
  /** Fill as `RRGGBB`. */
  fill?: string;
  text?: string;
  font?: { sizePt?: number; bold?: boolean; italic?: boolean; color?: string };
  align?: 'l' | 'ctr' | 'r' | 'just';
}

export interface PictureSpec extends ShapeBase {
  type: 'picture';
  /** PNG bytes; defaults to a tiny checkerboard. */
  png?: Uint8Array;
}

export interface GroupSpec extends ShapeBase {
  type: 'group';
  /** The children's coordinate space (`a:chOff`/`a:chExt`), mapped onto `box`. */
  childBox: EmuBox;
  shapes: ShapeSpec[];
}

export interface TableSpec extends ShapeBase {
  type: 'table';
  rows: string[][];
}

export interface ModernCommentSpec {
  author: string;
  text: string;
  created?: string;
  status?: 'active' | 'resolved' | 'closed';
  /** Anchors the comment to a shape (`ac:spMk/@id`). */
  shapeId?: number;
  /** Comment pin position in EMU (`p188:pos`). */
  position?: { x: number; y: number };
  replies?: { author: string; text: string; created?: string }[];
}

export interface LegacyCommentSpec {
  author: string;
  text: string;
  created?: string;
  /** Raw `p:pos` value in PowerPoint's legacy units (1/576 inch). */
  position: { x: number; y: number };
}

export const SLIDE_SIZE_16_9 = { cx: 12_192_000, cy: 6_858_000 };

const DEFAULT_DATE = '2026-01-15T09:30:00.000Z';
const PRESENTATION_PATH = 'ppt/presentation.xml';

export async function buildPptx(deck: DeckSpec): Promise<Uint8Array> {
  return new PptxWriter(deck).write();
}

/** Deterministic GUID-shaped ids, so fixtures are byte-stable across runs. */
const guid = (kind: number, counter: number): string =>
  `{${kind.toString(16).padStart(8, '0')}-0000-4000-8000-${counter.toString(16).padStart(12, '0')}}`;

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();

class PptxWriter {
  private readonly zip = new JSZip();
  private readonly overrides: { partName: string; contentType: string }[] = [];
  private readonly size: { cx: number; cy: number };
  private readonly modernAuthors = new Map<string, string>();
  private readonly legacyAuthors = new Map<string, { id: number; lastIdx: number }>();
  private mediaCount = 0;
  private guidCount = 0;

  constructor(private readonly deck: DeckSpec) {
    this.size = deck.size ?? SLIDE_SIZE_16_9;
  }

  async write(): Promise<Uint8Array> {
    const layoutPaths = this.writeMasterAndLayouts();
    const slideRels = this.deck.slides.map((slide, index) =>
      this.writeSlide(slide, index, layoutPaths[slide.layout ?? 'content']),
    );
    this.writePresentation(slideRels);
    this.writePackageParts();
    return this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  private addPart(partName: string, content: string | Uint8Array, contentType?: string): void {
    // A fixed entry date keeps generated packages byte-identical between runs.
    this.zip.file(partName, content, { date: new Date(DEFAULT_DATE) });
    if (contentType) this.overrides.push({ partName, contentType });
  }

  private writeMasterAndLayouts(): Record<LayoutKind, string> {
    const kinds: LayoutKind[] = ['title', 'content'];
    const masterPath = 'ppt/slideMasters/slideMaster1.xml';
    this.addPart(
      masterPath,
      slideMasterXml(kinds.map((_, index) => `rId${index + 1}`)),
      CONTENT_TYPES.slideMaster,
    );
    this.addPart(
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      relationshipsXml([
        ...kinds.map((_, index) => ({
          id: `rId${index + 1}`,
          type: REL_TYPES.slideLayout,
          target: `../slideLayouts/slideLayout${index + 1}.xml`,
        })),
        { id: `rId${kinds.length + 1}`, type: REL_TYPES.theme, target: '../theme/theme1.xml' },
      ]),
    );
    this.addPart('ppt/theme/theme1.xml', THEME_XML, CONTENT_TYPES.theme);

    const paths = {} as Record<LayoutKind, string>;
    kinds.forEach((kind, index) => {
      const path = `ppt/slideLayouts/slideLayout${index + 1}.xml`;
      this.addPart(path, slideLayoutXml(kind), CONTENT_TYPES.slideLayout);
      this.addPart(
        `ppt/slideLayouts/_rels/slideLayout${index + 1}.xml.rels`,
        relationshipsXml([
          { id: 'rId1', type: REL_TYPES.slideMaster, target: '../slideMasters/slideMaster1.xml' },
        ]),
      );
      paths[kind] = path;
    });
    return paths;
  }

  // --- Slides ------------------------------------------------------------------------------------

  private writeSlide(
    slide: SlideSpec,
    index: number,
    layoutPath: string,
  ): { sldId: number; target: string } {
    const number = index + 1;
    const sldId = slide.sldId ?? 256 + index;
    const rels: Relationship[] = [
      { id: 'rId1', type: REL_TYPES.slideLayout, target: `../${layoutPath.slice('ppt/'.length)}` },
    ];
    const context: SlideContext = { rels, nextId: 2 };

    const placeholders = this.placeholderShapes(slide, context);
    const extraShapes = (slide.shapes ?? []).map((shape) => this.shapeXml(shape, context)).join('');

    if (slide.comments?.length) {
      const fileName = `modernComment_${sldId}_${sldId.toString(16).toUpperCase().padStart(8, '0')}.xml`;
      this.addPart(
        `ppt/comments/${fileName}`,
        this.modernCommentsXml(slide.comments, sldId),
        CONTENT_TYPES.modernComments,
      );
      rels.push({
        id: `rId${rels.length + 1}`,
        type: REL_TYPES.modernComments,
        target: `../comments/${fileName}`,
      });
    }
    if (slide.legacyComments?.length) {
      const fileName = `comment${number}.xml`;
      this.addPart(
        `ppt/comments/${fileName}`,
        this.legacyCommentsXml(slide.legacyComments),
        CONTENT_TYPES.legacyComments,
      );
      rels.push({
        id: `rId${rels.length + 1}`,
        type: REL_TYPES.legacyComments,
        target: `../comments/${fileName}`,
      });
    }

    const background = slide.background
      ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${slide.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
      : '';
    this.addPart(
      `ppt/slides/slide${number}.xml`,
      `${XML_DECLARATION}<p:sld ${PML_NAMESPACES}${slide.hidden ? ' show="0"' : ''}>` +
        `<p:cSld>${background}<p:spTree>${SP_TREE_HEADER}${placeholders}${extraShapes}</p:spTree></p:cSld>` +
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
      CONTENT_TYPES.slide,
    );
    this.addPart(`ppt/slides/_rels/slide${number}.xml.rels`, relationshipsXml(rels));
    return { sldId, target: `slides/slide${number}.xml` };
  }

  private placeholderShapes(slide: SlideSpec, context: SlideContext): string {
    const isTitleLayout = (slide.layout ?? 'content') === 'title';
    let xml = '';
    if (slide.title !== undefined) {
      xml += placeholderXml(
        context,
        'Title',
        `<p:ph type="${isTitleLayout ? 'ctrTitle' : 'title'}"/>`,
        [slide.title],
      );
    }
    if (slide.body !== undefined) {
      const paragraphs = Array.isArray(slide.body) ? slide.body : [slide.body];
      const ph = isTitleLayout ? '<p:ph type="subTitle" idx="1"/>' : '<p:ph idx="1"/>';
      xml += placeholderXml(context, isTitleLayout ? 'Subtitle' : 'Content', ph, paragraphs);
    }
    return xml;
  }

  private shapeXml(shape: ShapeSpec, context: SlideContext): string {
    const id = takeId(context, shape.id);
    const name = escapeXml(shape.name ?? `${shape.type} ${id}`);
    switch (shape.type) {
      case 'rect':
        return rectXml(id, name, shape);
      case 'picture': {
        const relId = `rId${context.rels.length + 1}`;
        const mediaName = `image${++this.mediaCount}.png`;
        this.addPart(`ppt/media/${mediaName}`, shape.png ?? TINY_PNG);
        context.rels.push({ id: relId, type: REL_TYPES.image, target: `../media/${mediaName}` });
        return (
          `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
          `<p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
          `<p:spPr>${xfrmXml(shape.box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
        );
      }
      case 'group': {
        const { box, childBox } = shape;
        const children = shape.shapes.map((child) => this.shapeXml(child, context)).join('');
        return (
          `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
          `<p:grpSpPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.w}" cy="${box.h}"/>` +
          `<a:chOff x="${childBox.x}" y="${childBox.y}"/><a:chExt cx="${childBox.w}" cy="${childBox.h}"/></a:xfrm></p:grpSpPr>` +
          `${children}</p:grpSp>`
        );
      }
      case 'table':
        return tableXml(id, name, shape);
    }
  }

  // --- Comments ----------------------------------------------------------------------------------

  private modernAuthorId(name: string): string {
    let id = this.modernAuthors.get(name);
    if (!id) {
      id = guid(0xa, this.modernAuthors.size + 1);
      this.modernAuthors.set(name, id);
    }
    return id;
  }

  private modernCommentsXml(comments: ModernCommentSpec[], sldId: number): string {
    const slideMoniker = `<pc:docMk/><pc:sldMk cId="0" sldId="${sldId}"/>`;
    const items = comments.map((comment) => {
      const commentId = guid(0xc, ++this.guidCount);
      const authorId = this.modernAuthorId(comment.author);
      const anchor =
        comment.shapeId !== undefined
          ? `<ac:deMkLst>${slideMoniker}<ac:spMk id="${comment.shapeId}"/></ac:deMkLst>`
          : `<pc:sldMkLst>${slideMoniker}</pc:sldMkLst>`;
      const position = comment.position
        ? `<p188:pos x="${comment.position.x}" y="${comment.position.y}"/>`
        : '';
      const replies = comment.replies?.length
        ? `<p188:replyLst>${comment.replies
            .map(
              (reply) =>
                `<p188:reply id="${guid(0xc, ++this.guidCount)}" authorId="${this.modernAuthorId(reply.author)}" created="${reply.created ?? DEFAULT_DATE}">` +
                `${commentBodyXml(reply.text)}</p188:reply>`,
            )
            .join('')}</p188:replyLst>`
        : '';
      const status = comment.status ? ` status="${comment.status}"` : '';
      return (
        `<p188:cm id="${commentId}" authorId="${authorId}" created="${comment.created ?? DEFAULT_DATE}"${status}>` +
        `${anchor}${position}${replies}${commentBodyXml(comment.text)}</p188:cm>`
      );
    });
    return (
      `${XML_DECLARATION}<p188:cmLst xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p188="${NS.p188}" xmlns:pc="${NS.pc}" xmlns:ac="${NS.ac}">` +
      `${items.join('')}</p188:cmLst>`
    );
  }

  private legacyCommentsXml(comments: LegacyCommentSpec[]): string {
    const items = comments.map((comment) => {
      let author = this.legacyAuthors.get(comment.author);
      if (!author) {
        author = { id: this.legacyAuthors.size, lastIdx: 0 };
        this.legacyAuthors.set(comment.author, author);
      }
      author.lastIdx += 1;
      return (
        `<p:cm authorId="${author.id}" dt="${(comment.created ?? DEFAULT_DATE).replace(/Z$/, '')}" idx="${author.lastIdx}">` +
        `<p:pos x="${comment.position.x}" y="${comment.position.y}"/><p:text>${escapeXml(comment.text)}</p:text></p:cm>`
      );
    });
    return `${XML_DECLARATION}<p:cmLst ${PML_NAMESPACES}>${items.join('')}</p:cmLst>`;
  }

  // --- Presentation and package ----------------------------------------------------------------

  private writePresentation(slides: { sldId: number; target: string }[]): void {
    const rels: Relationship[] = [
      { id: 'rId1', type: REL_TYPES.slideMaster, target: 'slideMasters/slideMaster1.xml' },
      ...slides.map((slide, index) => ({
        id: `rId${index + 2}`,
        type: REL_TYPES.slide,
        target: slide.target,
      })),
    ];
    const addRel = (type: string, target: string) =>
      rels.push({ id: `rId${rels.length + 1}`, type, target });
    addRel(REL_TYPES.presProps, 'presProps.xml');
    addRel(REL_TYPES.viewProps, 'viewProps.xml');
    addRel(REL_TYPES.theme, 'theme/theme1.xml');
    addRel(REL_TYPES.tableStyles, 'tableStyles.xml');
    if (this.legacyAuthors.size > 0) {
      addRel(REL_TYPES.commentAuthors, 'commentAuthors.xml');
      this.addPart('ppt/commentAuthors.xml', this.legacyAuthorsXml(), CONTENT_TYPES.commentAuthors);
    }
    if (this.modernAuthors.size > 0) {
      addRel(REL_TYPES.authors, 'authors.xml');
      this.addPart('ppt/authors.xml', this.modernAuthorsXml(), CONTENT_TYPES.authors);
    }

    const slideIds = slides
      .map((slide, index) => `<p:sldId id="${slide.sldId}" r:id="rId${index + 2}"/>`)
      .join('');
    this.addPart(
      PRESENTATION_PATH,
      `${XML_DECLARATION}<p:presentation ${PML_NAMESPACES} saveSubsetFonts="1">` +
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
        `<p:sldIdLst>${slideIds}</p:sldIdLst>` +
        `<p:sldSz cx="${this.size.cx}" cy="${this.size.cy}"/><p:notesSz cx="6858000" cy="9144000"/>` +
        this.sectionsXml(slides) +
        '</p:presentation>',
      CONTENT_TYPES.presentation,
    );
    this.addPart('ppt/_rels/presentation.xml.rels', relationshipsXml(rels));
  }

  private sectionsXml(slides: { sldId: number }[]): string {
    if (!this.deck.sections?.length) return '';
    const sections = this.deck.sections
      .map((section, index) => {
        const ids = section.slides
          .map((slideIndex) => `<p14:sldId id="${slides[slideIndex]?.sldId}"/>`)
          .join('');
        return `<p14:section name="${escapeXml(section.name)}" id="${guid(0x5, index + 1)}"><p14:sldIdLst>${ids}</p14:sldIdLst></p14:section>`;
      })
      .join('');
    return (
      '<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}">' +
      `<p14:sectionLst xmlns:p14="${NS.p14}">${sections}</p14:sectionLst></p:ext></p:extLst>`
    );
  }

  private modernAuthorsXml(): string {
    const authors = [...this.modernAuthors]
      .map(
        ([name, id]) =>
          `<p188:author id="${id}" name="${escapeXml(name)}" initials="${escapeXml(initialsOf(name))}" userId="${escapeXml(name)}" providerId="None"/>`,
      )
      .join('');
    return `${XML_DECLARATION}<p188:authorLst xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p188="${NS.p188}">${authors}</p188:authorLst>`;
  }

  private legacyAuthorsXml(): string {
    const authors = [...this.legacyAuthors]
      .map(
        ([name, author]) =>
          `<p:cmAuthor id="${author.id}" name="${escapeXml(name)}" initials="${escapeXml(initialsOf(name))}" lastIdx="${author.lastIdx}" clrIdx="${author.id}"/>`,
      )
      .join('');
    return `${XML_DECLARATION}<p:cmAuthorLst ${PML_NAMESPACES}>${authors}</p:cmAuthorLst>`;
  }

  private writePackageParts(): void {
    const title = this.deck.title ?? 'Slider fixture';
    this.addPart('ppt/presProps.xml', PRES_PROPS_XML, CONTENT_TYPES.presProps);
    this.addPart('ppt/viewProps.xml', VIEW_PROPS_XML, CONTENT_TYPES.viewProps);
    this.addPart('ppt/tableStyles.xml', TABLE_STYLES_XML, CONTENT_TYPES.tableStyles);
    this.addPart(
      'docProps/core.xml',
      corePropertiesXml(title, '2026-01-15T09:30:00Z'),
      CONTENT_TYPES.coreProperties,
    );
    this.addPart(
      'docProps/app.xml',
      extendedPropertiesXml(this.deck.slides.length),
      CONTENT_TYPES.extendedProperties,
    );
    this.addPart(
      '_rels/.rels',
      relationshipsXml([
        { id: 'rId1', type: REL_TYPES.officeDocument, target: PRESENTATION_PATH },
        { id: 'rId2', type: REL_TYPES.coreProperties, target: 'docProps/core.xml' },
        { id: 'rId3', type: REL_TYPES.extendedProperties, target: 'docProps/app.xml' },
      ]),
    );
    this.addPart('[Content_Types].xml', contentTypesXml(this.overrides));
  }
}

// --- Shape markup ------------------------------------------------------------------------------

interface SlideContext {
  rels: Relationship[];
  nextId: number;
}

function takeId(context: SlideContext, explicit?: number): number {
  const id = explicit ?? context.nextId;
  context.nextId = Math.max(context.nextId, id + 1);
  return id;
}

type FontSpec = NonNullable<RectSpec['font']>;

/** One paragraph with a single run (or an empty paragraph), optionally formatted. */
function paragraphXml(text: string, font: FontSpec = {}, align?: RectSpec['align']): string {
  const paragraphProperties = align ? `<a:pPr algn="${align}"/>` : '';
  if (text === '') return `<a:p>${paragraphProperties}<a:endParaRPr lang="de-DE"/></a:p>`;
  const attributes =
    (font.sizePt ? ` sz="${Math.round(font.sizePt * 100)}"` : '') +
    (font.bold ? ' b="1"' : '') +
    (font.italic ? ' i="1"' : '');
  const runProperties = font.color
    ? `<a:rPr lang="de-DE"${attributes}><a:solidFill><a:srgbClr val="${font.color}"/></a:solidFill></a:rPr>`
    : `<a:rPr lang="de-DE"${attributes}/>`;
  return `<a:p>${paragraphProperties}<a:r>${runProperties}<a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
}

function placeholderXml(
  context: SlideContext,
  label: string,
  ph: string,
  paragraphs: string[],
): string {
  const id = takeId(context);
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${label} ${id - 1}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.map((text) => paragraphXml(text)).join('')}</p:txBody></p:sp>`
  );
}

function rectXml(id: number, name: string, shape: RectSpec): string {
  const fill = shape.fill
    ? `<a:solidFill><a:srgbClr val="${shape.fill}"/></a:solidFill>`
    : '<a:noFill/>';
  const paragraphs = (shape.text ?? '')
    .split('\n')
    .map((text) => paragraphXml(text, shape.font, shape.align))
    .join('');
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrmXml(shape.box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill}<a:ln><a:noFill/></a:ln></p:spPr>` +
    `<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
  );
}

function tableXml(id: number, name: string, shape: TableSpec): string {
  const columns = Math.max(1, ...shape.rows.map((row) => row.length));
  const columnWidth = Math.floor(shape.box.w / columns);
  const rowHeight = Math.floor(shape.box.h / Math.max(1, shape.rows.length));
  const grid = `<a:tblGrid>${`<a:gridCol w="${columnWidth}"/>`.repeat(columns)}</a:tblGrid>`;
  const rows = shape.rows
    .map((row) => {
      const cells = Array.from(
        { length: columns },
        (_, column) =>
          `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paragraphXml(row[column] ?? '')}</a:txBody><a:tcPr/></a:tc>`,
      ).join('');
      return `<a:tr h="${rowHeight}">${cells}</a:tr>`;
    })
    .join('');
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/>` +
    '<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>' +
    `${xfrmXml(shape.box, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">` +
    `<a:tbl><a:tblPr firstRow="1" bandRow="1"/>${grid}${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

function commentBodyXml(text: string): string {
  const paragraphs = text
    .split('\n')
    .map((line) => `<a:p><a:r><a:rPr lang="de-DE"/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`)
    .join('');
  return `<p188:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p188:txBody>`;
}

export { LAYOUT_NAMES } from './ooxml';
