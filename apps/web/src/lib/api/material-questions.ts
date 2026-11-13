import { API_PREFIX, type MaterialAnswerEvent, type MaterialQuestion } from '@slider/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, proxyError, unreachableError, ApiError } from '../api-client';
import { queryKeys } from './keys';

/** The AI's answers to the material page's notes asked with ⌘↵ – everyone sees them under the note. */
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
export async function askMaterial(
  deckId: string,
  input: { id: string; noteId: string; question: string },
  onEvent: (event: MaterialAnswerEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}/decks/${encodeURIComponent(deckId)}/material-questions`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(input),
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
        if (data) onEvent(JSON.parse(data) as MaterialAnswerEvent);
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

/** „Antwort löschen“: a note's answer goes, the note stays. */
export function useDeleteMaterialAnswer(deckId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.materialQuestions(deckId);
  return useMutation({
    mutationFn: (questionId: string) =>
      api.delete(`/material-questions/${encodeURIComponent(questionId)}`),
    onMutate: (questionId) =>
      queryClient.setQueryData<MaterialQuestion[]>(key, (all = []) =>
        all.filter((each) => each.id !== questionId),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
