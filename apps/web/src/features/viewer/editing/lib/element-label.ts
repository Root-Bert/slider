import type { EditableElement, SlideOperation } from '@slider/shared';

const KIND_LABEL: Record<EditableElement['kind'], string> = {
  text: 'Text',
  image: 'Bild',
  shape: 'Form',
  table: 'Tabelle',
  group: 'Gruppe',
  line: 'Linie',
  other: 'Element',
};

export const elementLabel = (element: EditableElement) =>
  `${KIND_LABEL[element.kind]}${element.name ? ` „${element.name}“` : ''}`;

/**
 * Locks what is given – or unlocks it when every one is locked already (the format panel's and the
 * list's lock, ⇧⌘L).
 */
export const lockOperations = (elements: readonly EditableElement[]): SlideOperation[] => {
  const locked = elements.every((element) => element.locked);
  return elements.map((element) => ({ type: 'setLocked', elementId: element.id, locked: !locked }));
};

/** The lock's button (format panel, list of layers): what it does to an element locked or not. */
export const lockButton = (locked: boolean) =>
  locked
    ? {
        icon: 'lock' as const,
        label: 'Entsperren',
        title: 'Entsperren (⇧⌘L) – auf der Folie wieder anklick- und verschiebbar',
      }
    : {
        icon: 'lockOpen' as const,
        label: 'Sperren',
        title:
          'Sperren (⇧⌘L) – auf der Folie nicht mehr anklick- oder verschiebbar, darauf lässt sich zeichnen',
      };
