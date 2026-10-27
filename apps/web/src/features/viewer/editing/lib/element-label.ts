import type { EditableElement } from '@slider/shared';

const KIND_LABEL: Record<EditableElement['kind'], string> = {
  text: 'Text',
  image: 'Bild',
  shape: 'Form',
  table: 'Tabelle',
  group: 'Gruppe',
  other: 'Element',
};

export const elementLabel = (element: EditableElement) =>
  `${KIND_LABEL[element.kind]}${element.name ? ` „${element.name}“` : ''}`;
