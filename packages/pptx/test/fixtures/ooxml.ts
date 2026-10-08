/**
 * Static OOXML parts for the fixture builder: theme, slide master, layouts and package
 * boilerplate. They follow what PowerPoint itself writes for a blank 16:9 deck, trimmed to the
 * elements PowerPoint and LibreOffice require.
 */

export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
  p15: 'http://schemas.microsoft.com/office/powerpoint/2012/main',
  p188: 'http://schemas.microsoft.com/office/powerpoint/2018/8/main',
  pc: 'http://schemas.microsoft.com/office/powerpoint/2013/main/command',
  ac: 'http://schemas.microsoft.com/office/drawing/2013/main/command',
  relationships: 'http://schemas.openxmlformats.org/package/2006/relationships',
  contentTypes: 'http://schemas.openxmlformats.org/package/2006/content-types',
} as const;

/** `xmlns:a`, `xmlns:r`, `xmlns:p` – declared on every PresentationML root. */
export const PML_NAMESPACES = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const OFFICE_RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const REL_TYPES = {
  officeDocument: `${OFFICE_RELS}/officeDocument`,
  coreProperties:
    'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extendedProperties: `${OFFICE_RELS}/extended-properties`,
  slide: `${OFFICE_RELS}/slide`,
  slideLayout: `${OFFICE_RELS}/slideLayout`,
  slideMaster: `${OFFICE_RELS}/slideMaster`,
  theme: `${OFFICE_RELS}/theme`,
  image: `${OFFICE_RELS}/image`,
  presProps: `${OFFICE_RELS}/presProps`,
  viewProps: `${OFFICE_RELS}/viewProps`,
  tableStyles: `${OFFICE_RELS}/tableStyles`,
  legacyComments: `${OFFICE_RELS}/comments`,
  commentAuthors: `${OFFICE_RELS}/commentAuthors`,
  modernComments: 'http://schemas.microsoft.com/office/2018/10/relationships/comments',
  authors: 'http://schemas.microsoft.com/office/2018/10/relationships/authors',
} as const;

const PML = 'application/vnd.openxmlformats-officedocument.presentationml';

export const CONTENT_TYPES = {
  presentation: `${PML}.presentation.main+xml`,
  slide: `${PML}.slide+xml`,
  slideLayout: `${PML}.slideLayout+xml`,
  slideMaster: `${PML}.slideMaster+xml`,
  presProps: `${PML}.presProps+xml`,
  viewProps: `${PML}.viewProps+xml`,
  tableStyles: `${PML}.tableStyles+xml`,
  legacyComments: `${PML}.comments+xml`,
  commentAuthors: `${PML}.commentAuthors+xml`,
  modernComments: 'application/vnd.ms-powerpoint.comments+xml',
  authors: 'application/vnd.ms-powerpoint.authors+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  coreProperties: 'application/vnd.openxmlformats-package.core-properties+xml',
  extendedProperties: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
} as const;

export interface Relationship {
  id: string;
  type: string;
  target: string;
}

export function relationshipsXml(relationships: Relationship[]): string {
  const items = relationships
    .map(
      (rel) =>
        `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${escapeXml(rel.target)}"/>`,
    )
    .join('');
  return `${XML_DECLARATION}<Relationships xmlns="${NS.relationships}">${items}</Relationships>`;
}

export function contentTypesXml(overrides: { partName: string; contentType: string }[]): string {
  const items = overrides
    .map((item) => `<Override PartName="/${item.partName}" ContentType="${item.contentType}"/>`)
    .join('');
  return (
    `${XML_DECLARATION}<Types xmlns="${NS.contentTypes}">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    `${items}</Types>`
  );
}

// --- Shape helpers shared by masters, layouts and slides -------------------------------------

export interface EmuBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const xfrmXml = (box: EmuBox, tag = 'a:xfrm'): string =>
  `<${tag}><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.w}" cy="${box.h}"/></${tag}>`;

/** The non-visual header every `p:spTree` starts with. */
export const SP_TREE_HEADER =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

interface PlaceholderTemplate {
  id: number;
  name: string;
  ph: string;
  box?: EmuBox;
  lstStyle?: string;
  bodyPr?: string;
  prompt: string;
}

function placeholderXml(template: PlaceholderTemplate): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${template.id}" name="${template.name}"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${template.ph}</p:nvPr></p:nvSpPr>` +
    `<p:spPr>${template.box ? `${xfrmXml(template.box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` : ''}</p:spPr>` +
    `<p:txBody>${template.bodyPr ?? '<a:bodyPr/>'}<a:lstStyle>${template.lstStyle ?? ''}</a:lstStyle>` +
    `<a:p><a:r><a:rPr lang="en-US"/><a:t>${template.prompt}</a:t></a:r></a:p></p:txBody></p:sp>`
  );
}

// --- Theme -------------------------------------------------------------------------------------

const THEME_COLORS: [slot: string, hex: string][] = [
  ['lt2', 'F1F5F9'],
  ['accent1', '2563EB'],
  ['accent2', '0EA5E9'],
  ['accent3', '10B981'],
  ['accent4', 'F59E0B'],
  ['accent5', 'EF4444'],
  ['accent6', '8B5CF6'],
  ['hlink', '2563EB'],
  ['folHlink', '7C3AED'],
];

const solidSchemeFill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const plainLine = (w: number) =>
  `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solidSchemeFill}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;

export const THEME_XML =
  `${XML_DECLARATION}<a:theme xmlns:a="${NS.a}" name="Slider"><a:themeElements>` +
  '<a:clrScheme name="Slider">' +
  '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
  '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="0F172A"/></a:dk2>' +
  THEME_COLORS.map(([slot, hex]) => `<a:${slot}><a:srgbClr val="${hex}"/></a:${slot}>`).join('') +
  '</a:clrScheme>' +
  '<a:fontScheme name="Slider">' +
  '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>' +
  '</a:fontScheme>' +
  '<a:fmtScheme name="Slider">' +
  `<a:fillStyleLst>${solidSchemeFill.repeat(3)}</a:fillStyleLst>` +
  `<a:lnStyleLst>${plainLine(6350)}${plainLine(12700)}${plainLine(19050)}</a:lnStyleLst>` +
  `<a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst>` +
  `<a:bgFillStyleLst>${solidSchemeFill.repeat(3)}</a:bgFillStyleLst>` +
  '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';

// --- Slide master --------------------------------------------------------------------------------

/** Master placeholder positions (PowerPoint's defaults for 16:9). */
export const MASTER_TITLE_BOX: EmuBox = { x: 838200, y: 365125, w: 10515600, h: 1325563 };
export const MASTER_BODY_BOX: EmuBox = { x: 838200, y: 1825625, w: 10515600, h: 4351338 };
export const MASTER_TITLE_SIZE_PT = 44;
export const MASTER_BODY_SIZE_PT = 28;

const textStyleLevel = (attributes: string, bullet: string, sizePt: number, font: string) =>
  `<a:lvl1pPr ${attributes}>${bullet}<a:defRPr sz="${sizePt * 100}" kern="1200">` +
  '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' +
  `<a:latin typeface="${font}"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>`;

export function slideMasterXml(layoutRelIds: string[]): string {
  const layoutIds = layoutRelIds
    .map((relId, index) => `<p:sldLayoutId id="${2147483649 + index}" r:id="${relId}"/>`)
    .join('');
  return (
    `${XML_DECLARATION}<p:sldMaster ${PML_NAMESPACES}><p:cSld>` +
    '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
    `<p:spTree>${SP_TREE_HEADER}` +
    placeholderXml({
      id: 2,
      name: 'Title Placeholder 1',
      ph: '<p:ph type="title"/>',
      box: MASTER_TITLE_BOX,
      bodyPr:
        '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"><a:normAutofit/></a:bodyPr>',
      prompt: 'Click to edit Master title style',
    }) +
    placeholderXml({
      id: 3,
      name: 'Text Placeholder 2',
      ph: '<p:ph type="body" idx="1"/>',
      box: MASTER_BODY_BOX,
      bodyPr:
        '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"><a:normAutofit/></a:bodyPr>',
      prompt: 'Click to edit Master text styles',
    }) +
    '</p:spTree></p:cSld>' +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    `<p:sldLayoutIdLst>${layoutIds}</p:sldLayoutIdLst>` +
    '<p:txStyles>' +
    `<p:titleStyle>${textStyleLevel('algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"', '<a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/>', MASTER_TITLE_SIZE_PT, '+mj-lt')}</p:titleStyle>` +
    `<p:bodyStyle>${textStyleLevel('marL="228600" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"', '<a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPts val="1000"/></a:spcBef><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>', MASTER_BODY_SIZE_PT, '+mn-lt')}</p:bodyStyle>` +
    `<p:otherStyle>${textStyleLevel('marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"', '', 18, '+mn-lt')}</p:otherStyle>` +
    '</p:txStyles></p:sldMaster>'
  );
}

// --- Slide layouts -------------------------------------------------------------------------------

export type LayoutKind = 'title' | 'content';

export const LAYOUT_NAMES: Record<LayoutKind, string> = {
  title: 'Title Slide',
  content: 'Title and Content',
};

/** The title layout positions its placeholders itself; the content layout inherits the master's. */
export const TITLE_LAYOUT_TITLE_BOX: EmuBox = { x: 1524000, y: 1122363, w: 9144000, h: 2387600 };
export const TITLE_LAYOUT_SUBTITLE_BOX: EmuBox = { x: 1524000, y: 3602038, w: 9144000, h: 1655762 };
export const TITLE_LAYOUT_TITLE_SIZE_PT = 60;
export const TITLE_LAYOUT_SUBTITLE_SIZE_PT = 24;

const centredLevel = (sizePt: number) =>
  `<a:lvl1pPr marL="0" indent="0" algn="ctr"><a:buNone/><a:defRPr sz="${sizePt * 100}"/></a:lvl1pPr>`;

export function slideLayoutXml(kind: LayoutKind): string {
  const placeholders =
    kind === 'title'
      ? placeholderXml({
          id: 2,
          name: 'Title 1',
          ph: '<p:ph type="ctrTitle"/>',
          box: TITLE_LAYOUT_TITLE_BOX,
          bodyPr: '<a:bodyPr anchor="b"/>',
          lstStyle: centredLevel(TITLE_LAYOUT_TITLE_SIZE_PT),
          prompt: 'Click to edit Master title style',
        }) +
        placeholderXml({
          id: 3,
          name: 'Subtitle 2',
          ph: '<p:ph type="subTitle" idx="1"/>',
          box: TITLE_LAYOUT_SUBTITLE_BOX,
          lstStyle: centredLevel(TITLE_LAYOUT_SUBTITLE_SIZE_PT),
          prompt: 'Click to edit Master subtitle style',
        })
      : placeholderXml({
          id: 2,
          name: 'Title 1',
          ph: '<p:ph type="title"/>',
          prompt: 'Click to edit Master title style',
        }) +
        placeholderXml({
          id: 3,
          name: 'Content Placeholder 2',
          ph: '<p:ph idx="1"/>',
          prompt: 'Click to edit Master text styles',
        });

  return (
    `${XML_DECLARATION}<p:sldLayout ${PML_NAMESPACES} type="${kind === 'title' ? 'title' : 'obj'}" preserve="1">` +
    `<p:cSld name="${LAYOUT_NAMES[kind]}"><p:spTree>${SP_TREE_HEADER}${placeholders}</p:spTree></p:cSld>` +
    '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>'
  );
}

// --- Package-level properties --------------------------------------------------------------------

export const PRES_PROPS_XML = `${XML_DECLARATION}<p:presentationPr ${PML_NAMESPACES}/>`;

export const VIEW_PROPS_XML =
  `${XML_DECLARATION}<p:viewPr ${PML_NAMESPACES}>` +
  '<p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>' +
  '<p:gridSpacing cx="72008" cy="72008"/></p:viewPr>';

export const TABLE_STYLES_XML = `${XML_DECLARATION}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`;

export function corePropertiesXml(title: string, created: string): string {
  return (
    `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(title)}</dc:title><dc:creator>Slider</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>` +
    '</cp:coreProperties>'
  );
}

export function extendedPropertiesXml(slideCount: number): string {
  return (
    `${XML_DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ` +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    `<Application>Microsoft Office PowerPoint</Application><Slides>${slideCount}</Slides>` +
    '<PresentationFormat>Widescreen</PresentationFormat></Properties>'
  );
}
