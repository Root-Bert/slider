import { writerText } from '@slider/shared';
import { hereLink, hereQuote, useCallHere } from '@/lib/call-here';
import { useWriter, useWriterState } from '../editor/session';
import { entries, isCollapsed, lengthOf, ordered, paragraphOf } from '../lib/model';

/**
 * What Writer shows its person, told to the agent of their call with each turn (`callHere`): the
 * document, the section the caret is in (its heading), and the words one picked. Never the
 * document's text beyond that – the agent reads the file by its id, with the person's rights.
 */
export function WriterHere() {
  const { document: file } = useWriter();
  const { blocks, sel } = useWriterState();
  const lines = [`Writer: Dokument ${hereLink('file', file.id, file.title || file.fileName)}`];
  if (sel) {
    const { from, to } = ordered(blocks, sel);
    const list = entries(blocks);
    const at = list.findIndex((entry) => entry.block.id === from.id);
    const heading = list
      .slice(0, at + 1)
      .findLast((entry) => entry.block.kind === 'heading' || entry.block.kind === 'title');
    const title = heading ? writerText(heading.block).trim() : '';
    if (title) lines.push(`Abschnitt: ${hereQuote(title, 160)}`);
    const block = paragraphOf(blocks, from.id);
    if (block && !isCollapsed(sel)) {
      // Words picked through several paragraphs: those of the first.
      const end = to.id === from.id ? to.offset : lengthOf(block);
      const picked = writerText(block).slice(from.offset, end).trim();
      if (picked) lines.push(`Ausgewählt: ${hereQuote(picked, 400)}`);
    }
  }
  useCallHere('writer', lines.join('\n'));
  return null;
}
