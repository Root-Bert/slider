import { DetailedError, Upload } from 'tus-js-client';
import { API_PREFIX, DECK_TUS_PATH, DECK_UPLOAD_PART_BYTES } from '@slider/shared';
import { ApiError, apiErrorFromText, apiRequest } from './api-client';

/** Waits between tries of a part that did not get through (connection gone, server restarted). */
const RETRY_DELAYS_MS = [0, 1000, 3000, 5000, 10_000];
/** Slots busy (429) or no answer when the file is to be made a deck: wait, ask again. */
const FINISH_TRIES = 6;
const FINISH_WAIT_MS = 5000;

const TUS_HEADERS = { 'Tus-Resumable': '1.0.0' };

/** Aborting with this reason drops what the server has so far; any other abort keeps it for later. */
export const CANCEL_UPLOAD = 'cancel';

/**
 * A deck file in parts over tus (`apps/api/src/routes/deck-tus.ts`): no request bigger than a
 * part, so a proxy's limit per request (Cloudflare: 100 MB) does not matter. A part that fails
 * is sent again; the same file picked again – also after a reload – goes on where it stopped.
 * Then the server makes the deck (or the new version of `deckId`) and answers as
 * `POST /decks/upload` would.
 */
export async function uploadInParts<T>(
  file: File,
  target: { workspaceId: string } | { deckId: string },
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<T> {
  const id = await sendInParts(file, target, onProgress, signal);
  for (let attempt = 1; ; attempt++) {
    try {
      return await apiRequest<T>(`${DECK_TUS_PATH}/${encodeURIComponent(id)}/finish`, {
        method: 'POST',
        headers: TUS_HEADERS,
        signal,
      });
    } catch (error) {
      // Slots busy, or the answer lost on the way: the server keeps the file (and a finished
      // upload's answer), so asking again is safe.
      const again = error instanceof ApiError && (error.status === 429 || error.status === 0);
      if (!again || attempt >= FINISH_TRIES || signal.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, FINISH_WAIT_MS));
    }
  }
}

/**
 * What a file sent in parts is for: a deck file (new deck or version), a comment's recording, or
 * a file for a deck's board (Folie 0).
 */
export type PartsTarget =
  | { workspaceId: string }
  | { deckId: string }
  | { purpose: 'recording'; deckId: string }
  | { purpose: 'recording'; commentId: string }
  | { purpose: 'material'; deckId: string };

/**
 * The file's parts sent over tus, resumed where an earlier try stopped; resolves with the
 * upload's id once all are on the server. A recording's id goes in its comment's request
 * (field `upload`).
 */
export async function sendInParts(
  file: File,
  target: PartsTarget,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<string> {
  const targetKey = Object.entries(target)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const uploadUrl = await new Promise<string>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: `${API_PREFIX}${DECK_TUS_PATH}`,
      chunkSize: DECK_UPLOAD_PART_BYTES,
      retryDelays: RETRY_DELAYS_MS,
      metadata: { filename: file.name, ...target },
      // The same file into another workspace (or as another deck's version) is another upload.
      fingerprint: async () =>
        ['slider-deck', targetKey, file.name, file.size, file.lastModified].join(':'),
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      onProgress: (sent, total) => onProgress(total > 0 ? sent / total : 0),
      onSuccess: () => resolve(upload.url ?? ''),
      onError: (error) => {
        const response = error instanceof DetailedError ? error.originalResponse : null;
        reject(response ? apiErrorFromText(response.getStatus(), response.getBody()) : error);
      },
    });
    const aborted = () => {
      // A recording is not picked again later: nothing to resume, so it goes at once.
      void upload.abort(signal.reason === CANCEL_UPLOAD || 'purpose' in target);
      reject(new DOMException('Upload abgebrochen', 'AbortError'));
    };
    if (signal.aborted) return aborted();
    signal.addEventListener('abort', aborted, { once: true });
    void upload.findPreviousUploads().then((previous) => {
      if (signal.aborted) return;
      if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, reject);
  });

  return uploadUrl.split('/').pop() ?? '';
}
