import type { IconName } from '@/ui';

export type MediaKindId = 'text' | 'audio' | 'video' | 'image';

export interface MediaKind {
  id: MediaKindId;
  label: string;
  icon: IconName;
  enabled: boolean;
}

/**
 * Comment formats. Voice and video arrived with BER-116; images are drawn, with an optional voice
 * memo. The reply fields offer them all.
 */
export const MEDIA_KINDS: readonly MediaKind[] = [
  { id: 'text', label: 'Text', icon: 'notes', enabled: true },
  { id: 'audio', label: 'Audio', icon: 'mic', enabled: true },
  { id: 'video', label: 'Video', icon: 'cameraVideo', enabled: true },
  { id: 'image', label: 'Skizze', icon: 'image', enabled: true },
];

/**
 * The new-comment composer's tabs: text and voice are one – the text tab records a voice comment
 * from its mic button, the text then is its note.
 */
export const COMPOSER_TABS: readonly MediaKind[] = [
  { id: 'text', label: 'Kommentar', icon: 'notesMic', enabled: true },
  ...MEDIA_KINDS.filter((kind) => kind.id === 'video' || kind.id === 'image'),
];

export const MEDIA_SOON = 'bald verfügbar';
