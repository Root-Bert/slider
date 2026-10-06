import { describe, expect, it } from 'vitest';
import { fnv1a32, normaliseText, textHash } from '../src/hash';
import { attr, child, children, findByLocalName, parseXml, XmlSyntaxError } from '../src/xml';

describe('parseXml', () => {
  it('keeps document order and decodes entities', () => {
    const root = parseXml(
      '<?xml version="1.0"?><p:spTree><p:sp n="1"/><p:pic n="2"/><p:sp n="3"/>' +
        '<a:t>Gr&#xFC;&#223;e &amp; &lt;mehr&gt; &quot;x&quot;</a:t></p:spTree>',
    );

    expect(root.children.map((element) => attr(element, 'n') ?? element.name)).toEqual([
      '1',
      '2',
      '3',
      'a:t',
    ]);
    expect(children(root, 'p:sp')).toHaveLength(2);
    expect(child(root, 'a:t')?.text).toBe('Grüße & <mehr> "x"');
  });

  it('preserves significant whitespace in text', () => {
    expect(parseXml('<a:t>  zwei  Leerzeichen </a:t>').text).toBe('  zwei  Leerzeichen ');
  });

  it('finds descendants by local name regardless of prefix', () => {
    const root = parseXml('<x:root><y:list><ac:spMk id="7"/></y:list></x:root>');
    expect(attr(findByLocalName(root, 'spMk'), 'id')).toBe('7');
  });

  it('rejects malformed documents', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlSyntaxError);
  });
});

describe('text hash', () => {
  it('implements FNV-1a 32 bit', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
    expect(fnv1a32('a')).toBe('e40c292c');
    expect(fnv1a32('foobar')).toBe('bf9cf968');
  });

  it('normalises case and whitespace before hashing', () => {
    expect(normaliseText('  Umsatz\n\tnach   REGION ')).toBe('umsatz nach region');
    expect(textHash('Umsatz nach Region')).toBe(textHash(' umsatz\nnach region'));
  });
});
