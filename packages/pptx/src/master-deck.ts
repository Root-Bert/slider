import { Archive, REL, relsPathOf } from './archive';
import { readColorScheme, type ColorScheme } from './colors';
import { PptxError } from './types';
import { attr, child, children, descendants, intAttr, path, type XmlElement } from './xml';

/*
 * A company design (`.potx`, or any `.pptx`) as a set of slide masters: its masters and their
 * layouts, and a copy of the file with one slide per layout – its placeholders filled with
 * "Titel", "Text" or the layout's own prompt – for an office suite to draw the layouts as
 * pictures. Neither PowerPoint nor LibreOffice draws an empty placeholder on a slide.
 */

/** Layouts of one file drawn at most – real designs have a few dozen. */
export const MAX_MASTER_LAYOUTS = 80;

/** `PptxError` message of a package without any slide layout. */
export const NO_LAYOUTS = 'The file has no slide layouts.';

/** A layout of the file, in the order of its masters and of their layout lists. */
export interface MasterLayout {
  /** The master's theme name ("Office Theme", the company's), or `null`. */
  master: string | null;
  /** The layout's name ("Titelfolie", "Title and Content"), or `null`. */
  name: string | null;
}

export interface MasterDeck {
  /**
   * The file as Slider keeps it: without external links, marked as a plain template, so it
   * opens as a `.potx` (a macro-enabled one, a show or a presentation too).
   */
  file: Uint8Array;
  /** Whether the file is a template (`.potx`, `.potm`) rather than a presentation. */
  template: boolean;
  /** The same with one slide per layout instead of its own slides, in `layouts`' order. */
  deck: Uint8Array;
  layouts: MasterLayout[];
  /** The first master's theme colours (`dk1`, `lt1`, `accent1`, … → `#rrggbb`), in file order. */
  colors: ColorScheme;
  /** Slide size in EMU. */
  size: { cx: number; cy: number };
}

const PRESENTATION = 'ppt/presentation.xml';
const CONTENT_TYPES = '[Content_Types].xml';
const MAIN_TYPE =
  /application\/vnd\.(?:openxmlformats-officedocument\.presentationml|ms-powerpoint)\.(?:template|slideshow|presentation)(?:\.macroEnabled)?\.main\+xml/g;
const PRESENTATION_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';
const TEMPLATE_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml';
const SLIDE_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml';
/** Where the drawn layouts go – no PowerPoint names its slides so. */
const slidePath = (index: number) => `ppt/slides/slider-layout-${index + 1}.xml`;

/** Placeholders a layout picture shows, and what they say unless the layout has its own prompt. */
const LABELS: Record<string, string> = {
  title: 'Titel',
  ctrTitle: 'Titel',
  subTitle: 'Untertitel',
  body: 'Text',
  obj: 'Text',
};
/** Paragraphs of a layout's own prompt taken over, and their characters. */
const MAX_PROMPT_PARAGRAPHS = 3;
const MAX_PROMPT_CHARS = 160;

const escapeXml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!,
  );

/** `from` → `to` as a relationship target relative to `from`'s folder. */
function relativeTarget(from: string, to: string): string {
  const base = from.split('/').slice(0, -1);
  const target = to.split('/');
  let shared = 0;
  while (shared < base.length && base[shared] === target[shared]) shared += 1;
  return [...base.slice(shared).map(() => '..'), ...target.slice(shared)].join('/');
}

/** A layout's placeholder as a slide shape: same `ph`, so it takes the layout's place and look. */
function placeholderShape(sp: XmlElement, id: number): string | null {
  const ph = path(sp, 'p:nvSpPr', 'p:nvPr', 'p:ph');
  if (!ph) return null;
  // No type is a body placeholder (ECMA-376 19.3.1.36).
  const type = attr(ph, 'type') ?? 'body';
  const label = LABELS[type];
  if (!label) return null;
  let paragraphs = [label];
  if (attr(ph, 'hasCustomPrompt') === '1' || attr(ph, 'hasCustomPrompt') === 'true') {
    const prompt = children(child(sp, 'p:txBody'), 'a:p')
      .map((p) =>
        descendants(p, 'a:t')
          .map((t) => t.text)
          .join('')
          .trim(),
      )
      .filter(Boolean)
      .slice(0, MAX_PROMPT_PARAGRAPHS)
      .map((text) => text.slice(0, MAX_PROMPT_CHARS));
    if (prompt.length > 0) paragraphs = prompt;
  }
  const phAttributes = [
    `type="${escapeXml(type)}"`,
    ...(attr(ph, 'idx') !== undefined ? [`idx="${escapeXml(attr(ph, 'idx') ?? '')}"`] : []),
    ...(attr(ph, 'orient') ? [`orient="${escapeXml(attr(ph, 'orient') ?? '')}"`] : []),
    ...(attr(ph, 'sz') ? [`sz="${escapeXml(attr(ph, 'sz') ?? '')}"`] : []),
  ].join(' ');
  const body = paragraphs
    .map(
      (text) =>
        `<a:p><a:r><a:rPr lang="de-DE" dirty="0"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`,
    )
    .join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(label)} ${id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph ${phAttributes}/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp>`;
}

function layoutSlide(layout: XmlElement): string {
  const shapes = children(path(layout, 'p:cSld', 'p:spTree'), 'p:sp')
    .map((sp, index) => placeholderShape(sp, index + 2))
    .filter((shape): shape is string => shape !== null)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

/**
 * Reads the masters and layouts of a PowerPoint file (`.pptx`, `.potx`, `.ppsx`) and builds the
 * copy that draws them. The input is never modified.
 *
 * @throws {PptxError} like `openPptx` for files that are not a readable package; `not_pptx` also
 *   for a package without any layout.
 */
export async function masterDeck(data: Uint8Array | ArrayBuffer): Promise<MasterDeck> {
  // Nothing the file links to outside itself survives into either copy.
  const clean = await (await Archive.open(data)).withoutExternalRelationships();
  const archive = await Archive.open(clean);
  const presentationXml = await archive.readText(PRESENTATION);
  const contentTypes = await archive.readText(CONTENT_TYPES);
  const presentation = await archive.readXml(PRESENTATION);
  if (!presentationXml || !contentTypes || !presentation) {
    throw new PptxError('not_pptx', 'The file is not a PowerPoint (.pptx) package.');
  }
  const cx = intAttr(child(presentation, 'p:sldSz'), 'cx');
  const cy = intAttr(child(presentation, 'p:sldSz'), 'cy');
  if (!cx || !cy || cx <= 0 || cy <= 0) {
    throw new PptxError('corrupt', 'The presentation has no valid slide size.');
  }

  const layouts: (MasterLayout & { path: string; xml: XmlElement })[] = [];
  let colors: ColorScheme | null = null;
  const masterRels = await archive.relationshipsOfType(PRESENTATION, REL.slideMaster);
  for (const masterId of children(child(presentation, 'p:sldMasterIdLst'), 'p:sldMasterId')) {
    const masterPath = masterRels.find((rel) => rel.id === attr(masterId, 'r:id'))?.target;
    const master = masterPath ? await archive.readXml(masterPath) : null;
    if (!masterPath || !master) continue;
    const [themeRel] = await archive.relationshipsOfType(masterPath, REL.theme);
    const theme = themeRel ? await archive.readXml(themeRel.target) : null;
    const masterName = attr(theme, 'name')?.trim() || null;
    // The first master whose theme has colours: a theme-less one reads as none, not as found.
    if (!colors?.size) colors = readColorScheme(theme);
    const layoutRels = await archive.relationshipsOfType(masterPath, REL.slideLayout);
    for (const layoutId of children(child(master, 'p:sldLayoutIdLst'), 'p:sldLayoutId')) {
      const layoutPath = layoutRels.find((rel) => rel.id === attr(layoutId, 'r:id'))?.target;
      const layout = layoutPath ? await archive.readXml(layoutPath) : null;
      if (!layoutPath || !layout) continue;
      layouts.push({
        master: masterName,
        name: attr(child(layout, 'p:cSld'), 'name')?.trim() || null,
        path: layoutPath,
        xml: layout,
      });
      if (layouts.length >= MAX_MASTER_LAYOUTS) break;
    }
    if (layouts.length >= MAX_MASTER_LAYOUTS) break;
  }
  if (layouts.length === 0) {
    throw new PptxError('not_pptx', NO_LAYOUTS);
  }

  const relsPath = relsPathOf(PRESENTATION);
  const presentationRels = (await archive.readText(relsPath)) ?? '';
  // Everything is read: from here on `archive` is the copy being written (`withParts`), the
  // file as kept first, then the deck built on it.
  const template = /\.template(?:\.macroEnabled)?\.main\+xml/.test(contentTypes);
  const typesAsTemplate = contentTypes.replace(MAIN_TYPE, TEMPLATE_TYPE);
  const file =
    typesAsTemplate === contentTypes
      ? clean
      : await archive.withParts({ [CONTENT_TYPES]: typesAsTemplate });
  const typesAsPresentation = contentTypes.replace(MAIN_TYPE, PRESENTATION_TYPE);

  // The deck: its own slides left out of the list (their parts stay, unreferenced), sections and
  // custom shows that name them dropped, one slide per layout listed instead.
  const parts: Record<string, string> = {};
  const newRels: string[] = [];
  const slideIds: string[] = [];
  const overrides: string[] = [];
  layouts.forEach((layout, index) => {
    const slide = slidePath(index);
    parts[slide] = layoutSlide(layout.xml);
    parts[relsPathOf(slide)] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL.slideLayout}" Target="${escapeXml(relativeTarget(slide, layout.path))}"/></Relationships>`;
    const rId = `rIdSliderLayout${index + 1}`;
    newRels.push(
      `<Relationship Id="${rId}" Type="${REL.slide}" Target="slides/slider-layout-${index + 1}.xml"/>`,
    );
    slideIds.push(`<p:sldId id="${256 + index}" r:id="${rId}"/>`);
    overrides.push(`<Override PartName="/${slide}" ContentType="${SLIDE_TYPE}"/>`);
  });
  if (!presentationRels.includes('</Relationships>')) {
    throw new PptxError('corrupt', 'The presentation has no relationships.');
  }
  parts[relsPath] = presentationRels.replace(
    '</Relationships>',
    `${newRels.join('')}</Relationships>`,
  );
  parts[CONTENT_TYPES] = typesAsPresentation.replace('</Types>', `${overrides.join('')}</Types>`);
  const list = `<p:sldIdLst>${slideIds.join('')}</p:sldIdLst>`;
  let xml = presentationXml
    .replace(/<p:custShowLst\b[\s\S]*?<\/p:custShowLst>|<p:custShowLst\s*\/>/, '')
    .replace(/<p14:sectionLst\b[\s\S]*?<\/p14:sectionLst>/, '');
  if (/<p:sldIdLst\b/.test(xml)) {
    xml = xml.replace(/<p:sldIdLst\b[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\s*\/>/, list);
  } else {
    // Right after the master lists, where the schema wants it.
    const anchor = ['</p:handoutMasterIdLst>', '</p:notesMasterIdLst>', '</p:sldMasterIdLst>'].find(
      (tag) => xml.includes(tag),
    );
    if (!anchor) throw new PptxError('corrupt', 'The presentation lists no slide master.');
    xml = xml.replace(anchor, `${anchor}${list}`);
  }
  parts[PRESENTATION] = xml;
  const deck = await archive.withParts(parts);

  return {
    file,
    template,
    deck,
    layouts: layouts.map(({ master, name }) => ({ master, name })),
    colors: colors ?? new Map(),
    size: { cx, cy },
  };
}
