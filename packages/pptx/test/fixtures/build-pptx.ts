import JSZip from 'jszip';
import {
  CONTENT_TYPES,
  contentTypesXml,
  corePropertiesXml,
  escapeXml,
  extendedPropertiesXml,
  MASTER_BODY_BOX,
  MASTER_TITLE_BOX,
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
  TITLE_LAYOUT_SUBTITLE_BOX,
  TITLE_LAYOUT_TITLE_BOX,
  VIEW_PROPS_XML,
  XML_DECLARATION,
  xfrmXml,
  type AppPropertiesSpec,
  type CorePropertiesSpec,
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
  /** Drawing guides of the presentation (`p15:sldGuideLst`), `pos` in 1/576 inch. */
  guides?: { orient: 'horz' | 'vert'; pos: number }[];

  // The options below are opt-in producer quirks for the BER-106 corpus. Leaving them out keeps
  // the output byte-identical to what the builder wrote before they existed.

  /** Renames the built-in layouts (`p:cSld/@name`), e.g. Google Slides' `TITLE_AND_BODY`. */
  layoutNames?: Partial<Record<LayoutKind, string>>;
  /** `docProps/app.xml` fields; without it the historic fixed part is written. */
  app?: AppPropertiesSpec;
  /** `docProps/core.xml` fields (creator, lastModifiedBy, revision). */
  core?: CorePropertiesSpec;
  /**
   * Account of a modern comment author by name (`p188:author/@userId`, `@providerId`), e.g.
   * `{ userId: 'S::lena@contoso.com::…', providerId: 'AD' }`. Default: userId = name, `None`.
   */
  authorAccounts?: Record<string, { userId: string; providerId: string }>;
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

  // Opt-in producer quirks (BER-106 corpus); see DeckSpec.

  /**
   * Number of the slide part (`ppt/slides/slide{n}.xml`, presentation rel `rId{n+1}`); defaults
   * to the position. Set it on every slide or none, so part names and rIds stay unique.
   */
  partNumber?: number;
  /** `p14:creationId` in the slide's `p:extLst`; also used as `pc:sldMk/@cId` of its comments. */
  creationId?: number;
  /**
   * Puts the slide on a layout of this name under a second slide master, as PowerPoint's
   * "Reuse slides → keep source formatting" does. `layout` still picks the placeholder set.
   */
  foreignLayout?: string;
  /** First `p:cNvPr/@id` for the slide's shapes; defaults to 2. */
  firstShapeId?: number;
  /** Writes the inherited placeholder boxes as explicit `a:xfrm`, as Google Slides does. */
  explicitPlaceholderBoxes?: boolean;
  /**
   * Footer placeholders as "Insert → Header & Footer" writes them: footer text, and the date and
   * slide number as `a:fld`s carrying their cached value (PowerPoint rewrites it on every save).
   */
  footer?: { text?: string; date?: string; slideNumber?: string };
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
  /**
   * Index of the comment (in the same slide's `legacyComments`) this one replies to, written as
   * `p15:threadingInfo/p15:parentCm` like PowerPoint 2013–2019 did.
   */
  replyTo?: number;
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
    const foreignLayoutPaths = this.writeForeignMaster();
    const slideRels = this.deck.slides.map((slide, index) => {
      const kind = slide.layout ?? 'content';
      const layoutPath =
        slide.foreignLayout !== undefined
          ? foreignLayoutPaths.get(foreignLayoutKey(kind, slide.foreignLayout))
          : layoutPaths[kind];
      if (!layoutPath) throw new Error(`No layout for slide ${index}`);
      return this.writeSlide(slide, index, layoutPath);
    });
    this.writePresentation(slideRels, foreignLayoutPaths.size > 0);
    this.writePackageParts();
    return this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  private addPart(partName: string, content: string | Uint8Array, contentType?: string): void {
    // A fixed entry date and no implicit folder entries (which would carry the current time)
    // keep generated packages byte-identical between runs and runtimes.
    this.zip.file(partName, content, { date: new Date(DEFAULT_DATE), createFolders: false });
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
      const name = this.deck.layoutNames?.[kind];
      this.addPart(
        path,
        name === undefined ? slideLayoutXml(kind) : slideLayoutXml(kind, name),
        CONTENT_TYPES.slideLayout,
      );
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

  /**
   * A second master (`slideMaster2.xml`, own theme) holding one layout per distinct
   * `foreignLayout` – what a slide reused from another deck brings along. Written only when a
   * slide asks for it.
   */
  private writeForeignMaster(): Map<string, string> {
    const layouts: { kind: LayoutKind; name: string }[] = [];
    for (const slide of this.deck.slides) {
      if (slide.foreignLayout === undefined) continue;
      const kind = slide.layout ?? 'content';
      const key = foreignLayoutKey(kind, slide.foreignLayout);
      if (!layouts.some((layout) => foreignLayoutKey(layout.kind, layout.name) === key)) {
        layouts.push({ kind, name: slide.foreignLayout });
      }
    }
    const paths = new Map<string, string>();
    if (layouts.length === 0) return paths;
    this.addPart(
      'ppt/slideMasters/slideMaster2.xml',
      slideMasterXml(
        layouts.map((_, index) => `rId${index + 1}`),
        FOREIGN_MASTER_ID + 1,
      ),
      CONTENT_TYPES.slideMaster,
    );
    this.addPart(
      'ppt/slideMasters/_rels/slideMaster2.xml.rels',
      relationshipsXml([
        ...layouts.map((_, index) => ({
          id: `rId${index + 1}`,
          type: REL_TYPES.slideLayout,
          target: `../slideLayouts/slideLayout${index + 3}.xml`,
        })),
        { id: `rId${layouts.length + 1}`, type: REL_TYPES.theme, target: '../theme/theme2.xml' },
      ]),
    );
    this.addPart('ppt/theme/theme2.xml', THEME_XML, CONTENT_TYPES.theme);
    layouts.forEach((layout, index) => {
      const path = `ppt/slideLayouts/slideLayout${index + 3}.xml`;
      this.addPart(path, slideLayoutXml(layout.kind, layout.name), CONTENT_TYPES.slideLayout);
      this.addPart(
        `ppt/slideLayouts/_rels/slideLayout${index + 3}.xml.rels`,
        relationshipsXml([
          { id: 'rId1', type: REL_TYPES.slideMaster, target: '../slideMasters/slideMaster2.xml' },
        ]),
      );
      paths.set(foreignLayoutKey(layout.kind, layout.name), path);
    });
    return paths;
  }

  // --- Slides ------------------------------------------------------------------------------------

  private writeSlide(slide: SlideSpec, index: number, layoutPath: string): SlideRef {
    const number = slide.partNumber ?? index + 1;
    const sldId = slide.sldId ?? 256 + index;
    const rels: Relationship[] = [
      { id: 'rId1', type: REL_TYPES.slideLayout, target: `../${layoutPath.slice('ppt/'.length)}` },
    ];
    const context: SlideContext = { rels, nextId: slide.firstShapeId ?? 2 };

    const placeholders = this.placeholderShapes(slide, context);
    const extraShapes = (slide.shapes ?? []).map((shape) => this.shapeXml(shape, context)).join('');

    if (slide.comments?.length) {
      const fileName =
        slide.creationId === undefined
          ? `modernComment_${sldId}_${sldId.toString(16).toUpperCase().padStart(8, '0')}.xml`
          : `modernComment_${sldId.toString(16).toUpperCase()}_${hex8(slide.creationId)}.xml`;
      this.addPart(
        `ppt/comments/${fileName}`,
        this.modernCommentsXml(slide.comments, sldId, slide.creationId ?? 0),
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
    const extensions =
      slide.creationId === undefined
        ? ''
        : '<p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}">' +
          `<p14:creationId xmlns:p14="${NS.p14}" val="${slide.creationId}"/></p:ext></p:extLst>`;
    this.addPart(
      `ppt/slides/slide${number}.xml`,
      `${XML_DECLARATION}<p:sld ${PML_NAMESPACES}${slide.hidden ? ' show="0"' : ''}>` +
        `<p:cSld>${background}<p:spTree>${SP_TREE_HEADER}${placeholders}${extraShapes}</p:spTree></p:cSld>` +
        `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${extensions}</p:sld>`,
      CONTENT_TYPES.slide,
    );
    this.addPart(`ppt/slides/_rels/slide${number}.xml.rels`, relationshipsXml(rels));
    return {
      sldId,
      target: `slides/slide${number}.xml`,
      relId: slide.partNumber === undefined ? undefined : `rId${slide.partNumber + 1}`,
    };
  }

  private placeholderShapes(slide: SlideSpec, context: SlideContext): string {
    const isTitleLayout = (slide.layout ?? 'content') === 'title';
    const explicit = slide.explicitPlaceholderBoxes === true;
    let xml = '';
    if (slide.title !== undefined) {
      xml += placeholderXml(
        context,
        'Title',
        `<p:ph type="${isTitleLayout ? 'ctrTitle' : 'title'}"/>`,
        [slide.title],
        explicit ? (isTitleLayout ? TITLE_LAYOUT_TITLE_BOX : MASTER_TITLE_BOX) : undefined,
      );
    }
    if (slide.body !== undefined) {
      const paragraphs = Array.isArray(slide.body) ? slide.body : [slide.body];
      const ph = isTitleLayout ? '<p:ph type="subTitle" idx="1"/>' : '<p:ph idx="1"/>';
      xml += placeholderXml(
        context,
        isTitleLayout ? 'Subtitle' : 'Content',
        ph,
        paragraphs,
        explicit ? (isTitleLayout ? TITLE_LAYOUT_SUBTITLE_BOX : MASTER_BODY_BOX) : undefined,
      );
    }
    const footer = slide.footer;
    if (footer?.date !== undefined) {
      xml += fieldPlaceholderXml(
        context,
        'Date Placeholder',
        '<p:ph type="dt" sz="half" idx="10"/>',
        FOOTER_DATE_BOX,
        'datetime1',
        footer.date,
      );
    }
    if (footer?.text !== undefined) {
      xml += placeholderXml(
        context,
        'Footer Placeholder',
        '<p:ph type="ftr" sz="quarter" idx="11"/>',
        [footer.text],
        FOOTER_TEXT_BOX,
      );
    }
    if (footer?.slideNumber !== undefined) {
      xml += fieldPlaceholderXml(
        context,
        'Slide Number Placeholder',
        '<p:ph type="sldNum" sz="quarter" idx="12"/>',
        FOOTER_NUMBER_BOX,
        'slidenum',
        footer.slideNumber,
      );
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

  private modernCommentsXml(
    comments: ModernCommentSpec[],
    sldId: number,
    creationId: number,
  ): string {
    const slideMoniker = `<pc:docMk/><pc:sldMk cId="${creationId}" sldId="${sldId}"/>`;
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
    const written: { authorId: number; idx: number }[] = [];
    const items = comments.map((comment) => {
      let author = this.legacyAuthors.get(comment.author);
      if (!author) {
        author = { id: this.legacyAuthors.size, lastIdx: 0 };
        this.legacyAuthors.set(comment.author, author);
      }
      author.lastIdx += 1;
      written.push({ authorId: author.id, idx: author.lastIdx });
      const parent = comment.replyTo === undefined ? undefined : written[comment.replyTo];
      if (comment.replyTo !== undefined && !parent) {
        throw new Error(`Legacy comment replies to unknown comment ${comment.replyTo}`);
      }
      const threading = parent
        ? '<p:extLst><p:ext uri="{C676402C-5697-4E1C-873F-D02D1690AC5C}">' +
          `<p15:threadingInfo xmlns:p15="${NS.p15}" timeZoneBias="0">` +
          `<p15:parentCm authorId="${parent.authorId}" idx="${parent.idx}"/></p15:threadingInfo></p:ext></p:extLst>`
        : '';
      return (
        `<p:cm authorId="${author.id}" dt="${(comment.created ?? DEFAULT_DATE).replace(/Z$/, '')}" idx="${author.lastIdx}">` +
        `<p:pos x="${comment.position.x}" y="${comment.position.y}"/><p:text>${escapeXml(comment.text)}</p:text>${threading}</p:cm>`
      );
    });
    return `${XML_DECLARATION}<p:cmLst ${PML_NAMESPACES}>${items.join('')}</p:cmLst>`;
  }

  // --- Presentation and package ----------------------------------------------------------------

  private writePresentation(slides: SlideRef[], foreignMaster: boolean): void {
    const slideRelId = (slide: SlideRef, index: number) => slide.relId ?? `rId${index + 2}`;
    const rels: Relationship[] = [
      { id: 'rId1', type: REL_TYPES.slideMaster, target: 'slideMasters/slideMaster1.xml' },
      ...slides.map((slide, index) => ({
        id: slideRelId(slide, index),
        type: REL_TYPES.slide,
        target: slide.target,
      })),
    ];
    if (new Set(rels.map((rel) => rel.id)).size !== rels.length) {
      throw new Error('Duplicate presentation relationship ids (set partNumber on all slides)');
    }
    // Next free number; with positional slide rIds this equals rels.length + 1.
    const addRel = (type: string, target: string): string => {
      const highest = Math.max(...rels.map((rel) => Number(rel.id.slice('rId'.length))));
      const id = `rId${highest + 1}`;
      rels.push({ id, type, target });
      return id;
    };
    const foreignMasterRelId = foreignMaster
      ? addRel(REL_TYPES.slideMaster, 'slideMasters/slideMaster2.xml')
      : undefined;
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
      .map((slide, index) => `<p:sldId id="${slide.sldId}" r:id="${slideRelId(slide, index)}"/>`)
      .join('');
    const foreignMasterId = foreignMasterRelId
      ? `<p:sldMasterId id="${FOREIGN_MASTER_ID}" r:id="${foreignMasterRelId}"/>`
      : '';
    this.addPart(
      PRESENTATION_PATH,
      `${XML_DECLARATION}<p:presentation ${PML_NAMESPACES} saveSubsetFonts="1">` +
        `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/>${foreignMasterId}</p:sldMasterIdLst>` +
        `<p:sldIdLst>${slideIds}</p:sldIdLst>` +
        `<p:sldSz cx="${this.size.cx}" cy="${this.size.cy}"/><p:notesSz cx="6858000" cy="9144000"/>` +
        this.extensionsXml(slides) +
        '</p:presentation>',
      CONTENT_TYPES.presentation,
    );
    this.addPart('ppt/_rels/presentation.xml.rels', relationshipsXml(rels));
  }

  private extensionsXml(slides: { sldId: number }[]): string {
    const extensions = this.sectionsXml(slides) + this.guidesXml();
    return extensions ? `<p:extLst>${extensions}</p:extLst>` : '';
  }

  private guidesXml(): string {
    if (!this.deck.guides?.length) return '';
    const guides = this.deck.guides
      .map(
        (guide, index) =>
          `<p15:guide id="${index + 1}" orient="${guide.orient}" pos="${guide.pos}"/>`,
      )
      .join('');
    return (
      '<p:ext uri="{EFAFB233-063F-42B5-8137-9DF3F51BA10A}">' +
      `<p15:sldGuideLst xmlns:p15="${NS.p15}">${guides}</p15:sldGuideLst></p:ext>`
    );
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
      '<p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}">' +
      `<p14:sectionLst xmlns:p14="${NS.p14}">${sections}</p14:sectionLst></p:ext>`
    );
  }

  private modernAuthorsXml(): string {
    const authors = [...this.modernAuthors]
      .map(
        ([name, id]) =>
          `<p188:author id="${id}" name="${escapeXml(name)}" initials="${escapeXml(initialsOf(name))}" ` +
          `userId="${escapeXml(this.deck.authorAccounts?.[name]?.userId ?? name)}" ` +
          `providerId="${escapeXml(this.deck.authorAccounts?.[name]?.providerId ?? 'None')}"/>`,
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
      corePropertiesXml(title, '2026-01-15T09:30:00Z', this.deck.core),
      CONTENT_TYPES.coreProperties,
    );
    this.addPart(
      'docProps/app.xml',
      extendedPropertiesXml(this.deck.slides.length, this.deck.app),
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

interface SlideRef {
  sldId: number;
  target: string;
  /** Presentation rel id when the slide has an explicit part number. */
  relId?: string;
}

/** `p:sldMasterId` of the second master; its layouts follow it in the shared id space. */
const FOREIGN_MASTER_ID = 2147483651;

const foreignLayoutKey = (kind: LayoutKind, name: string) => `${kind}|${name}`;

const hex8 = (value: number) => value.toString(16).toUpperCase().padStart(8, '0');

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
  box?: EmuBox,
): string {
  const id = takeId(context);
  const spPr = box
    ? `<p:spPr>${xfrmXml(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`
    : '<p:spPr/>';
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${label} ${id - 1}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${ph}</p:nvPr></p:nvSpPr>${spPr}` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs.map((text) => paragraphXml(text)).join('')}</p:txBody></p:sp>`
  );
}

/** PowerPoint's 16:9 footer row: date left, footer text centred, slide number right. */
const FOOTER_DATE_BOX = { x: 838_200, y: 6_356_350, w: 2_743_200, h: 365_125 };
const FOOTER_TEXT_BOX = { x: 4_038_600, y: 6_356_350, w: 4_114_800, h: 365_125 };
const FOOTER_NUMBER_BOX = { x: 8_610_600, y: 6_356_350, w: 2_743_200, h: 365_125 };

/** A footer placeholder holding one text field (`a:fld`) with its cached value. */
function fieldPlaceholderXml(
  context: SlideContext,
  label: string,
  ph: string,
  box: EmuBox,
  type: string,
  value: string,
): string {
  const id = takeId(context);
  const field =
    `<a:fld id="${guid(7, id)}" type="${type}"><a:rPr lang="de-DE"/>` +
    `<a:t>${escapeXml(value)}</a:t></a:fld>`;
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${label} ${id - 1}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${ph}</p:nvPr></p:nvSpPr>` +
    `<p:spPr>${xfrmXml(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p>${field}<a:endParaRPr lang="de-DE"/></a:p></p:txBody></p:sp>`
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
