import type { IconName } from '@/ui';

export interface MediaKind {
  id: 'text' | 'audio' | 'video' | 'image';
  label: string;
  icon: IconName;
  enabled: boolean;
}

/** Comment formats. Only text exists so far; the others stay visible until BER-116. */
export const MEDIA_KINDS: readonly MediaKind[] = [
  { id: 'text', label: 'Text', icon: 'notes', enabled: true },
  { id: 'audio', label: 'Audio', icon: 'mic', enabled: false },
  { id: 'video', label: 'Video', icon: 'cameraVideo', enabled: false },
  { id: 'image', label: 'Bild', icon: 'image', enabled: false },
];

export const MEDIA_SOON = 'bald verfügbar';
