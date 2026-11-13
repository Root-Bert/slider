import { describe, expect, it } from 'vitest';
import { markdownToRich, richPlainText } from '../src/markdown-rich';

type Node = {
  type: string;
  children?: Node[];
  text?: string;
  format?: number;
  [key: string]: unknown;
};
const blocks = (markdown: string, spaced = false) =>
  (markdownToRich(markdown, { spaced }) as { root: Node }).root.children!;

describe('Markdown as a sticker', () => {
  it('turns headings, lists, emphasis and links into Lexical nodes – spaced for stickers, plain text again', () => {
    const [heading, para, bullets, numbers] = blocks(
      '# Ergebnis\n\nUmsatz **4,2 Mio.** und *kursiv*, siehe [Quelle](https://example.org).\n\n- eins\n  - darin\n- zwei\n1. erstens\n2. zweitens',
    );
    expect(heading).toMatchObject({ type: 'heading', tag: 'h1' });
    expect(
      para!.children!.map((child) => [child.type, child.text ?? '', Number(child.format) || 0]),
    ).toEqual([
      ['text', 'Umsatz ', 0],
      ['text', '4,2 Mio.', 1],
      ['text', ' und ', 0],
      ['text', 'kursiv', 2],
      ['text', ', siehe ', 0],
      ['link', '', 0],
      ['text', '.', 0],
    ]);
    expect(para!.children![5]).toMatchObject({ url: 'https://example.org' });
    // A list of another kind is its own list, the bullets kept; a nested one sits in its item.
    expect(bullets).toMatchObject({ type: 'list', listType: 'bullet' });
    expect(bullets!.children).toHaveLength(3);
    expect(bullets!.children![1]!.children![0]).toMatchObject({ type: 'list' });
    expect(numbers).toMatchObject({ type: 'list', listType: 'number' });
    expect(numbers!.children).toHaveLength(2);

    // Words with underscores stay words; a bare address is a link; spaced: empty lines between.
    const [snake] = blocks('file_name_v2 auf https://slider.app/x');
    expect(snake!.children!.map((child) => child.type)).toEqual(['text', 'link']);
    expect(snake!.children![0]!.text).toBe('file_name_v2 auf ');
    expect(blocks('a\n\nb', true).map((block) => block.children?.length ?? 0)).toEqual([1, 0, 1]);
    expect(richPlainText(markdownToRich('# T\n\n- a\n- b'))).toBe('T\na\nb');
  });
});
