/**
 * Unpacking one zip entry safely, for the ODP and PPTX archives (both JSZip). Typed structurally:
 * what is read here is JSZip-internal or missing from its type definitions, and this package
 * stays free of JSZip.
 */

interface ZipStream {
  on(event: 'data', listener: (chunk: Uint8Array) => void): ZipStream;
  on(event: 'error', listener: (error: Error) => void): ZipStream;
  on(event: 'end', listener: () => void): ZipStream;
  pause(): ZipStream;
  resume(): ZipStream;
}

type EntryData = { uncompressedSize?: unknown } | Uint8Array | ArrayBuffer | string | undefined;
const dataOf = (entry: object): EntryData => (entry as { _data?: EntryData })._data;

/**
 * Whether the entry came from a parsed zip (JSZip keeps the central directory's sizes for it) –
 * not written in this process (a picture just added, a part rewritten), whose bytes are in memory.
 */
const fromZip = (entry: object): boolean => {
  const data = dataOf(entry);
  return (
    typeof data === 'object' &&
    !(data instanceof Uint8Array) &&
    !(data instanceof ArrayBuffer) &&
    typeof data.uncompressedSize === 'number'
  );
};

/**
 * Size the zip's central directory declares for an entry (JSZip keeps it internally); for one
 * written in this process its length in memory (0 while JSZip still converts it).
 */
export const declaredSize = (entry: object): number => {
  const data = dataOf(entry);
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data.byteLength;
  if (typeof data === 'string') return new TextEncoder().encode(data).length;
  const size = data?.uncompressedSize;
  return typeof size === 'number' ? size : 0;
};

/**
 * Inflates one entry with a hard byte budget: at most its declared size and at most `cap`.
 * The stream is stopped the moment the budget is passed, so a forged size header can never make
 * us inflate more than the declared total (zip bomb with patched headers). `corrupt` makes the
 * archive's own error for a message.
 */
export function inflateEntry(
  path: string,
  entry: object,
  cap: number,
  corrupt: (message: string) => Error,
): Promise<Uint8Array> {
  // Written here (a picture the editor or the AI just added): nothing inflated, no header to
  // trust or distrust – only the cap holds.
  if (!fromZip(entry)) {
    return (entry as { async(type: 'uint8array'): Promise<Uint8Array> })
      .async('uint8array')
      .then((bytes) => {
        if (bytes.length > cap) throw corrupt(`${path} is too large.`);
        return bytes;
      });
  }
  const declared = declaredSize(entry);
  if (declared > cap) return Promise.reject(corrupt(`${path} is too large.`));
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(corrupt(message));
    };
    // `internalStream` is public JSZip API (3.x) but missing from its type definitions.
    const stream = (entry as { internalStream(type: 'uint8array'): ZipStream }).internalStream(
      'uint8array',
    );
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
