import type { IconName } from '@/ui';

export type MediaKindId = 'text' | 'audio' | 'video' | 'image';

export interface MediaKind {
  id: MediaKindId;
  label: string;
  icon: IconName;
  enabled: boolean;
}

/** Comment formats. Voice and video arrived with BER-116; images follow. */
export const MEDIA_KINDS: readonly MediaKind[] = [
  { id: 'text', label: 'Text', icon: 'notes', enabled: true },
  { id: 'audio', label: 'Audio', icon: 'mic', enabled: true },
  { id: 'video', label: 'Video', icon: 'cameraVideo', enabled: true },
  { id: 'image', label: 'Bild', icon: 'image', enabled: false },
];

export const MEDIA_SOON = 'bald verfügbar';
