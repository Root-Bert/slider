import type { WriterTemplate } from '@slider/shared';
import type { IconName } from '@/ui';

/** What „Neues Dokument“ starts from. */
export const DOCUMENT_TEMPLATES: {
  template: WriterTemplate;
  label: string;
  icon: IconName;
  /** What it holds, for the library. */
  about: string;
  /** Its sheet in small: the lines it starts with. */
  lines: readonly ('title' | 'heading' | 'text' | 'short' | 'gap')[];
}[] = [
  {
    template: 'plain',
    label: 'Dokument',
    icon: 'article',
    about: 'Ein Blatt zum Losschreiben',
    lines: ['text', 'text', 'short'],
  },
  {
    template: 'letter',
    label: 'Brief',
    icon: 'send',
    about: 'Absender, Empfänger, Betreff, Gruß',
    lines: [
      'short',
      'gap',
      'short',
      'short',
      'short',
      'gap',
      'short',
      'heading',
      'text',
      'text',
      'short',
    ],
  },
  {
    template: 'report',
    label: 'Bericht',
    icon: 'textSnippet',
    about: 'Zusammenfassung, Ausgangslage, Ergebnisse, nächste Schritte',
    lines: ['title', 'heading', 'text', 'short', 'heading', 'text', 'short', 'heading', 'text'],
  },
  {
    template: 'minutes',
    label: 'Protokoll',
    icon: 'formatListBulleted',
    about: 'Themen, Beschlüsse, Aufgaben',
    lines: ['title', 'short', 'heading', 'text', 'heading', 'text', 'heading', 'short'],
  },
];
