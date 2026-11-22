import JSZip from 'jszip';
import { declaredSize, inflateEntry, zipEntriesAtMost } from '@slider/shared';
import { OdtError } from './errors';

/*
 * The zip of a text document, read as `@slider/odp` reads a presentation's: only the XML parts
 * are unpacked, each under a hard byte budget; pictures stay compressed and are written back as
 * they came.
 */

export const ODT_MIME = 'application/vnd.oasis.opendocument.text';
export const OTT_MIME = 'application/vnd.oasis.opendocument.text-template';

const MAX_XML_PART = 40 * 1024 ** 2;
const MAX_XML_TOTAL = 80 * 1024 ** 2;
const MAX_XML_RATIO = 100;
const XML_BUDGET_FLOOR = 8 * 1024 ** 2;
const MAX_ENTRIES = 10_000;
const MAX_PART = 300 * 1024 ** 2;
const MAX_TOTAL_DECLARED = 1024 ** 3;

/** Whether bytes are a text document, told by the stored `mimetype` part ODF puts first. */
export function isOdtBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 38 + ODT_MIME.length) return false;
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return false;
  }
  const text = new TextDecoder().decode(bytes.subarray(30, 38 + OTT_MIME.length));
  return text.startsWith(`mimetype${ODT_MIME}`);
}

const corrupt = (message: string) => new OdtError('corrupt', message);

export class OdtArchive {
  private xmlLeft: number;

  private constructor(
    private readonly zip: JSZip,
    fileSize: number,
    private readonly mime: string,
  ) {
    this.xmlLeft = Math.min(MAX_XML_TOTAL, Math.max(XML_BUDGET_FLOOR, MAX_XML_RATIO * fileSize));
  }

  static async open(bytes: Uint8Array): Promise<OdtArchive> {
    if (!zipEntriesAtMost(bytes, MAX_ENTRIES)) throw corrupt('The file has too many parts.');
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      throw corrupt('The file is not a zip archive.');
    }
    if (Object.keys(zip.files).length > MAX_ENTRIES) throw corrupt('The file has too many parts.');
    const declared = Object.values(zip.files).reduce((sum, entry) => sum + declaredSize(entry), 0);
    if (declared > MAX_TOTAL_DECLARED)
      throw corrupt('The file unpacks to more data than accepted.');
    const mimetype = zip.file('mimetype');
    const type = mimetype
      ? new TextDecoder().decode(await inflateEntry('mimetype', mimetype, 1024, corrupt)).trim()
      : null;
    if (type !== ODT_MIME && type !== OTT_MIME) {
      throw new OdtError(type ? 'unsupported' : 'corrupt', 'The file is not an OpenDocument text.');
    }
    return new OdtArchive(zip, bytes.byteLength, type);
  }

  has(path: string): boolean {
    return this.zip.file(path) !== null;
  }

  async readText(path: string): Promise<string> {
    const entry = this.zip.file(path);
    if (!entry) throw corrupt(`${path} is missing.`);
    const size = declaredSize(entry);
    if (size > this.xmlLeft) throw corrupt('The file unpacks to more data than accepted.');
    this.xmlLeft -= size;
    return new TextDecoder().decode(await inflateEntry(path, entry, MAX_XML_PART, corrupt));
  }

  async readBinary(path: string, cap: number): Promise<Uint8Array> {
    const entry = this.zip.file(path);
    if (!entry) throw corrupt(`${path} is missing.`);
    return inflateEntry(path, entry, cap, corrupt);
  }

  write(path: string, data: string | Uint8Array, compress = true): void {
    this.zip.file(path, data, { compression: compress ? 'DEFLATE' : 'STORE' });
  }

  /** The zip again, `mimetype` first and stored, always as a document (a template opened is one). */
  async toBytes(): Promise<Uint8Array> {
    const names = Object.keys(this.zip.files);
    let zip = this.zip;
    if (names[0] !== 'mimetype' || this.mime !== ODT_MIME) {
      zip = new JSZip();
      zip.file('mimetype', ODT_MIME, { compression: 'STORE' });
      for (const name of names) {
        const entry = this.zip.files[name];
        if (!entry || name === 'mimetype') continue;
        if (entry.dir) zip.folder(name);
        else zip.file(name, await inflateEntry(name, entry, MAX_PART, corrupt));
      }
    } else {
      zip.file('mimetype', ODT_MIME, { compression: 'STORE' });
    }
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: ODT_MIME });
  }
}
