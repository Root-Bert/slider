import type { Archive } from './archive';
import type { XmlElement } from './xml';

/**
 * Hash of what a slide shows that the SVG preview cannot see (BER-108 "modified"): shape
 * geometry, fills, line and `p:style` (gradients, theme colours), picture crops, the bytes of
 * referenced media (EMF/WMF/TIFF render as placeholders), and the parts behind graphic frames
 * (charts, SmartArt data, OLE objects). Matching compares it next to the render hash.
 *
 * It deliberately leaves out what differs between producers for an unchanged slide and what the
 * render already covers: shape ids and names, positions (`a:xfrm`), relationship ids (replaced
 * by the identity of their target), namespace declarations, plain-rectangle geometry and text
 * bodies.
 */

/** Elements whose canonical form goes into the hash, wherever they sit in the shape tree. */
const HASHED = new Set(['p:spPr', 'p:grpSpPr', 'p:style', 'p:blipFill', 'a:graphic', 'p:bg']);

const escape = (value: string) => value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);

/** Canonical XML: sorted attributes, no namespace declarations, `r:*` values resolved. */
async function canonical(
  element: XmlElement,
  resolve: ((relId: string) => Promise<string>) | null,
  skip: (element: XmlElement) => boolean,
): Promise<string> {
  if (skip(element)) return '';
  const attributes: string[] = [];
  for (const key of Object.keys(element.attributes).sort()) {
    if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
    const value = element.attributes[key] ?? '';
    if (key.startsWith('r:')) {
      // Relationship ids are renamed freely by producers; what they point at is what counts.
      if (resolve) attributes.push(`${key}="${escape(await resolve(value))}"`);
      continue;
    }
    attributes.push(`${key}="${escape(value)}"`);
  }
  let inner = escape(element.text);
  for (const child of element.children) inner += await canonical(child, resolve, skip);
  return `<${element.name}${attributes.length ? ' ' : ''}${attributes.join(' ')}>${inner}</>`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Content hash of a slide part (see the file comment); hex SHA-256. */
export async function slideContentHash(
  archive: Archive,
  slidePath: string,
  slide: XmlElement,
): Promise<string> {
  const identities = new Map<string, Promise<string>>();
  const identityOf = (relId: string): Promise<string> => {
    let identity = identities.get(relId);
    if (!identity) {
      identity = partIdentity(archive, slidePath, relId);
      identities.set(relId, identity);
    }
    return identity;
  };
  const skip = (element: XmlElement) =>
    element.name === 'a:xfrm' ||
    // A plain rectangle is what an inherited placeholder is anyway; Google writes it explicitly.
    (element.name === 'a:prstGeom' &&
      element.attributes.prst === 'rect' &&
      element.children.every((child) => child.name === 'a:avLst' && child.children.length === 0));

  const pieces: string[] = [];
  const visit = async (element: XmlElement): Promise<void> => {
    if (HASHED.has(element.name)) {
      pieces.push(await canonical(element, identityOf, skip));
      return;
    }
    for (const child of element.children) await visit(child);
  };
  const cSld = slide.children.find((element) => element.name === 'p:cSld');
  if (cSld) await visit(cSld);
  return sha256Hex(pieces.join('\n'));
}

/**
 * Hashes of XML parts per archive, by path. The inflate budget counts a part once, so without
 * this a file could point thousands of relationships at one big part and have it re-parsed for
 * each of them.
 */
const xmlPartHashes = new WeakMap<Archive, Map<string, Promise<string>>>();

/** What a relationship of the slide points at: part content for XML parts, CRC and size else. */
async function partIdentity(archive: Archive, slidePath: string, relId: string): Promise<string> {
  const rel = (await archive.relationships(slidePath)).find((candidate) => candidate.id === relId);
  if (!rel) return 'missing';
  if (rel.external) return `external:${rel.target}`;
  if (rel.target.endsWith('.xml')) {
    let hashes = xmlPartHashes.get(archive);
    if (!hashes) {
      hashes = new Map();
      xmlPartHashes.set(archive, hashes);
    }
    let hash = hashes.get(rel.target);
    if (!hash) {
      hash = xmlPartHash(archive, rel.target);
      hashes.set(rel.target, hash);
    }
    return hash;
  }
  return archive.entryIdentity(rel.target) ?? 'missing';
}

async function xmlPartHash(archive: Archive, partPath: string): Promise<string> {
  try {
    const part = await archive.readXml(partPath, { retain: false });
    // One level deep: a chart's embedded workbook or style parts do not count on their own.
    return part ? await sha256Hex(await canonical(part, null, () => false)) : 'missing';
  } catch {
    return `unreadable:${archive.entryIdentity(partPath) ?? ''}`;
  }
}
