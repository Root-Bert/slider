import { API_PREFIX } from '@slider/shared';
import { accountHeader, proxyError, unreachableError, ApiError } from '../api-client';

/**
 * POSTs `body` and reads the `text/event-stream` answer, one JSON per event, until it ends.
 * Refusals throw (as `ApiError`) before anything streams; `signal` aborting closes the stream.
 */
export async function postEventStream<E>(
  path: string,
  body: unknown,
  onEvent: (event: E) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...accountHeader(),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return;
    throw error instanceof ApiError ? error : unreachableError();
  }
  if (!response.ok) {
    try {
      const body = (await response.json()) as { error?: { code: never; message: string } };
      if (body.error) throw new ApiError(response.status, body.error.code, body.error.message);
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }
    throw proxyError(response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) onEvent(JSON.parse(data) as E);
      }
    }
  } catch (error) {
    if (signal?.aborted) return;
    throw error instanceof ApiError ? error : unreachableError();
  }
}
