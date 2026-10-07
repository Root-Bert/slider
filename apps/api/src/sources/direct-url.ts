import type { ParsedShareLink } from '@slider/shared';
import { notAPowerPoint } from '../http/errors';
import {
  LINK_NOT_A_POWERPOINT_MESSAGE,
  sourceForbidden,
  sourceNotFound,
  sourceUnreachable,
} from './errors';
import {
  fileNameFor,
  isHtmlResponse,
  isPptxBytes,
  readBodyCapped,
  safeFetch,
  type SafeFetchOptions,
} from './safe-fetch';
import type { RemoteFile, SourceAdapter } from './source-adapter';

/** Downloads `url` and returns it as a PPTX, or throws the matching link error. */
export async function downloadPptx(
  url: URL,
  http: SafeFetchOptions,
): Promise<RemoteFile & { bytes: Uint8Array }> {
  const { response, url: finalUrl } = await safeFetch(url, http);
  if (!response.ok) {
    await response.body?.cancel();
    throw statusError(response.status);
  }
  if (isHtmlResponse(response)) {
    await response.body?.cancel();
    throw notAPowerPoint(LINK_NOT_A_POWERPOINT_MESSAGE);
  }
  const bytes = await readBodyCapped(response, http.maxBytes);
  if (!isPptxBytes(bytes)) throw notAPowerPoint(LINK_NOT_A_POWERPOINT_MESSAGE);
  return {
    ref: finalUrl.href,
    fileName: fileNameFor(response, finalUrl),
    sizeBytes: bytes.byteLength,
    changeToken: changeTokenOf(response),
    bytes,
  };
}

function statusError(status: number) {
  if (status === 404 || status === 410) return sourceNotFound();
  if (status === 401 || status === 403) {
    return sourceForbidden('Die Datei unter diesem Link ist nicht öffentlich zugänglich.');
  }
  return sourceUnreachable(`Der Link liefert einen Fehler (HTTP ${status}).`);
}

const changeTokenOf = (response: Response): string | null =>
  response.headers.get('etag') ?? response.headers.get('last-modified');

/** Any public https URL that serves a `.pptx` – no login, no provider API. */
export class DirectUrlAdapter implements SourceAdapter {
  constructor(private readonly http: SafeFetchOptions) {}

  async resolve(link: ParsedShareLink): Promise<RemoteFile> {
    // The file is fetched once here; there is no cheaper way to learn its name and check it.
    return downloadPptx(link.url, this.http);
  }

  async download(file: RemoteFile): Promise<Uint8Array> {
    return file.bytes ?? (await downloadPptx(new URL(file.ref), this.http)).bytes;
  }

  async getChangeToken(file: RemoteFile): Promise<string> {
    const { response } = await safeFetch(new URL(file.ref), this.http, { method: 'HEAD' });
    await response.body?.cancel();
    if (!response.ok) throw statusError(response.status);
    return changeTokenOf(response) ?? '';
  }
}
