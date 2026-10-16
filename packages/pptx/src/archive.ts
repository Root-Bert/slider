import JSZip from 'jszip';
import { PptxError } from './types';
import { attr, children, parseXml, XmlSyntaxError, type XmlElement } from './xml';

/** Compound File Binary signature – Office stores password-protected OOXML files this way. */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Inflated size caps – a small upload must not unpack into gigabytes (zip bomb). The declared
 * sizes come from the file itself, so they are only trusted together with `inflate`, which stops
 * as soon as an entry produces more bytes than it declared (or than its cap).
 */
const MAX_TOTAL_UNCOMPRESSED = 2 * 1024 ** 3;
export const MAX_XML_PART = 100 * 1024 ** 2;
export const MAX_BINARY_PART = 300 * 1024 ** 2;

/** Size the zip's central directory declares for an entry (JSZip keeps it internally). */
const declaredSize = (entry: JSZip.JSZipObject): number =>
  (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;

interface JSZipStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): JSZipStream;
  on(event: 'error', listener: (error: Error) => void): JSZipStream;
  on(event: 'end', listener: () => void): JSZipStream;
  pause(): JSZipStream;
  resume(): JSZipStream;
}

/**
 * Inflates one entry with a hard byte budget: at most its declared size and at most `cap`.
 * The stream is stopped the moment the budget is passed, so a forged size header can never make
 * us inflate more than the declared total (zip bomb with patched headers).
 */
function inflate(path: string, entry: JSZip.JSZipObject, cap: number): Promise<Uint8Array> {
  const declared = declaredSize(entry);
  if (declared > cap) {
    return Promise.reject(new PptxError('corrupt', `${path} is too large.`));
  }
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(new PptxError('corrupt', message));
    };
    // `internalStream` is public JSZip API (3.x) but missing from its type definitions.
    const stream = (
      entry as unknown as { internalStream(type: 'uint8array'): JSZipStream }
    ).internalStream('uint8array');
    stream
      .on('data', (chunk: Uint8Array) => {
        if (settled) return;
        length += chunk.length;
        if (length > declared) {
          stream.pause();
          fail(`${path} unpacks to more data than the file declares.`);
          return;
        }
        chunks.push(chunk);
      })
      .on('error', (error: Error) => fail(`${path} cannot be unpacked: ${error.message}`))
      .on('end', () => {
        if (settled) return;
        if (length !== declared) {
          fail(`${path} unpacks to a different size than the file declares.`);
          return;
        }
        settled = true;
        const out = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          out.set(chunk, offset);
          offset += chunk.length;
        }
        resolve(out);
      })
      .resume();
  });
}

/** Relationship type URIs used by the parser. */
export const REL = {
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  legacyComments: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments',
  commentAuthors:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors',
  modernComments: 'http://schemas.microsoft.com/office/2018/10/relationships/comments',
  authors: 'http://schemas.microsoft.com/office/2018/10/relationships/authors',
  viewProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps',
} as const;

const TRANSITIONAL_RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
/** "Strict Open XML" (ISO/IEC 29500 strict) spells the officeDocument relationships this way. */
const STRICT_RELS = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';

/** Maps strict relationship types onto their transitional twins, so one {@link REL} fits both. */
export const normaliseRelType = (type: string): string =>
  type.startsWith(STRICT_RELS) ? TRANSITIONAL_RELS + type.slice(STRICT_RELS.length) : type;

export interface Relationship {
  id: string;
  type: string;
  /** Resolved zip path of the target (external targets are kept verbatim). */
  target: string;
  external: boolean;
}

/**
 * Read access to the parts of a PPTX zip, with XML and relationship caching.
 * XML syntax errors surface as `PptxError('corrupt')`.
 */
export class Archive {
  private readonly xmlCache = new Map<string, XmlElement | null>();
  private readonly relsCache = new Map<string, Relationship[]>();

  private constructor(private readonly zip: JSZip) {}

  static async open(data: Uint8Array | ArrayBuffer): Promise<Archive> {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (OLE_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
      throw new PptxError('encrypted', 'The file is password protected or encrypted.');
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      throw new PptxError('not_pptx', 'The file is not a PowerPoint (.pptx) package.');
    }
    let total = 0;
    zip.forEach((_, entry) => {
      total += declaredSize(entry);
    });
    if (total > MAX_TOTAL_UNCOMPRESSED) {
      throw new PptxError('corrupt', 'The file unpacks to more data than Slider accepts.');
    }
    return new Archive(zip);
  }

  has(path: string): boolean {
    return this.zip.file(path) !== null;
  }

  /**
   * Cheap identity of an entry's bytes – CRC-32 and size from the central directory – without
   * inflating it. For change detection only: a forged value only hurts the file's own diff.
   */
  entryIdentity(path: string): string | null {
    const entry = this.zip.file(path);
    if (!entry) return null;
    const data = (entry as unknown as { _data?: { crc32?: number } })._data;
    return `${data?.crc32 ?? 0}:${declaredSize(entry)}`;
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const entry = this.zip.file(path);
    return entry ? inflate(path, entry, MAX_BINARY_PART) : null;
  }

  /** Parsed XML of a part, or `null` if the part does not exist. */
  async readXml(path: string): Promise<XmlElement | null> {
    if (this.xmlCache.has(path)) return this.xmlCache.get(path) ?? null;
    const entry = this.zip.file(path);
    let element: XmlElement | null = null;
    if (entry) {
      const bytes = await inflate(path, entry, MAX_XML_PART);
      const source = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
      try {
        element = parseXml(source);
      } catch (error) {
        if (error instanceof XmlSyntaxError) {
          throw new PptxError('corrupt', `Invalid XML in ${path}: ${error.message}`);
        }
        throw error;
      }
    }
    this.xmlCache.set(path, element);
    return element;
  }

  /** Relationships of a part (from its `_rels/*.rels` sibling); empty if there are none. */
  async relationships(partPath: string): Promise<Relationship[]> {
    const cached = this.relsCache.get(partPath);
    if (cached) return cached;
    const root = await this.readXml(relsPathOf(partPath));
    const relationships = children(root, 'Relationship').map((element): Relationship => {
      const target = attr(element, 'Target') ?? '';
      const external = attr(element, 'TargetMode') === 'External';
      return {
        id: attr(element, 'Id') ?? '',
        type: normaliseRelType(attr(element, 'Type') ?? ''),
        target: external ? target : resolvePartPath(partPath, target),
        external,
      };
    });
    this.relsCache.set(partPath, relationships);
    return relationships;
  }

  async relationshipById(partPath: string, id: string): Promise<Relationship | undefined> {
    return (await this.relationships(partPath)).find((rel) => rel.id === id && !rel.external);
  }

  async relationshipsOfType(partPath: string, type: string): Promise<Relationship[]> {
    return (await this.relationships(partPath)).filter((rel) => rel.type === type && !rel.external);
  }
}

/** `ppt/slides/slide1.xml` → `ppt/slides/_rels/slide1.xml.rels` */
export function relsPathOf(partPath: string): string {
  const slash = partPath.lastIndexOf('/');
  return `${partPath.slice(0, slash + 1)}_rels/${partPath.slice(slash + 1)}.rels`;
}

/** Resolves a relationship target relative to the part that owns the relationship. */
export function resolvePartPath(partPath: string, target: string): string {
  const segments = target.startsWith('/') ? [] : partPath.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '.' && segment !== '') segments.push(segment);
  }
  return segments.join('/');
}
