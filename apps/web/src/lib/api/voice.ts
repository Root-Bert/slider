import type { VoiceClipMeta, VoiceLive, VoiceSegmentMeta, VoiceSession } from '@slider/shared';
import { api, apiRequest } from '../api-client';

/** Speaking to the AI: a session on a deck, its pieces of speech, its comments' recordings. */
export const voiceApi = {
  start: (deckId: string) => api.post<VoiceSession>(`/decks/${deckId}/voice`),
  get: (sessionId: string) => api.get<VoiceSession>(`/voice/${sessionId}`),
  segment: (sessionId: string, meta: VoiceSegmentMeta, audio: Blob) => {
    const form = new FormData();
    form.set('meta', JSON.stringify(meta));
    form.set('audio', audio, `speech-${meta.seq}.wav`);
    return api.post<VoiceSession>(`/voice/${sessionId}/segments`, form);
  },
  /** Where to stream the microphone for the words live – `null` without a `live` key. */
  live: (sessionId: string) => api.post<VoiceLive>(`/voice/${sessionId}/live`),
  flush: (sessionId: string) => api.post<VoiceSession>(`/voice/${sessionId}/flush`),
  end: (sessionId: string) => api.post<VoiceSession>(`/voice/${sessionId}/end`),
  recording: (sessionId: string, commentId: string, meta: VoiceClipMeta, audio: Blob) => {
    const form = new FormData();
    form.set('meta', JSON.stringify(meta));
    form.set('audio', audio, audio.type === 'audio/mp4' ? 'comment.m4a' : 'comment.webm');
    return apiRequest<unknown>(`/voice/${sessionId}/items/${commentId}/recording`, {
      method: 'PUT',
      body: form,
    });
  },
};
