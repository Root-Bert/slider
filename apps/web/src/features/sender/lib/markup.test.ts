import { createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { markupLines, markupPlain, markupRuns, markupTrim } from './markup';
import { $getMarkup, $setMarkup, RICH_MARKUP_NODES } from './rich-markup';

/** The text put into the editor and read back out of it. */
function throughEditor(text: string): string {
  const editor = createEditor({
    nodes: RICH_MARKUP_NODES,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(() => $setMarkup(text), { discrete: true });
  return editor.getEditorState().read($getMarkup);
}

describe('Sender markup', () => {
  it('reads lines and marks as MessageText shows them', () => {
    expect(
      markupLines('# Titel\n## Teil\n> zitiert\n- a\n3. b\n```\n- kein Punkt\n```\n#tag').map(
        (line) => line.kind,
      ),
    ).toEqual(['heading', 'heading', 'quote', 'bullet', 'number', 'code', 'code', 'code', 'text']);
    expect(
      markupRuns(
        '**fett _und kursiv_** <u>unter</u> [Seite](https://a.de/x) `**roh**` snake_case_name',
      ),
    ).toEqual([
      {
        kind: 'bold',
        runs: [
          { kind: 'text', text: 'fett ' },
          { kind: 'italic', runs: [{ kind: 'text', text: 'und kursiv' }] },
        ],
      },
      { kind: 'text', text: ' ' },
      { kind: 'underline', runs: [{ kind: 'text', text: 'unter' }] },
      { kind: 'text', text: ' ' },
      { kind: 'link', url: 'https://a.de/x', runs: [{ kind: 'text', text: 'Seite' }] },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: '**roh**' },
      { kind: 'text', text: ' snake_case_name' },
    ]);
    // Not a link where the address is not the web's.
    expect(markupRuns('[x](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[x](javascript:alert(1))' },
    ]);
    expect(
      markupPlain('# Plan\n**Montag** um `8`\n```js\nlet a\n```\n- [Liste](https://a.de)'),
    ).toBe('Plan\nMontag um 8\nlet a\nListe');
    // Italic inside a word as the field writes it; a list point or quote left empty is not sent.
    expect(markupRuns('wo*rt*e')[1]).toEqual({
      kind: 'italic',
      runs: [{ kind: 'text', text: 'rt' }],
    });
    expect(markupTrim('Liste:\n- a\n- \n>  \n')).toBe('Liste:\n- a');
    expect(markupTrim('Wie viele?\n3.')).toBe('Wie viele?\n3.');
    expect([markupTrim('- '), markupTrim('>')]).toEqual(['', '']);
    // Web addresses stay whole, marks and brackets in them too; lines ended \r\n read the same.
    expect(
      markupRuns('https://x.de/a*b*c und www.x.de/_next_/y [Foo](https://w.de/Foo_(bar))'),
    ).toEqual([
      { kind: 'text', text: 'https://x.de/a*b*c und www.x.de/_next_/y ' },
      { kind: 'link', url: 'https://w.de/Foo_(bar)', runs: [{ kind: 'text', text: 'Foo' }] },
    ]);
    expect(markupLines('- a\r\n> b').map((line) => line.kind)).toEqual(['bullet', 'quote']);
  });

  it('comes out of the editor as it went in', () => {
    for (const text of [
      '',
      'Hallo',
      'zwei\nZeilen\n\nund eine leere',
      '@Anna Schmidt schau mal, anna@firma.de und https://slider.app/x?a=1.',
      'snake_case und 2 * 3 und ~ungefähr',
      '**fett** _kursiv_ <u>unter</u> ~~durch~~ `Code` **_beides_**',
      '[Seite](https://a.de/x) und https://b.de',
      '# Titel\n## Teil\ntext',
      '> eins\n> zwei\n>\ndanach',
      '- a\n- **b**\n\n1. eins\n2. zwei',
      '3. drei\n4. vier\n- dann Punkte',
      '```\n**roh** und - kein Punkt\n\n# keine Überschrift\n```\nund weiter',
      'ein ``` ohne Ende\n- Punkt',
      'wo*rt*e und *@Anna* und **_beides_**',
      '*snake_case* und **a**_b_ und [Foo](https://w.de/Foo_(bar))',
    ])
      expect(throughEditor(text)).toBe(text);
    // Ways of writing the same are written the one way.
    expect(throughEditor('* a\n• b\n*kursiv*\n### klein\n_@Anna_')).toBe(
      '- a\n- b\n_kursiv_\n## klein\n*@Anna*',
    );
  });
});
