import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  Archive,
  MAX_XML_PART,
  MAX_XML_RATIO,
  MAX_XML_TOTAL,
  REL,
  relsPathOf,
  resolvePartPath,
} from '../src/archive';
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

describe('Archive inflate budget (honest headers)', () => {
  const MiB = 1024 ** 2;
  /** XML part of exactly `bytes` bytes – deflates about 1000:1, like a real zip bomb. */
  const xmlOf = (bytes: number) => '<a>' + 'x'.repeat(bytes - 7) + '</a>';
  /** Bytes that do not compress, to make an upload as large as a real deck with images. */
  const noise = (bytes: number) => {
    const out = new Uint8Array(bytes);
    for (let offset = 0; offset < bytes; offset += 65536) {
      crypto.getRandomValues(out.subarray(offset, offset + 65536));
    }
    return out;
  };
  async function deck(parts: Record<string, string | Uint8Array>): Promise<Uint8Array> {
    const zip = new JSZip();
    for (const [path, content] of Object.entries(parts)) zip.file(path, content);
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  it('refuses an XML part above the per-part cap even when its header is honest', async () => {
    const upload = await deck({ 'ppt/slides/slide1.xml': xmlOf(MAX_XML_PART + 1) });
    const archive = await Archive.open(upload);
    await expect(archive.readXml('ppt/slides/slide1.xml')).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('caps all XML of a small upload by its size, counting every part once', async () => {
    const upload = await deck({
      'ppt/slides/slide1.xml': xmlOf(5 * MiB),
      'ppt/slides/slide2.xml': xmlOf(5 * MiB),
    });
    expect(upload.byteLength * MAX_XML_RATIO).toBeLessThan(10 * MiB);
    const archive = await Archive.open(upload);
    await archive.readXml('ppt/slides/slide1.xml', { retain: false });
    // Reading the same part again does not spend the budget twice.
    await archive.readXml('ppt/slides/slide1.xml', { retain: false });
    await expect(archive.readXml('ppt/slides/slide2.xml')).rejects.toMatchObject({
      code: 'corrupt',
      message: 'The file unpacks to more data than Slider accepts.',
    });
  });

  it('caps all XML of one file, however large the upload is', async () => {
    const parts: Record<string, string | Uint8Array> = { 'ppt/media/image1.png': noise(MiB) };
    const count = Math.floor(MAX_XML_TOTAL / (9 * MiB)) + 1;
    for (let i = 1; i <= count; i++) parts[`ppt/slides/slide${i}.xml`] = xmlOf(9 * MiB);
    const upload = await deck(parts);
    expect(upload.byteLength * MAX_XML_RATIO).toBeGreaterThan(MAX_XML_TOTAL);
    const archive = await Archive.open(upload);
    for (let i = 1; i < count; i++) {
      await archive.readXml(`ppt/slides/slide${i}.xml`, { retain: false });
    }
    await expect(archive.readXml(`ppt/slides/slide${count}.xml`)).rejects.toMatchObject({
      code: 'corrupt',
    });
    // Parses ~64 MiB of XML; slow when the whole suite runs in parallel.
  }, 30_000);

  it('keeps reading a normal deck', async () => {
    const archive = await Archive.open(
      await deck({ 'ppt/slides/slide1.xml': xmlOf(2 * MiB), 'ppt/media/image1.png': noise(MiB) }),
    );
    expect((await archive.readXml('ppt/slides/slide1.xml'))?.name).toBe('a');
    expect((await archive.readBytes('ppt/media/image1.png'))?.byteLength).toBe(MiB);
  });

  it('does not keep the DOM of a part read with retain: false', async () => {
    const archive = await Archive.open(await deck({ 'ppt/slides/slide1.xml': '<a/>' }));
    const first = await archive.readXml('ppt/slides/slide1.xml', { retain: false });
    expect(await archive.readXml('ppt/slides/slide1.xml', { retain: false })).not.toBe(first);
    const kept = await archive.readXml('ppt/slides/slide1.xml');
    expect(await archive.readXml('ppt/slides/slide1.xml')).toBe(kept);
  });
});
