import {
  API_PREFIX,
  type AskMaterialInput,
  type MaterialAnswerEvent,
  type MaterialQuestion,
} from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, proxyError, unreachableError, ApiError } from '../api-client';
import { queryKeys } from './keys';

/** The threads under the material page's notes – the AI's answers and the replies – everyone's. */
export const useMaterialQuestions = (deckId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.materialQuestions(deckId),
    queryFn: () =>
      api.get<MaterialQuestion[]>(`/decks/${encodeURIComponent(deckId)}/material-questions`),
    enabled,
  });

/**
 * Asks and reads the answer as it is written (`text/event-stream` of `MaterialAnswerEvent`s).
 * Refusals (no AI key, no access) throw before anything streams; `signal` aborting closes the
 * stream, which stops the answer on the server.
 */
export const askMaterial = (
  deckId: string,
  input: Partial<AskMaterialInput> & Pick<AskMaterialInput, 'id' | 'noteId' | 'question'>,
  onEvent: (event: MaterialAnswerEvent) => void,
  signal?: AbortSignal,
): Promise<void> =>
  postEventStream(
    `/decks/${encodeURIComponent(deckId)}/material-questions`,
    input,
    onEvent,
    signal,
  );

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
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
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

/** „Stoppen“: the answer ends where it is, kept as far as it got. */
export const stopMaterialAnswer = (questionId: string) =>
  api.post<void>(`/material-questions/${encodeURIComponent(questionId)}/stop`);

/**
 * „Antwort löschen“: the AI's answer goes, the note stays (a reply too, not asked any more);
 * `all`: a reply with its answer, by its writer.
 */
export function useDeleteMaterialAnswer(deckId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.materialQuestions(deckId);
  return useMutation({
    mutationFn: ({ entry, part }: { entry: MaterialQuestion; part: 'answer' | 'all' }) =>
      api.delete(
        `/material-questions/${encodeURIComponent(entry.id)}${part === 'all' ? '?part=all' : ''}`,
      ),
    onMutate: ({ entry, part }) =>
      queryClient.setQueryData<MaterialQuestion[]>(key, (all = []) =>
        entry.kind === 'reply' && part === 'answer'
          ? all.map((each) =>
              each.id === entry.id ? { ...each, answer: '', state: null, error: null } : each,
            )
          : all.filter((each) => each.id !== entry.id),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
