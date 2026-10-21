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

  it('strips characters Postgres cannot store from text and attributes', () => {
    const root = parseXml(
      '<a t="x&#0;y&#x1F;&#xD800;"><b>hi&#0;&#xDC00;\u0000\u0007&#xB;&#x1F600;&#xD83D;&#xDE00;\t\n</b></a>',
    );

    expect(attr(root, 't')).toBe('xy');
    expect(child(root, 'b')?.text).toBe('hi 😀😀\t\n');
  });

  it('rejects malformed documents', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlSyntaxError);
  });

  it('reports what the parser refuses as a syntax error, too', () => {
    const external = '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>';
    expect(() => parseXml(external)).toThrow(XmlSyntaxError);
    expect(() => parseXml('<a><__proto__ x="1"/></a>')).toThrow(XmlSyntaxError);
    expect(() => parseXml('<a>'.repeat(1000) + '</a>'.repeat(1000))).toThrow(XmlSyntaxError);
  });

  it('never expands DTD entities', () => {
    const laughs =
      '<!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>' +
      '<x y="&b;">&b;</x>';
    const root = parseXml(laughs);
    expect(root.text).toBe('&b;');
    expect(attr(root, 'y')).toBe('&b;');
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
