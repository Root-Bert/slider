import { API_PREFIX, type ApiError as ApiErrorBody, type ErrorCode } from '@slider/shared';
import { routes } from './routes';

/** Error thrown for every non-2xx API response. `code` is stable; `message` is user-facing German copy. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    /** With `nextcloud_login_required`: the Nextcloud to connect (BER-135). */
    readonly nextcloudServer?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const fromBody = (status: number, error: ApiErrorBody['error']) => {
  if (error.code === 'instance_unclaimed') toClaimScreen();
  return new ApiError(status, error.code, error.message, error.nextcloudServer);
};

/**
 * No instance admin yet: the API lets a signed-in account do nothing but enter the setup token,
 * so any page that runs into it (a deck link, an invitation) goes to that screen.
 */
function toClaimScreen(): void {
  if (typeof window === 'undefined' || window.location.pathname === routes.setup()) return;
  window.location.assign(routes.setup());
}

const FALLBACK_MESSAGE = 'Etwas ist schiefgelaufen. Bitte versuche es erneut.';

/** No answer at all (no connection, the request failed on the way): status 0. */
export const unreachableError = () => new ApiError(0, 'internal', 'Keine Verbindung zum Server.');

/**
 * An error without Slider's JSON body – it came from a reverse proxy in front of the API (an
 * HTML error page). Its status still says what happened: nginx answers an upload above its
 * `client_max_body_size` (1 MB by default) with 413 before Slider sees the request.
 */
export function proxyError(status: number): ApiError {
  if (status === 413) {
    return new ApiError(
      status,
      'file_too_large',
      'Die Datei ist für diesen Server zu groß. Der Betreiber muss das Upload-Limit des Reverse-Proxys erhöhen (z. B. nginx client_max_body_size).',
    );
  }
  if (status === 502 || status === 503 || status === 504) {
    return new ApiError(
      status,
      'internal',
      'Der Server ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.',
    );
  }
  return new ApiError(status, 'internal', FALLBACK_MESSAGE);
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.error) return fromBody(response.status, body.error);
  } catch {
    // Non-JSON error (proxy down, HTML error page) – fall through.
  }
  return proxyError(response.status);
}

/** An error answer another library's request got (`tus-js-client`), read as `toApiError` does. */
export function apiErrorFromText(status: number, text: string): ApiError {
  try {
    const body = JSON.parse(text) as Partial<ApiErrorBody>;
    if (body.error) return fromBody(status, body.error);
  } catch {
    // Non-JSON error (proxy down, HTML error page) – fall through.
  }
  return status === 0 ? unreachableError() : proxyError(status);
}

/**
 * Ids from the address bar end up in API paths (`/d/:deckId` → `/decks/${deckId}`), and React
 * Router decodes `%2F` in params: `/d/..%2Fworkspaces%2Fx` would turn into `/api/workspaces/x`
 * once the browser resolves the dot segments (`%2e` counts as a dot, too; tabs and line breaks
 * the URL parser drops: `.\t.`). Such a path never names a real resource – it answers 404
 * without a request.
 */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;
function checkPath(path: string): void {
  const pathname = path.split(/[?#]/)[0]!.replace(/[\t\n\r]/g, '');
  if (pathname.split(/\/|\\/).some((segment) => DOT_SEGMENT.test(segment))) {
    throw new ApiError(404, 'not_found', 'Nicht gefunden.');
  }
}

type JsonBody = Record<string, unknown> | unknown[];

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: JsonBody | FormData;
}

/**
 * Set by the service worker (`public/sw.js`) on an answer it gave from its store because the
 * server could not be reached: an older answer, perhaps of an earlier step of the deck.
 */
export const STORED_ANSWER_HEADER = 'X-Slider-Offline';

/** An answer and whether it came from the service worker's store (`STORED_ANSWER_HEADER`). */
export interface ApiAnswer<T> {
  data: T;
  fromStore: boolean;
}

/** `apiRequest`, telling an answer the service worker gave from its store from the server's. */
export async function apiRequestAnswer<T>(
  path: string,
  { body, headers, ...init }: RequestOptions = {},
): Promise<ApiAnswer<T>> {
  checkPath(path);
  const isJson = body !== undefined && !(body instanceof FormData);
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(isJson && { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: isJson ? JSON.stringify(body) : body,
    });
  } catch {
    throw unreachableError();
  }

  if (!response.ok) throw await toApiError(response);
  const fromStore = response.headers.get(STORED_ANSWER_HEADER) === '1';
  if (response.status === 204) return { data: undefined as T, fromStore };
  try {
    return { data: (await response.json()) as T, fromStore };
  } catch {
    // A 2xx that isn't JSON: a proxy or the SPA fallback answered instead of the API.
    throw proxyError(response.status);
  }
}

/**
 * The answers `apiRequest` got from the service worker's store, told by identity – the data
 * itself, as a query function hands it on. A query that holds data already does not take one
 * (`app/query-client.ts`, `keepNewerData`): the server out of reach for a moment, its stored
 * answer may be older than what the query has – an edit's answer stored since, a live update.
 * Only answers that are objects (lists, records) are told; a bare `null` or number is not.
 */
const storedAnswers = new WeakSet<object>();

/** Whether `data` is an answer the service worker gave from its store (`apiRequest`). */
export const isStoredAnswer = (data: unknown): boolean =>
  typeof data === 'object' && data !== null && storedAnswers.has(data);

export async function apiRequest<T>(path: string, options?: RequestOptions): Promise<T> {
  const { data, fromStore } = await apiRequestAnswer<T>(path, options);
  if (fromStore && typeof data === 'object' && data !== null) storedAnswers.add(data);
  return data;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: JsonBody | FormData) =>
    apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body: JsonBody) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body: JsonBody) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: (path: string) => apiRequest<void>(path, { method: 'DELETE' }),
};

/** A file from the API, named as its answer says (`Content-Disposition`), else `fallbackName`. */
export async function apiFile(path: string, fallbackName: string): Promise<File> {
  checkPath(path);
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, { credentials: 'same-origin' });
  } catch {
    throw unreachableError();
  }
  if (!response.ok) throw await toApiError(response);
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const blob = await response.blob();
  return new File([blob], encoded ? decodeURIComponent(encoded) : fallbackName);
}

/**
 * A file the API makes on asking (a PDF of a deck), saved by the browser under the name the
 * answer gives – fetched first, so the page can show it is being made and say why it failed.
 */
export async function apiDownload(path: string, fallbackName: string): Promise<void> {
  const file = await apiFile(path, fallbackName);
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  // In the page while clicked, and the file kept a while: Safari reads it after the click.
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Upload with progress events – `fetch` cannot report upload progress yet, so this uses XHR.
 * Resolves with the parsed JSON body (BER-91: uploads with a progress bar).
 */
export function uploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  method: 'POST' | 'PUT' = 'POST',
): Promise<T> {
  return new Promise((resolve, reject) => {
    checkPath(path);
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API_PREFIX}${path}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      // `response` is null when the body wasn't JSON (a proxy answered instead of the API).
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response !== null) {
        return resolve(xhr.response as T);
      }
      const body = xhr.response as Partial<ApiErrorBody> | null;
      reject(body?.error ? fromBody(xhr.status, body.error) : proxyError(xhr.status));
    };
    xhr.onerror = () => reject(unreachableError());
    const aborted = () => new DOMException('Upload abgebrochen', 'AbortError');
    xhr.onabort = () => reject(aborted());
    if (signal?.aborted) return reject(aborted());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(formData);
  });
}
