import type {
  DocumentVoiceInfo,
  DocumentVoiceSegmentMeta,
  DocumentVoiceSession,
  VoiceClipMeta,
  VoiceLive,
  VoiceSegmentMeta,
  VoiceSession,
} from '@slider/shared';
import { api, apiRequest } from '../api-client';

/** A piece of speech with what was on screen, to a deck's session or a document's. */
function segmentForm(meta: VoiceSegmentMeta | DocumentVoiceSegmentMeta, audio: Blob): FormData {
  const form = new FormData();
  form.set('meta', JSON.stringify(meta));
  form.set('audio', audio, `speech-${meta.seq}.wav`);
  return form;
}

/**
 * Speaking to the AI: a session on a deck, its pieces of speech, its comments' recordings. A
 * document's session (`document`) goes by the same addresses past its start.
 */
export const voiceApi = {
  start: (deckId: string) => api.post<VoiceSession>(`/decks/${deckId}/voice`),
  get: (sessionId: string) => api.get<VoiceSession>(`/voice/${sessionId}`),
  segment: (sessionId: string, meta: VoiceSegmentMeta, audio: Blob) =>
    api.post<VoiceSession>(`/voice/${sessionId}/segments`, segmentForm(meta, audio)),
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
  document: {
    /** The document's AI by name, and whether it can be spoken to. */
    info: (documentId: string) => api.get<DocumentVoiceInfo>(`/documents/${documentId}/voice`),
    start: (documentId: string) => api.post<DocumentVoiceSession>(`/documents/${documentId}/voice`),
    get: (sessionId: string) => api.get<DocumentVoiceSession>(`/voice/${sessionId}`),
    segment: (sessionId: string, meta: DocumentVoiceSegmentMeta, audio: Blob) =>
      api.post<DocumentVoiceSession>(`/voice/${sessionId}/segments`, segmentForm(meta, audio)),
    flush: (sessionId: string) => api.post<DocumentVoiceSession>(`/voice/${sessionId}/flush`),
    end: (sessionId: string) => api.post<DocumentVoiceSession>(`/voice/${sessionId}/end`),
  },
};
