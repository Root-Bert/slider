import JSZip from 'jszip';
import { PptxError } from './types';
import { attr, children, parseXml, XmlSyntaxError, type XmlElement } from './xml';

/** Compound File Binary signature – Office stores password-protected OOXML files this way. */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

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
    return new Archive(zip);
  }

  has(path: string): boolean {
    return this.zip.file(path) !== null;
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const entry = this.zip.file(path);
    return entry ? entry.async('uint8array') : null;
  }

  /** Parsed XML of a part, or `null` if the part does not exist. */
  async readXml(path: string): Promise<XmlElement | null> {
    if (this.xmlCache.has(path)) return this.xmlCache.get(path) ?? null;
    const entry = this.zip.file(path);
    let element: XmlElement | null = null;
    if (entry) {
      const source = (await entry.async('string')).replace(/^\uFEFF/, '');
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
        type: attr(element, 'Type') ?? '',
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
