import { writerFormatOf, type WriterBlock, type WriterFormat } from '@slider/shared';

/** A paragraph format's name, as the format list and the layers name it. */
export const FORMAT_LABELS: Record<WriterFormat, string> = {
  text: 'Text',
  title: 'Titel',
  subtitle: 'Untertitel',
  heading1: 'Überschrift 1',
  heading2: 'Überschrift 2',
  heading3: 'Überschrift 3',
  heading4: 'Überschrift 4',
  heading5: 'Überschrift 5',
  heading6: 'Überschrift 6',
  quote: 'Zitat',
  preformatted: 'Vorformatierter Text',
  caption: 'Beschriftung',
};

/**
 * A block's name in „Ebenen“: its first words over what it is (its format, a picture, a table and
 * its size).
 */
export function blockLabel(block: WriterBlock): { name: string; kind: string } {
  if (block.type === 'table') {
    const words = block.rows
      .flat()
      .flatMap((cell) => cell.blocks)
      .flatMap((each) => (each.type === 'paragraph' ? each.runs.map((run) => run.text) : []))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      name: words.slice(0, 80) || 'Leere Tabelle',
      kind: `Tabelle ${block.rows.length} × ${block.columns.length}`,
    };
  }
  const words = block.runs
    .map((run) => run.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (block.pictures?.length) {
    return { name: words.slice(0, 80) || 'Bild', kind: words ? 'Bild und Text' : 'Bild' };
  }
  return { name: words.slice(0, 80) || 'Leer', kind: FORMAT_LABELS[writerFormatOf(block)] };
}
