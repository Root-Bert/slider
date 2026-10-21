import JSZip from 'jszip';
import { PptxError } from './types';
import { attr, children, parseXml, XmlSyntaxError, type XmlElement } from './xml';

/** Compound File Binary signature – Office stores password-protected OOXML files this way. */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Inflated size caps – a small upload must not unpack into gigabytes (zip bomb). Repetitive XML
 * deflates about 1000:1 and its DOM costs up to ~30× its size in memory, so the caps follow what
 * real decks need (slide XML is KBs to a few MB), not what the file's headers claim:
 *
 * - every part has a cap of its own ({@link MAX_XML_PART}, {@link MAX_BINARY_PART});
 * - all XML of one file together unpacks to at most {@link MAX_XML_TOTAL}, and to at most
 *   {@link MAX_XML_RATIO} times the size of the upload (with a small floor for tiny files);
 * - all parts together unpack to at most {@link MAX_TOTAL_INFLATED}.
 *
 * The budgets are per {@link Archive} and count each part once. A part is refused up front when
 * its declared size does not fit; `inflate` stops as soon as an entry produces more bytes than
 * it declared, so a forged header cannot get more than that through either.
 */
const MAX_TOTAL_DECLARED = 2 * 1024 ** 3;
export const MAX_XML_PART = 10 * 1024 ** 2;
export const MAX_XML_TOTAL = 64 * 1024 ** 2;
export const MAX_XML_RATIO = 100;
const XML_BUDGET_FLOOR = 8 * 1024 ** 2;
export const MAX_BINARY_PART = 300 * 1024 ** 2;
export const MAX_TOTAL_INFLATED = 512 * 1024 ** 2;

const TOO_LARGE = 'The file unpacks to more data than Slider accepts.';

/** Bytes one archive may still inflate. A part counts once, however often it is read. */
class InflateBudget {
  private readonly counted = new Set<string>();

  constructor(
    private xmlLeft: number,
    private totalLeft: number,
  ) {}

  /** Reserves `size` bytes for the first read of `path`; throws when they do not fit. */
  reserve(path: string, size: number, xml: boolean): void {
    if (this.counted.has(path)) return;
    if (size > this.totalLeft || (xml && size > this.xmlLeft)) {
      throw new PptxError('corrupt', TOO_LARGE);
    }
    this.counted.add(path);
    this.totalLeft -= size;
    if (xml) this.xmlLeft -= size;
  }
}

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

  private constructor(
    private readonly zip: JSZip,
    private readonly budget: InflateBudget,
  ) {}

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
    if (total > MAX_TOTAL_DECLARED) throw new PptxError('corrupt', TOO_LARGE);
    const xmlBudget = Math.min(
      MAX_XML_TOTAL,
      Math.max(XML_BUDGET_FLOOR, MAX_XML_RATIO * bytes.byteLength),
    );
    return new Archive(zip, new InflateBudget(xmlBudget, MAX_TOTAL_INFLATED));
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

  /** Size the zip declares for an entry (not inflated, so not trustworthy), or `null`. */
  declaredSize(path: string): number | null {
    const entry = this.zip.file(path);
    return entry ? declaredSize(entry) : null;
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const entry = this.zip.file(path);
    return entry ? this.inflate(path, entry, MAX_BINARY_PART, false) : null;
  }

  /** Inflates an entry within its own cap and the archive's budget. */
  private async inflate(
    path: string,
    entry: JSZip.JSZipObject,
    cap: number,
    xml: boolean,
  ): Promise<Uint8Array> {
    const declared = declaredSize(entry);
    if (declared > cap) throw new PptxError('corrupt', `${path} is too large.`);
    this.budget.reserve(path, declared, xml);
    return inflate(path, entry, cap);
  }

  /**
   * Parsed XML of a part, or `null` if the part does not exist. Parts that are read only once
   * (slides, chart parts) pass `retain: false`, so their DOM is not kept for the whole import.
   */
  async readXml(path: string, options: { retain?: boolean } = {}): Promise<XmlElement | null> {
    if (this.xmlCache.has(path)) return this.xmlCache.get(path) ?? null;
    const entry = this.zip.file(path);
    let element: XmlElement | null = null;
    if (entry) {
      const bytes = await this.inflate(path, entry, MAX_XML_PART, true);
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
    if (options.retain !== false) this.xmlCache.set(path, element);
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

  /**
   * The package re-zipped with every relationship part rebuilt from the relationships it may
   * keep: internal ones with a plain part path as target. External targets (`TargetMode=
   * "External"`: linked pictures, media, OLE objects, hyperlinks) are dropped, so an office
   * suite that renders the file – LibreOffice for the slide images – never fetches a URL or a
   * local file an uploaded deck points at (SSRF past the URL import's address checks).
   *
   * Every part is written from what this reader saw (duplicate zip entries collapse into one),
   * and relationship parts are generated, not patched, so no XML or zip trick survives into the
   * copy. Relationship parts count against the archive's inflate budget like any XML part.
   */
  async withoutExternalRelationships(): Promise<Uint8Array> {
    const relsPaths: string[] = [];
    this.zip.forEach((path, entry) => {
      if (!entry.dir && /\.rels$/i.test(path)) relsPaths.push(path);
    });
    for (const relsPath of relsPaths) {
      const root = await this.readXml(relsPath, { retain: false });
      const kept = (root?.children ?? []).filter(isInternalRelationship).map((element) => ({
        id: attr(element, 'Id') ?? '',
        type: attr(element, 'Type') ?? '',
        target: attr(element, 'Target') ?? '',
      }));
      this.zip.file(relsPath, relationshipsXml(kept));
    }
    return this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  async relationshipById(partPath: string, id: string): Promise<Relationship | undefined> {
    return (await this.relationships(partPath)).find((rel) => rel.id === id && !rel.external);
  }

  async relationshipsOfType(partPath: string, type: string): Promise<Relationship[]> {
    return (await this.relationships(partPath)).filter((rel) => rel.type === type && !rel.external);
  }
}

/** A URI scheme (`http:`, `file:`, `smb:` …) – never part of an internal part path. */
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Only an unprefixed `Relationship` that is explicitly or implicitly internal and targets a
 * plain path (no scheme, no `//host`) – anything else could make a renderer leave the package.
 */
function isInternalRelationship(element: XmlElement): boolean {
  const mode = attr(element, 'TargetMode');
  // URL parsers drop whitespace and control characters, so they must not hide a scheme or `//`.
  const target = (attr(element, 'Target') ?? '').replace(/[\s\p{Cc}]/gu, '');
  return (
    element.name === 'Relationship' &&
    (mode === undefined || mode === 'Internal') &&
    !URI_SCHEME.test(target) &&
    !/^[\\/]{2}/.test(target)
  );
}

const escapeXmlAttribute = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\t\n\r]/g, (char) => `&#${char.charCodeAt(0)};`);

function relationshipsXml(relationships: { id: string; type: string; target: string }[]): string {
  const items = relationships
    .map(
      ({ id, type, target }) =>
        `<Relationship Id="${escapeXmlAttribute(id)}" Type="${escapeXmlAttribute(type)}" Target="${escapeXmlAttribute(target)}"/>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
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
