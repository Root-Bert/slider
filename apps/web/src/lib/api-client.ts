import { API_PREFIX, type ApiError as ApiErrorBody, type ErrorCode } from '@slider/shared';
import { routes } from './routes';

/** Error thrown for every non-2xx API response. `code` is stable; `message` is user-facing German copy. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    /** With `microsoft_login_required`: where to send the browser to sign in. */
    readonly loginUrl?: string,
    /** With `nextcloud_login_required`: the Nextcloud to connect (BER-135). */
    readonly nextcloudServer?: string,
    /** With `google_login_required`: the file to pick in Google's picker (BER-119). */
    readonly googleFileId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const fromBody = (status: number, error: ApiErrorBody['error']) => {
  if (error.code === 'instance_unclaimed') toClaimScreen();
  return new ApiError(
    status,
    error.code,
    error.message,
    error.loginUrl,
    error.nextcloudServer,
    error.googleFileId,
  );
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

export async function apiRequest<T>(
  path: string,
  { body, headers, ...init }: RequestOptions = {},
): Promise<T> {
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
    throw new ApiError(0, 'internal', 'Keine Verbindung zum Server.');
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    // A 2xx that isn't JSON: a proxy or the SPA fallback answered instead of the API.
    throw proxyError(response.status);
  }
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: JsonBody | FormData) =>
    apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body: JsonBody) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body: JsonBody) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: (path: string) => apiRequest<void>(path, { method: 'DELETE' }),
};

/**
 * Upload with progress events – `fetch` cannot report upload progress yet, so this uses XHR.
 * Resolves with the parsed JSON body (BER-91: "Uploads bis 200 MB mit Fortschrittsanzeige").
 */
export function uploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    checkPath(path);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_PREFIX}${path}`);
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
    xhr.onerror = () => reject(new ApiError(0, 'internal', 'Keine Verbindung zum Server.'));
    const aborted = () => new DOMException('Upload abgebrochen', 'AbortError');
    xhr.onabort = () => reject(aborted());
    if (signal?.aborted) return reject(aborted());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(formData);
  });
}
