import JSZip from 'jszip';
import { declaredSize, inflateEntry } from '@slider/shared';
import { OdpError } from './errors';

/*
 * The zip of an ODP. Only the XML parts we edit are ever unpacked, each under a hard byte budget
 * (zip bombs with forged headers included, like `@slider/pptx`'s archive). Pictures and every
 * other part stay compressed: writing the zip again reuses their compressed bytes.
 */

/** content.xml holds every slide, so it gets more room than a single PPTX slide part. */
export const MAX_XML_PART = 40 * 1024 ** 2;
/** All unpacked XML of one file together: at most this, and at most RATIO × the file. */
export const MAX_XML_TOTAL = 80 * 1024 ** 2;
export const MAX_XML_RATIO = 100;
const XML_BUDGET_FLOOR = 8 * 1024 ** 2;
const MAX_ENTRIES = 10_000;
const MAX_PART = 300 * 1024 ** 2;
const MAX_TOTAL_DECLARED = 1024 ** 3;

export const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';
export const OTP_MIME = 'application/vnd.oasis.opendocument.presentation-template';

/**
 * Whether bytes are an ODP, told by the first zip entry: ODF puts an uncompressed `mimetype`
 * part first, so its name and the media type sit at fixed offsets.
 */
export function isOdpBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 38 + ODP_MIME.length) return false;
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04)
    return false;
  const text = new TextDecoder().decode(bytes.subarray(30, 38 + OTP_MIME.length));
  return text.startsWith(`mimetype${ODP_MIME}`);
}

/** Inflates one entry within `cap` and its declared size (`inflateEntry`). */
const inflate = (path: string, entry: JSZip.JSZipObject, cap: number): Promise<Uint8Array> =>
  inflateEntry(path, entry, cap, (message) => new OdpError('corrupt', message));

/**
 * A copy of a zip's map of parts – without a prototype, as JSZip makes it: a part named like an
 * object's own property (`constructor`) must not be found where there is none.
 */
const copyEntries = (
  entries: Readonly<Record<string, JSZip.JSZipObject>>,
): Record<string, JSZip.JSZipObject> =>
  Object.assign(Object.create(null) as Record<string, JSZip.JSZipObject>, entries);

/** Sizes of parts written in this process – JSZip only knows them for parts read from a zip. */
const writtenSizes = new WeakMap<object, number>();

export class OdpArchive {
  private xmlLeft: number;

  private constructor(
    readonly zip: JSZip,
    fileSize: number,
  ) {
    this.xmlLeft = Math.min(MAX_XML_TOTAL, Math.max(XML_BUDGET_FLOOR, MAX_XML_RATIO * fileSize));
  }

  static async open(bytes: Uint8Array): Promise<OdpArchive> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      throw new OdpError('corrupt', 'The file is not a zip archive.');
    }
    if (Object.keys(zip.files).length > MAX_ENTRIES) {
      throw new OdpError('corrupt', 'The file has too many parts.');
    }
    const declared = Object.values(zip.files).reduce((sum, entry) => sum + declaredSize(entry), 0);
    if (declared > MAX_TOTAL_DECLARED) {
      throw new OdpError('corrupt', 'The file unpacks to more data than Slider accepts.');
    }
    const archive = new OdpArchive(zip, bytes.byteLength);
    const mimetype = zip.file('mimetype');
    const type = mimetype
      ? new TextDecoder().decode(await archive.read('mimetype', 1024)).trim()
      : null;
    if (type !== ODP_MIME && type !== OTP_MIME) {
      throw new OdpError(
        type ? 'unsupported' : 'corrupt',
        'The file is not an OpenDocument presentation.',
      );
    }
    return archive;
  }

  has(path: string): boolean {
    return this.zip.file(path) !== null;
  }

  paths(): string[] {
    return Object.values(this.zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name);
  }

  /** Unpacks one part under the shared XML budget. */
  async read(path: string, cap = MAX_XML_PART): Promise<Uint8Array> {
    const entry = this.zip.file(path);
    if (!entry) throw new OdpError('corrupt', `${path} is missing.`);
    const size = declaredSize(entry);
    if (size > this.xmlLeft)
      throw new OdpError('corrupt', 'The file unpacks to more data than Slider accepts.');
    this.xmlLeft -= size;
    return inflate(path, entry, cap);
  }

  /** A part's unpacked size as the zip declares it (0 if missing). */
  size(path: string): number {
    const entry = this.zip.file(path);
    return entry ? (writtenSizes.get(entry) ?? declaredSize(entry)) : 0;
  }

  /** Unpacks a binary part (a picture), outside the XML budget. */
  async readBinary(path: string, cap: number): Promise<Uint8Array> {
    const entry = this.zip.file(path);
    if (!entry) throw new OdpError('corrupt', `${path} is missing.`);
    return inflate(path, entry, cap);
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.read(path));
  }

  write(path: string, data: string | Uint8Array, compress = true): void {
    this.zip.file(path, data, { compression: compress ? 'DEFLATE' : 'STORE' });
    const entry = this.zip.file(path);
    if (entry && typeof data !== 'string') writtenSizes.set(entry, data.byteLength);
  }

  remove(path: string): void {
    this.zip.remove(path);
  }

  /**
   * The package's parts as they are now, for {@link restore}. Cheap: JSZip keeps a part as an
   * object it replaces on every write and drops on removal, never changes – so the map of them
   * is the whole state, and the bytes are shared.
   */
  entries(): Readonly<Record<string, JSZip.JSZipObject>> {
    return copyEntries(this.zip.files);
  }

  /** Puts the package's parts back as {@link entries} returned them: later writes and removals undone. */
  restore(entries: Readonly<Record<string, JSZip.JSZipObject>>): void {
    this.zip.files = copyEntries(entries);
  }

  /** The zip again, `mimetype` first and uncompressed as ODF requires. */
  async toBytes(): Promise<Uint8Array> {
    const names = Object.keys(this.zip.files);
    if (names[0] !== 'mimetype') {
      // Rebuild in the required order; only happens with files other tools wrote oddly.
      const ordered = new JSZip();
      const type = (await this.zip.file('mimetype')?.async('string'))?.trim();
      ordered.file('mimetype', type === OTP_MIME ? OTP_MIME : ODP_MIME, { compression: 'STORE' });
      for (const name of names) {
        const entry = this.zip.files[name];
        if (!entry || name === 'mimetype') continue;
        if (entry.dir) ordered.folder(name);
        else ordered.file(name, await inflate(name, entry, MAX_PART));
      }
      return ordered.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        mimeType: ODP_MIME,
      });
    }
    const mimetype = this.zip.file('mimetype');
    if (mimetype)
      this.zip.file('mimetype', await mimetype.async('string'), { compression: 'STORE' });
    return this.zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      mimeType: ODP_MIME,
    });
  }
}
