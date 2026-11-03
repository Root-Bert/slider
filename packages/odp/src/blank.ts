import JSZip from 'jszip';
import { ODP_MIME } from './archive';

/*
 * A new, empty presentation ("Neue Review" → start from scratch): one blank 16:9 slide on a
 * white master, Inter as the default face (the server's LibreOffice and the browser both have
 * it). Only what LibreOffice and `OdpDocument` need – the editor writes its own styles.
 */

const OFFICE_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'office:version="1.3"',
].join(' ');

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
 <manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${ODP_MIME}"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
 <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

/*
 * The deck's font is Inter. LibreOffice takes it from the common „standard“ graphic style, never
 * from the family default: without „standard“ it uses its own (Liberation Sans) under every
 * frame – so „standard“ names Inter too, with what LibreOffice's own sets besides (padding,
 * shapes filled and outlined, wrapping).
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${OFFICE_NS}>
 <office:font-face-decls>
  <style:font-face style:name="Inter" svg:font-family="Inter" style:font-family-generic="swiss" style:font-pitch="variable"/>
 </office:font-face-decls>
 <office:styles>
  <style:default-style style:family="graphic">
   <style:graphic-properties svg:stroke-color="#3465a4" draw:fill-color="#729fcf" fo:wrap-option="no-wrap"/>
   <style:paragraph-properties style:writing-mode="lr-tb"/>
   <style:text-properties style:font-name="Inter" fo:font-size="18pt" style:letter-kerning="true" fo:language="de" fo:country="DE" fo:color="#000000"/>
  </style:default-style>
  <style:style style:name="standard" style:family="graphic">
   <style:graphic-properties draw:stroke="solid" svg:stroke-color="#3465a4" draw:fill="solid" draw:fill-color="#729fcf" draw:textarea-horizontal-align="justify" fo:padding-top="0.125cm" fo:padding-bottom="0.125cm" fo:padding-left="0.25cm" fo:padding-right="0.25cm" fo:wrap-option="wrap" draw:shadow="hidden"/>
   <style:paragraph-properties fo:margin-left="0cm" fo:margin-right="0cm" fo:margin-top="0cm" fo:margin-bottom="0cm" fo:line-height="100%" fo:text-indent="0cm"/>
   <style:text-properties style:font-name="Inter" fo:font-size="18pt" style:letter-kerning="true"/>
  </style:style>
 </office:styles>
 <office:automatic-styles>
  <style:page-layout style:name="PM1">
   <style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="28cm" fo:page-height="15.75cm" style:print-orientation="landscape"/>
  </style:page-layout>
  <style:style style:name="Mdp1" style:family="drawing-page">
   <style:drawing-page-properties draw:background-size="full" draw:fill="solid" draw:fill-color="#ffffff"/>
  </style:style>
 </office:automatic-styles>
 <office:master-styles>
  <style:master-page style:name="Default" style:page-layout-name="PM1" draw:style-name="Mdp1"/>
 </office:master-styles>
</office:document-styles>`;

const CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${OFFICE_NS}>
 <office:automatic-styles>
  <style:style style:name="dp1" style:family="drawing-page">
   <style:drawing-page-properties presentation:display-header="false" presentation:display-footer="false" presentation:display-page-number="false" presentation:display-date-time="false"/>
  </style:style>
 </office:automatic-styles>
 <office:body>
  <office:presentation>
   <draw:page draw:name="Folie 1" draw:style-name="dp1" draw:master-page-name="Default" presentation:presentation-page-layout-name="AL1T19"/>
  </office:presentation>
 </office:body>
</office:document-content>`;

const meta = (created: Date) => `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${OFFICE_NS}>
 <office:meta>
  <meta:generator>Slider</meta:generator>
  <meta:creation-date>${created.toISOString()}</meta:creation-date>
 </office:meta>
</office:document-meta>`;

/**
 * The bytes of an empty presentation. `created` lands in meta.xml, so two new decks are never
 * the same file (uploads of a file seen before open that review instead).
 */
export async function blankOdp(created: Date): Promise<Uint8Array> {
  const zip = new JSZip();
  // ODF: `mimetype` first and stored, so `isOdpBytes` finds it at its fixed offset.
  zip.file('mimetype', ODP_MIME, { compression: 'STORE' });
  zip.file('META-INF/manifest.xml', MANIFEST);
  zip.file('styles.xml', STYLES);
  zip.file('content.xml', CONTENT);
  zip.file('meta.xml', meta(created));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: ODP_MIME });
}
