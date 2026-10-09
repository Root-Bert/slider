import { API_PREFIX, type ApiError as ApiErrorBody, type ErrorCode } from '@slider/shared';

/** Error thrown for every non-2xx API response. `code` is stable; `message` is user-facing German copy. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    /** With `microsoft_login_required`: where to send the browser to sign in. */
    readonly loginUrl?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const fromBody = (status: number, error: ApiErrorBody['error']) =>
  new ApiError(status, error.code, error.message, error.loginUrl);

const FALLBACK_MESSAGE = 'Etwas ist schiefgelaufen. Bitte versuche es erneut.';

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (body.error) return fromBody(response.status, body.error);
  } catch {
    // Non-JSON error (proxy down, HTML error page) – fall through.
  }
  return new ApiError(response.status, 'internal', FALLBACK_MESSAGE);
}

type JsonBody = Record<string, unknown> | unknown[];

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: JsonBody | FormData;
}

export async function apiRequest<T>(
  path: string,
  { body, headers, ...init }: RequestOptions = {},
): Promise<T> {
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
  return (await response.json()) as T;
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
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_PREFIX}${path}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response as T);
      const body = xhr.response as Partial<ApiErrorBody> | null;
      reject(
        body?.error
          ? fromBody(xhr.status, body.error)
          : new ApiError(xhr.status, 'internal', FALLBACK_MESSAGE),
      );
    };
    xhr.onerror = () => reject(new ApiError(0, 'internal', 'Keine Verbindung zum Server.'));
    const aborted = () => new DOMException('Upload abgebrochen', 'AbortError');
    xhr.onabort = () => reject(aborted());
    if (signal?.aborted) return reject(aborted());
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(formData);
  });
}
