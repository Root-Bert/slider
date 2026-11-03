import type { NotesParagraph } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { notesFromDom, notesFromText, notesToHtml } from './notes-html';

const read = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  return notesFromDom(root);
};

describe('speaker notes in the editor', () => {
  it('reads back what it shows, and what the browser types into it', () => {
    const notes: NotesParagraph[] = [
      {
        runs: [
          { text: 'Erst ' },
          { text: 'laut', bold: true },
          { text: ' & <klar>', italic: true },
        ],
      },
      { runs: [] },
      { runs: [{ text: 'Punkt', underline: true }], list: { kind: 'bullet', level: 1 } },
      { runs: [{ text: 'tiefer', strike: true }], list: { kind: 'bullet', level: 2 } },
      { runs: [{ text: 'Eins' }], list: { kind: 'number', level: 1 } },
      { runs: [{ text: 'Zwei', bold: true, italic: true }], list: { kind: 'number', level: 1 } },
      { runs: [{ text: 'Schluss' }] },
    ];
    expect(read(notesToHtml(notes))).toEqual(notes);
    // As a browser types: the first line bare, the next in divs, an empty line a <br>, a deeper
    // level as a list right in the list, bold as a style (Safari), trailing empty lines dropped.
    expect(
      read(
        'Hallo<div><br></div><div><span style="font-weight: bold">fett</span></div>' +
          '<div><ul><li>a</li><ul><li>b</li></ul></ul></div><div><br></div>',
      ),
    ).toEqual([
      { runs: [{ text: 'Hallo' }] },
      { runs: [] },
      { runs: [{ text: 'fett', bold: true }] },
      { runs: [{ text: 'a' }], list: { kind: 'bullet', level: 1 } },
      { runs: [{ text: 'b' }], list: { kind: 'bullet', level: 2 } },
    ]);
    expect(notesFromText('Erst\n\nDann')).toEqual([
      { runs: [{ text: 'Erst' }] },
      { runs: [] },
      { runs: [{ text: 'Dann' }] },
    ]);
  });
});
