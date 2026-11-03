import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { SlideOperation } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { OdpDocument, revertChange } from '../src';

const DEMO = new Uint8Array(readFileSync(new URL('./fixtures/demo.odp', import.meta.url)));

/** A deck's file after `operations`, open with its page ids – a step of its history. */
async function step(from: Uint8Array, operations: SlideOperation[]): Promise<Uint8Array> {
  const document = await OdpDocument.open(from);
  document.ensureIds();
  document.apply(operations);
  return document.toBytes();
}

const open = async (bytes: Uint8Array) => {
  const document = await OdpDocument.open(bytes);
  document.ensureIds();
  return document;
};

/** Takes back the change `before` → `after` in `now`; the document afterwards and the outcome. */
async function revert(before: Uint8Array, after: Uint8Array, now: Uint8Array) {
  const document = await open(now);
  const outcome = await revertChange(document, await open(before), await open(after));
  return { document: await open(await document.toBytes()), outcome };
}

const named = (document: OdpDocument, name: string) => {
  const found = document
    .slides()
    .flatMap((slide) => slide.elements)
    .find((element) => element.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

const textOf = (document: OdpDocument, slide: number, role: string) =>
  document.slides()[slide]?.elements.find((element) => element.role === role)?.paragraphs;

describe('taking one change back while others went on', () => {
  it('moves back what I moved, keeping what others typed, and leaves what someone changed the same way since', async () => {
    const base = await open(DEMO);
    const note = named(base, 'Hinweis');
    const title = base.slides()[2]?.elements.find((element) => element.role === 'title');
    const box = { ...note.bbox, x: 0.05, y: 0.05 };
    const start = await base.toBytes();
    const mine = await step(start, [{ type: 'setBox', elementId: note.id, box }]);
    const theirs = await step(mine, [
      { type: 'setText', elementId: title!.id, paragraphs: ['Von jemand anderem'] },
    ]);
    const { document, outcome } = await revert(start, mine, theirs);
    expect(outcome).toEqual({ changed: true, conflicts: 0 });
    expect(named(document, 'Hinweis').bbox.x).toBeCloseTo(note.bbox.x, 3);
    expect(textOf(document, 2, 'title')).toEqual(['Von jemand anderem']);
    // Leaves a thing someone changed the same way since, and counts it.
    {
      const base = await open(DEMO);
      const note = named(base, 'Hinweis');
      const start = await base.toBytes();
      const mine = await step(start, [
        { type: 'setBox', elementId: note.id, box: { ...note.bbox, x: 0.05 } },
      ]);
      const theirs = await step(mine, [
        { type: 'setBox', elementId: note.id, box: { ...note.bbox, x: 0.3 } },
      ]);
      const { document, outcome } = await revert(start, mine, theirs);
      expect(outcome).toEqual({ changed: false, conflicts: 1 });
      expect(named(document, 'Hinweis').bbox.x).toBeCloseTo(0.3, 3);
    }
  });

  it('brings removed and deleted slides back where they belong with their own ids, removing added ones unless worked on', async () => {
    const base = await open(DEMO);
    const [first, second, third] = base.pageIds();
    const start = await base.toBytes();
    const mine = await step(start, [{ type: 'deleteSlide', pageId: third! }]);
    // Someone adds a slide at the start and moves the second to the front.
    const theirs = await step(mine, [
      { type: 'addSlide', like: first!, newPageId: 'slneuevorne', after: null },
      { type: 'moveSlide', pageId: second!, after: null },
    ]);
    const { document, outcome } = await revert(start, mine, theirs);
    expect(outcome.conflicts).toBe(0);
    const ids = document.pageIds();
    // After the one before it then – the second, now in front.
    expect(ids.slice(0, 4)).toEqual([second, third, 'slneuevorne', first]);
    // As it was, and drawn with its styles and pictures.
    expect(document.slides()[1]?.elements.map((element) => element.name)).toEqual(
      base.slides()[2]?.elements.map((element) => element.name),
    );
    // Removes a slide I added, unless someone worked on it since.
    {
      const base = await open(DEMO);
      const [first] = base.pageIds();
      const start = await base.toBytes();
      const mine = await step(start, [
        { type: 'duplicateSlide', pageId: first!, newPageId: 'slkopie', after: first! },
      ]);
      const untouched = await revert(start, mine, mine);
      expect(untouched.document.pageIds()).toEqual(base.pageIds());

      const copy = (await open(mine)).slides()[1]!;
      const title = copy.elements.find((element) => (element.paragraphs?.length ?? 0) > 0)!;
      const theirs = await step(mine, [
        { type: 'setText', elementId: title.id, paragraphs: ['Weitergeschrieben'] },
      ]);
      const kept = await revert(start, mine, theirs);
      expect(kept.outcome).toEqual({ changed: false, conflicts: 1 });
      expect(kept.document.pageIds()).toContain('slkopie');
    }
    // Brings a deleted slide back with its own ids, though copies were made since.
    {
      const base = await open(DEMO);
      const [first, , third] = base.pageIds();
      const start = await base.toBytes();
      const mine = await step(start, [{ type: 'deleteSlide', pageId: third! }]);
      // Copies made since – the editor's (its page id its own) and one the server names (the
      // AI's): none of their ids may be one the deleted slide had, or it would lose that id.
      const copied = await open(
        await step(mine, [
          { type: 'duplicateSlide', pageId: first!, newPageId: 'slkopie', after: first! },
        ]),
      );
      copied.duplicateSlide(0);
      const theirs = await copied.toBytes();
      const { document, outcome } = await revert(start, mine, theirs);
      expect(outcome).toEqual({ changed: true, conflicts: 0 });
      const back = document.slides().find((slide) => slide.pageId === third);
      expect(back?.elements.map((element) => element.id)).toEqual(
        base.slides()[2]!.elements.map((element) => element.id),
      );
      const content = await (
        await JSZip.loadAsync(await document.toBytes())
      )
        .file('content.xml')!
        .async('string');
      const ids = [...content.matchAll(/xml:id="([^"]+)"/g)].map((match) => match[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('puts a moved slide back, redoes by taking the undo back, and leaves one someone moved since', async () => {
    const base = await open(DEMO);
    const [first, second, third] = base.pageIds();
    const start = await base.toBytes();
    const mine = await step(start, [{ type: 'moveSlide', pageId: first!, after: third! }]);
    expect((await open(mine)).pageIds().slice(0, 3)).toEqual([second, third, first]);
    const undone = await revert(start, mine, mine);
    expect(undone.document.pageIds()).toEqual(base.pageIds());
    const undoneBytes = await undone.document.toBytes();
    const redone = await revert(mine, undoneBytes, undoneBytes);
    expect(redone.document.pageIds().slice(0, 3)).toEqual([second, third, first]);
    // Leaves a slide I moved where someone moved it since, and counts it.
    {
      const base = await open(DEMO);
      const [first, second, third] = base.pageIds();
      const start = await base.toBytes();
      const mine = await step(start, [{ type: 'moveSlide', pageId: first!, after: third! }]);
      const last = (await open(mine)).pageIds().at(-1)!;
      // Someone else takes it on to the end: their place for it wins over the undo's.
      const theirs = await step(mine, [{ type: 'moveSlide', pageId: first!, after: last }]);
      const { document, outcome } = await revert(start, mine, theirs);
      expect(outcome).toEqual({ changed: false, conflicts: 1 });
      expect(document.pageIds().slice(0, 2)).toEqual([second, third]);
      expect(document.pageIds().at(-1)).toBe(first);
    }
  });

  it('brings back the styles, pictures and what the styles name of a slide coming back', async () => {
    const plain = await (await open(DEMO)).toBytes();
    // Before: slide 2 has a frame with a graphic style and a paragraph style of content.xml,
    // and a picture whose name needs an entity in the XML. styles.xml's automatic styles (the
    // masters') have a paragraph style of the same name – another style.
    const before = await withParts(plain, {
      frameOn: 1,
      frame: `<draw:frame xml:id="kyframe" draw:name="Familien" draw:style-name="KyStyle" svg:x="1cm" svg:y="1cm" svg:width="5cm" svg:height="3cm"><draw:text-box><text:p text:style-name="KyStyle">Text</text:p></draw:text-box></draw:frame><draw:frame xml:id="kyphoto" draw:name="Foto" svg:x="7cm" svg:y="1cm" svg:width="5cm" svg:height="3cm"><draw:image xlink:href="Pictures/ky&amp;foto.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`,
      content: `${KY_GRAPHIC}${KY_PARAGRAPH}`,
      masters: KY_MASTER_PARAGRAPH,
      picture: 'Pictures/ky&foto.png',
    });
    // After: the frames went, and their styles with them – but content.xml has a text style of
    // that name now, and the masters' paragraph style is still there.
    const after = await withParts(plain, { content: KY_TEXT, masters: KY_MASTER_PARAGRAPH });
    const { document, outcome } = await revert(before, after, after);
    expect(outcome).toEqual({ changed: true, conflicts: 0 });
    const zip = await JSZip.loadAsync(await document.toBytes());
    const content = await zip.file('content.xml')!.async('string');
    const styles = await zip.file('styles.xml')!.async('string');
    // The slide's own two, from content.xml – not the masters' paragraph style; the text style
    // of the same name stays as it is.
    for (const style of [KY_GRAPHIC, KY_PARAGRAPH, KY_TEXT]) expect(content).toContain(style);
    expect(content).not.toContain('7.77cm');
    expect(styles.split('style:name="KyStyle"')).toHaveLength(2);
    expect(await document.picture('Pictures/ky&foto.png')).not.toBeNull();
    // Brings back the pictures a slide coming back shows, gone from the file with it.
    {
      const base = await open(DEMO);
      const pageId = base.pageIds()[3]!;
      const shown = (await base.pictures()).filter((picture) => picture.usedBy.includes('slide 4'));
      const start = await base.toBytes();
      expect(shown.length).toBeGreaterThan(0);
      const mine = await step(start, [{ type: 'deleteSlide', pageId }]);
      for (const picture of shown)
        expect(await (await open(mine)).picture(picture.path)).toBeNull();
      const { document } = await revert(start, mine, mine);
      expect(document.pageIds()).toEqual(base.pageIds());
      for (const picture of shown) expect(await document.picture(picture.path)).not.toBeNull();
    }
    // Brings back what the styles of a slide coming back name in turn, gone from the file with it.
    {
      const base = await open(DEMO);
      const pageId = base.pageIds()[1]!;
      const plain = await base.toBytes();
      // Before: slide 2 has a frame whose style and paragraphs name styles of their own, which
      // name others in turn – a parent of a parent, a gradient, a fill picture, a dash pattern, a
      // list style and its bullets' text style. The change took the frame away, and a save
      // without it dropped them all (as LibreOffice drops what nothing names).
      const before = await withSlideStyles(plain, 1);
      const { document, outcome } = await revert(before, plain, plain);
      expect(outcome).toEqual({ changed: true, conflicts: 0 });
      expect(document.pageIds()[1]).toBe(pageId);
      expect(document.slides()[1]!.elements.some((element) => element.id === 'rvframe')).toBe(true);
      const names = Object.keys(SLIDE_STYLES).concat(Object.keys(COMMON_STYLES));
      expect(document.stylesXml(names).missing).toEqual([]);
      expect(await document.picture('Pictures/rvfill.png')).not.toBeNull();

      // Automatic ones among content.xml's automatic styles, common ones – parents must be – among
      // styles.xml's; what the deck had all along (`standard`) is not copied again.
      const zip = await JSZip.loadAsync(await document.toBytes());
      const content = await zip.file('content.xml')!.async('string');
      const styles = await zip.file('styles.xml')!.async('string');
      const manifest = await zip.file('META-INF/manifest.xml')!.async('string');
      for (const name of Object.keys(SLIDE_STYLES)) expect(content).toContain(`"${name}"`);
      for (const name of Object.keys(COMMON_STYLES)) {
        expect(styles).toContain(`="${name}"`);
        expect(content).not.toContain(`style:name="${name}"`);
      }
      const plainStyles = await (await JSZip.loadAsync(plain)).file('styles.xml')!.async('string');
      const standard = /style:name="standard"/g;
      expect(styles.match(standard)).toEqual(plainStyles.match(standard));
      expect(manifest).toContain('Pictures/rvfill.png');
    }
  });
});

/** content.xml's automatic styles of the frame {@link withSlideStyles} puts on a slide. */
const SLIDE_STYLES: Record<string, string> = {
  RvShape:
    '<style:style style:name="RvShape" style:family="graphic" style:parent-style-name="RvParent"/>',
  RvPara:
    '<style:style style:name="RvPara" style:family="paragraph" style:list-style-name="RvList"><style:paragraph-properties fo:margin-left="0cm"/></style:style>',
};

/** … and the common styles of styles.xml they name, directly or through each other. */
const COMMON_STYLES: Record<string, string> = {
  RvParent:
    '<style:style style:name="RvParent" style:family="graphic" style:parent-style-name="RvGrand"><style:graphic-properties draw:fill="gradient" draw:fill-gradient-name="RvGradient"/></style:style>',
  RvGrand:
    '<style:style style:name="RvGrand" style:family="graphic" style:parent-style-name="standard"><style:graphic-properties draw:fill-image-name="RvFill" draw:stroke="dash" draw:stroke-dash="RvDash"/></style:style>',
  RvGradient:
    '<draw:gradient draw:name="RvGradient" draw:style="linear" draw:start-color="#ff0000" draw:end-color="#0000ff" draw:angle="0" draw:border="0%"/>',
  RvFill:
    '<draw:fill-image draw:name="RvFill" xlink:href="Pictures/rvfill.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>',
  RvDash:
    '<draw:stroke-dash draw:name="RvDash" draw:style="rect" draw:dots1="1" draw:dots1-length="0.2cm" draw:distance="0.1cm"/>',
  RvList:
    '<text:list-style style:name="RvList"><text:list-level-style-bullet text:level="1" text:style-name="RvBullet" text:bullet-char="•"/></text:list-style>',
  RvBullet:
    '<style:style style:name="RvBullet" style:family="text"><style:text-properties fo:color="#ff0000"/></style:style>',
};

/**
 * The file with a frame on slide `index` (0-based) that names {@link SLIDE_STYLES}, those and
 * {@link COMMON_STYLES} added, and the fill picture in the package.
 */
async function withSlideStyles(bytes: Uint8Array, index: number): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const frame =
    '<draw:frame xml:id="rvframe" draw:name="Mit Stilen" draw:style-name="RvShape" svg:x="1cm" svg:y="1cm" svg:width="5cm" svg:height="3cm"><draw:text-box><text:list text:style-name="RvList"><text:list-item><text:p text:style-name="RvPara">Punkt</text:p></text:list-item></text:list></draw:text-box></draw:frame>';
  let content = await zip.file('content.xml')!.async('string');
  content = content.replace(
    '</office:automatic-styles>',
    `${Object.values(SLIDE_STYLES).join('')}</office:automatic-styles>`,
  );
  let at = -1;
  for (let n = 0; n <= index; n += 1) at = content.indexOf('</draw:page>', at + 1);
  content = `${content.slice(0, at)}${frame}${content.slice(at)}`;
  const styles = (await zip.file('styles.xml')!.async('string')).replace(
    '</office:styles>',
    `${Object.values(COMMON_STYLES).join('')}</office:styles>`,
  );
  const manifest = (await zip.file('META-INF/manifest.xml')!.async('string')).replace(
    '</manifest:manifest>',
    '<manifest:file-entry manifest:full-path="Pictures/rvfill.png" manifest:media-type="image/png"/></manifest:manifest>',
  );
  zip.file('content.xml', content);
  zip.file('styles.xml', styles);
  zip.file('META-INF/manifest.xml', manifest);
  zip.file('Pictures/rvfill.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]));
  return zip.generateAsync({ type: 'uint8array' });
}

const KY_GRAPHIC =
  '<style:style style:name="KyStyle" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#00ff00"/></style:style>';
const KY_PARAGRAPH =
  '<style:style style:name="KyStyle" style:family="paragraph"><style:paragraph-properties fo:margin-left="0.5cm"/></style:style>';
const KY_TEXT =
  '<style:style style:name="KyStyle" style:family="text"><style:text-properties fo:color="#0000ff"/></style:style>';
const KY_MASTER_PARAGRAPH =
  '<style:style style:name="KyStyle" style:family="paragraph"><style:paragraph-properties fo:margin-left="7.77cm"/></style:style>';

/**
 * The file with `frame` on slide `frameOn` (0-based), `content` among content.xml's automatic
 * styles, `masters` among styles.xml's, and a picture at `picture` in the package.
 */
async function withParts(
  bytes: Uint8Array,
  parts: { frameOn?: number; frame?: string; content?: string; masters?: string; picture?: string },
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  let content = await zip.file('content.xml')!.async('string');
  let styles = await zip.file('styles.xml')!.async('string');
  const into = (xml: string, end: string, more: string) => {
    expect(xml).toContain(end);
    return xml.replace(end, `${more}${end}`);
  };
  if (parts.content) content = into(content, '</office:automatic-styles>', parts.content);
  if (parts.masters) styles = into(styles, '</office:automatic-styles>', parts.masters);
  if (parts.frame !== undefined && parts.frameOn !== undefined) {
    let at = -1;
    for (let n = 0; n <= parts.frameOn; n += 1) at = content.indexOf('</draw:page>', at + 1);
    content = `${content.slice(0, at)}${parts.frame}${content.slice(at)}`;
  }
  if (parts.picture) {
    const manifest = await zip.file('META-INF/manifest.xml')!.async('string');
    zip.file(
      'META-INF/manifest.xml',
      manifest.replace(
        '</manifest:manifest>',
        `<manifest:file-entry manifest:full-path="${parts.picture.replace('&', '&amp;')}" manifest:media-type="image/png"/></manifest:manifest>`,
      ),
    );
    zip.file(parts.picture, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]));
  }
  zip.file('content.xml', content);
  zip.file('styles.xml', styles);
  return zip.generateAsync({ type: 'uint8array' });
}
