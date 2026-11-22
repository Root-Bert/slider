import JSZip from 'jszip';
import type { WriterTemplate } from '@slider/shared';
import { ODT_MIME } from './archive';

/*
 * A new document: one A4 page, upright, Literata as its face (the server's LibreOffice and the
 * browser both have it), and the paragraph formats the editor offers – „Fließtext“, „Titel“,
 * „Überschrift 1–6“, „Zitat“ – as the file's own named styles, so every office program shows
 * and offers them under their usual names.
 */

export const NAMESPACES = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'office:version="1.3"',
].join(' ');

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
 <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODT_MIME}"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

export const DOCUMENT_FONT = 'Literata';
/** „Vorformatierter Text“: LibreOffice's own mono for Preformatted Text. */
const MONO_FONT = 'Liberation Mono';

/** The named paragraph styles of the editor's formats, as XML – also added to a file lacking one. */
export const NAMED_STYLES: Record<string, string> = {
  Standard: `<style:style style:name="Standard" style:family="paragraph" style:class="text"/>`,
  Text_20_body: `<style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard" style:class="text"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.3cm" fo:line-height="140%"/></style:style>`,
  Heading: `<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Text_20_body" style:class="text"><style:paragraph-properties fo:margin-top="0.5cm" fo:margin-bottom="0.2cm" fo:line-height="120%" fo:keep-with-next="always"/><style:text-properties fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"/></style:style>`,
  Title: `<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body" style:class="chapter"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.5cm" fo:line-height="115%"/><style:text-properties fo:font-size="28pt" style:font-size-asian="28pt" style:font-size-complex="28pt"/></style:style>`,
  Quotations: `<style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-left="1cm" fo:margin-right="1cm" fo:margin-top="0cm" fo:margin-bottom="0.3cm" fo:line-height="140%" fo:text-indent="0cm"/><style:text-properties fo:color="#4d4d4d" fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"/></style:style>`,
  Subtitle: `<style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Text_20_body" style:class="chapter"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.4cm" fo:line-height="120%" fo:keep-with-next="always"/><style:text-properties fo:font-size="15pt" style:font-size-asian="15pt" style:font-size-complex="15pt" fo:color="#595959"/></style:style>`,
  Preformatted_20_Text: `<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:line-height="130%"/><style:text-properties style:font-name="${MONO_FONT}" style:font-name-asian="${MONO_FONT}" style:font-name-complex="${MONO_FONT}" fo:font-size="10pt" style:font-size-asian="10pt" style:font-size-complex="10pt"/></style:style>`,
  Caption: `<style:style style:name="Caption" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:margin-top="0.1cm" fo:margin-bottom="0.3cm" fo:line-height="130%"/><style:text-properties fo:font-size="9pt" style:font-size-asian="9pt" style:font-size-complex="9pt" fo:color="#595959" fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"/></style:style>`,
  Header: `<style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="9pt" style:font-size-asian="9pt" style:font-size-complex="9pt"/></style:style>`,
  Footer: `<style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="9pt" style:font-size-asian="9pt" style:font-size-complex="9pt"/></style:style>`,
  ...Object.fromEntries(
    [20, 16, 13, 12, 11, 11].map((size, index) => {
      const level = index + 1;
      return [
        `Heading_20_${level}`,
        `<style:style style:name="Heading_20_${level}" style:display-name="Heading ${level}" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body" style:default-outline-level="${level}" style:class="text"><style:paragraph-properties fo:margin-top="${level === 1 ? '0.6' : '0.45'}cm" fo:margin-bottom="0.2cm"/><style:text-properties fo:font-size="${size}pt" style:font-size-asian="${size}pt" style:font-size-complex="${size}pt"${level > 4 ? ' fo:font-style="italic"' : ''}/></style:style>`,
      ];
    }),
  ),
};

/** The character style every link wears. */
export const LINK_STYLE = `<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text"><style:text-properties fo:color="#003399" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NAMESPACES}>
 <office:font-face-decls>
  <style:font-face style:name="${DOCUMENT_FONT}" svg:font-family="${DOCUMENT_FONT}" style:font-family-generic="roman" style:font-pitch="variable"/>
  <style:font-face style:name="${MONO_FONT}" svg:font-family="'${MONO_FONT}'" style:font-family-generic="modern" style:font-pitch="fixed"/>
 </office:font-face-decls>
 <office:styles>
  <style:default-style style:family="paragraph">
   <style:paragraph-properties fo:orphans="2" fo:widows="2" style:writing-mode="lr-tb" style:tab-stop-distance="1.25cm"/>
   <style:text-properties style:font-name="${DOCUMENT_FONT}" fo:font-size="11pt" style:font-name-asian="${DOCUMENT_FONT}" style:font-size-asian="11pt" style:font-name-complex="${DOCUMENT_FONT}" style:font-size-complex="11pt" fo:language="de" fo:country="DE" fo:color="#1a1a1a" style:letter-kerning="true" fo:hyphenate="false"/>
  </style:default-style>
  ${Object.values(NAMED_STYLES).join('\n  ')}
  ${LINK_STYLE}
 </office:styles>
 <office:automatic-styles>
  <style:page-layout style:name="Mpm1">
   <style:page-layout-properties fo:page-width="21.001cm" fo:page-height="29.7cm" style:num-format="1" style:print-orientation="portrait" fo:margin-top="2.5cm" fo:margin-bottom="2.5cm" fo:margin-left="2.5cm" fo:margin-right="2.5cm" style:writing-mode="lr-tb"/>
  </style:page-layout>
 </office:automatic-styles>
 <office:master-styles>
  <style:master-page style:name="Standard" style:page-layout-name="Mpm1"/>
 </office:master-styles>
</office:document-styles>`;

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Line = [style: 'Title' | 'Text_20_body' | `Heading_20_${1 | 2}`, text: string];

const heading = (style: Line[0]) => /^Heading_20_(\d)$/.exec(style)?.[1];

function paragraphs(lines: readonly Line[]): string {
  return lines
    .map(([style, text], index) => {
      const level = heading(style);
      const id = `xml:id="w${index + 1}"`;
      const body = escape(text);
      return level
        ? `<text:h ${id} text:style-name="${style}" text:outline-level="${level}">${body}</text:h>`
        : `<text:p ${id} text:style-name="${style}">${body}</text:p>`;
    })
    .join('\n   ');
}

/** What a new document starts with. `plain`: one paragraph to type in. */
const TEMPLATES: Record<WriterTemplate, (title: string) => Line[]> = {
  plain: () => [['Text_20_body', '']],
  letter: () => [
    ['Text_20_body', 'Absender, Straße, Ort'],
    ['Text_20_body', 'Empfänger\nStraße\nOrt'],
    ['Text_20_body', 'Ort, Datum'],
    ['Heading_20_2', 'Betreff'],
    ['Text_20_body', 'Guten Tag,'],
    ['Text_20_body', ''],
    ['Text_20_body', 'Freundliche Grüße'],
  ],
  report: (title) => [
    ['Title', title],
    ['Heading_20_1', 'Zusammenfassung'],
    ['Text_20_body', ''],
    ['Heading_20_1', 'Ausgangslage'],
    ['Text_20_body', ''],
    ['Heading_20_1', 'Ergebnisse'],
    ['Text_20_body', ''],
    ['Heading_20_1', 'Nächste Schritte'],
    ['Text_20_body', ''],
  ],
  minutes: (title) => [
    ['Title', title],
    ['Text_20_body', 'Datum, Ort, Teilnehmende'],
    ['Heading_20_1', 'Themen'],
    ['Text_20_body', ''],
    ['Heading_20_1', 'Beschlüsse'],
    ['Text_20_body', ''],
    ['Heading_20_1', 'Aufgaben'],
    ['Text_20_body', ''],
  ],
};

const content = (lines: readonly Line[]) => `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NAMESPACES}>
 <office:font-face-decls>
  <style:font-face style:name="${DOCUMENT_FONT}" svg:font-family="${DOCUMENT_FONT}" style:font-family-generic="roman" style:font-pitch="variable"/>
 </office:font-face-decls>
 <office:automatic-styles/>
 <office:body>
  <office:text>
   ${paragraphs(lines).replace(/\n(?=[^<])/g, '<text:line-break/>')}
  </office:text>
 </office:body>
</office:document-content>`;

const meta = (created: Date, title: string) => `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${NAMESPACES}>
 <office:meta>
  <meta:generator>Writer</meta:generator>
  <dc:title>${escape(title)}</dc:title>
  <meta:creation-date>${created.toISOString()}</meta:creation-date>
 </office:meta>
</office:document-meta>`;

/**
 * The bytes of a new document. `created` lands in meta.xml, so two new documents are never the
 * same file.
 */
export async function blankOdt(
  created: Date,
  {
    title = 'Neues Dokument',
    template = 'plain',
  }: { title?: string; template?: WriterTemplate } = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', ODT_MIME, { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', MANIFEST);
  zip.file('styles.xml', STYLES);
  zip.file('content.xml', content(TEMPLATES[template](title)));
  zip.file('meta.xml', meta(created, title));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: ODT_MIME });
}
