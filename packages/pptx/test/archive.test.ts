import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { Archive, MAX_XML_PART, REL, relsPathOf, resolvePartPath } from '../src/archive';
import { PptxError } from '../src/types';

describe('relsPathOf', () => {
  it('points at the _rels sibling of a part', () => {
    expect(relsPathOf('ppt/slides/slide1.xml')).toBe('ppt/slides/_rels/slide1.xml.rels');
    expect(relsPathOf('ppt/presentation.xml')).toBe('ppt/_rels/presentation.xml.rels');
  });

  it('uses the root _rels folder for parts at the top of the zip', () => {
    expect(relsPathOf('')).toBe('_rels/.rels');
    expect(relsPathOf('[Content_Types].xml')).toBe('_rels/[Content_Types].xml.rels');
  });
});

describe('resolvePartPath', () => {
  it('resolves targets relative to the folder of the owning part', () => {
    expect(resolvePartPath('ppt/slides/slide1.xml', '../media/image1.png')).toBe(
      'ppt/media/image1.png',
    );
    expect(resolvePartPath('ppt/presentation.xml', 'slides/slide1.xml')).toBe(
      'ppt/slides/slide1.xml',
    );
    expect(resolvePartPath('ppt/slides/slide1.xml', './slide2.xml')).toBe('ppt/slides/slide2.xml');
  });

  it('treats a leading slash as the zip root', () => {
    expect(resolvePartPath('ppt/slides/slide1.xml', '/ppt/x.xml')).toBe('ppt/x.xml');
  });

  it('ignores empty segments and stops at the root', () => {
    expect(resolvePartPath('ppt/slides/slide1.xml', '..//../../a.xml')).toBe('a.xml');
    expect(resolvePartPath('', 'ppt/presentation.xml')).toBe('ppt/presentation.xml');
  });
});

const rels = (entries: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;

async function zipOf(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('Archive', () => {
  const files = {
    'ppt/slides/slide1.xml': '﻿<p:sld><p:cSld name="Eins"/></p:sld>',
    'ppt/slides/_rels/slide1.xml.rels': rels(
      `<Relationship Id="rId1" Type="${REL.slideLayout}" Target="../slideLayouts/slideLayout1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL.image}" Target="../media/image1.png"/>` +
        `<Relationship Id="rId3" Type="${REL.image}" Target="https://example.com/a.png" TargetMode="External"/>`,
    ),
    'ppt/media/image1.png': 'png-bytes',
    'ppt/broken.xml': '<p:sld><p:cSld></p:sld>',
  };

  it('reads parts as bytes and XML, null when missing', async () => {
    const archive = await Archive.open(await zipOf(files));
    expect(archive.has('ppt/media/image1.png')).toBe(true);
    expect(archive.has('ppt/media/image2.png')).toBe(false);
    expect(
      new TextDecoder().decode((await archive.readBytes('ppt/media/image1.png')) ?? undefined),
    ).toBe('png-bytes');
    expect(await archive.readBytes('nope')).toBeNull();
    expect(await archive.readXml('nope.xml')).toBeNull();
  });

  it('strips a byte order mark and caches parsed parts', async () => {
    const archive = await Archive.open(await zipOf(files));
    const slide = await archive.readXml('ppt/slides/slide1.xml');
    expect(slide?.name).toBe('p:sld');
    expect(await archive.readXml('ppt/slides/slide1.xml')).toBe(slide);
  });

  it('reports invalid XML as corrupt', async () => {
    const archive = await Archive.open(await zipOf(files));
    await expect(archive.readXml('ppt/broken.xml')).rejects.toMatchObject({
      name: 'PptxError',
      code: 'corrupt',
    });
    await expect(archive.readXml('ppt/broken.xml')).rejects.toBeInstanceOf(PptxError);
  });

  it('resolves relationships and keeps external targets verbatim', async () => {
    const archive = await Archive.open(await zipOf(files));
    expect(await archive.relationships('ppt/slides/slide1.xml')).toEqual([
      {
        id: 'rId1',
        type: REL.slideLayout,
        target: 'ppt/slideLayouts/slideLayout1.xml',
        external: false,
      },
      { id: 'rId2', type: REL.image, target: 'ppt/media/image1.png', external: false },
      { id: 'rId3', type: REL.image, target: 'https://example.com/a.png', external: true },
    ]);
    expect(await archive.relationships('ppt/presentation.xml')).toEqual([]);
  });

  it('finds relationships by id and type, never external ones', async () => {
    const archive = await Archive.open(await zipOf(files));
    expect((await archive.relationshipById('ppt/slides/slide1.xml', 'rId2'))?.target).toBe(
      'ppt/media/image1.png',
    );
    expect(await archive.relationshipById('ppt/slides/slide1.xml', 'rId3')).toBeUndefined();
    expect(await archive.relationshipById('ppt/slides/slide1.xml', 'rId9')).toBeUndefined();
    const images = await archive.relationshipsOfType('ppt/slides/slide1.xml', REL.image);
    expect(images.map((rel) => rel.id)).toEqual(['rId2']);
  });

  it('accepts an ArrayBuffer', async () => {
    const buffer = new Uint8Array(await zipOf(files)).buffer;
    expect((await Archive.open(buffer)).has('ppt/slides/slide1.xml')).toBe(true);
  });

  it('rejects encrypted files and non-zips', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(Archive.open(ole)).rejects.toMatchObject({ code: 'encrypted' });
    await expect(Archive.open(new TextEncoder().encode('kein zip'))).rejects.toMatchObject({
      code: 'not_pptx',
    });
  });
});

/** Patches the uncompressed size of every entry in local and central headers (forged zip bomb). */
function forgeDeclaredSizes(zip: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(zip);
  const view = new DataView(out.buffer);
  for (let offset = 0; offset + 4 <= out.length; offset++) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) view.setUint32(offset + 22, size, true);
    else if (signature === 0x02014b50) view.setUint32(offset + 24, size, true);
  }
  return out;
}

describe('Archive zip-bomb budget', () => {
  async function bomb(path: string, bytes: number): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file(path, '<a>' + 'x'.repeat(bytes) + '</a>');
    const packed = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return forgeDeclaredSizes(packed, 1000);
  }

  it('stops inflating an XML part that unpacks to more than it declares', async () => {
    const archive = await Archive.open(await bomb('ppt/presentation.xml', 8 * 1024 ** 2));
    await expect(archive.readXml('ppt/presentation.xml')).rejects.toMatchObject({
      name: 'PptxError',
      code: 'corrupt',
    });
  });

  it('stops inflating a binary part that unpacks to more than it declares', async () => {
    const archive = await Archive.open(await bomb('ppt/media/image1.png', 8 * 1024 ** 2));
    await expect(archive.readBytes('ppt/media/image1.png')).rejects.toMatchObject({
      name: 'PptxError',
      code: 'corrupt',
    });
  });

  it('rejects a part that declares more than the per-part cap without inflating it', async () => {
    const zip = new JSZip();
    zip.file('ppt/presentation.xml', '<a/>');
    const packed = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const archive = await Archive.open(forgeDeclaredSizes(packed, MAX_XML_PART + 1));
    await expect(archive.readXml('ppt/presentation.xml')).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('rejects a part that unpacks to less than it declares', async () => {
    const zip = new JSZip();
    zip.file('ppt/presentation.xml', '<a>' + 'x'.repeat(100) + '</a>');
    const packed = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const archive = await Archive.open(forgeDeclaredSizes(packed, 5000));
    await expect(archive.readXml('ppt/presentation.xml')).rejects.toMatchObject({
      code: 'corrupt',
    });
  });
});
