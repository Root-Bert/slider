import { describe, expect, it } from 'vitest';
import { readColorScheme, resolveColor, solidFillOf } from '../src/colors';
import { parseXml } from '../src/xml';

const theme = parseXml(`
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="nothex"/></a:accent2>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
    </a:clrScheme>
  </a:themeElements>
</a:theme>`);

const scheme = readColorScheme(theme);
const fill = (inner: string) => parseXml(`<a:solidFill>${inner}</a:solidFill>`);

describe('readColorScheme', () => {
  it('reads every slot with a literal colour, without the prefix, lower-cased', () => {
    expect(Object.fromEntries(scheme)).toEqual({
      dk1: '#000000',
      lt1: '#ffffff',
      dk2: '#44546a',
      lt2: '#e7e6e6',
      accent1: '#4472c4',
      hlink: '#0563c1',
    });
  });

  it('is empty without a theme or colour scheme', () => {
    expect(readColorScheme(null).size).toBe(0);
    expect(readColorScheme(parseXml('<a:theme><a:themeElements/></a:theme>')).size).toBe(0);
  });
});

describe('resolveColor', () => {
  it('takes srgbClr and the last colour of sysClr', () => {
    expect(resolveColor(fill('<a:srgbClr val="FF0000"/>'), scheme)).toBe('#ff0000');
    expect(resolveColor(fill('<a:sysClr val="windowText" lastClr="1F1F1F"/>'), scheme)).toBe(
      '#1f1f1f',
    );
  });

  it('prefers a literal colour over a scheme colour', () => {
    expect(
      resolveColor(fill('<a:schemeClr val="accent1"/><a:srgbClr val="00FF00"/>'), scheme),
    ).toBe('#00ff00');
  });

  it('maps tx1/bg1/tx2/bg2 through the default colour map', () => {
    expect(resolveColor(fill('<a:schemeClr val="tx1"/>'), scheme)).toBe('#000000');
    expect(resolveColor(fill('<a:schemeClr val="bg1"/>'), scheme)).toBe('#ffffff');
    expect(resolveColor(fill('<a:schemeClr val="tx2"/>'), scheme)).toBe('#44546a');
    expect(resolveColor(fill('<a:schemeClr val="bg2"/>'), scheme)).toBe('#e7e6e6');
  });

  it('looks up other scheme names directly and ignores colour transforms', () => {
    expect(
      resolveColor(
        fill('<a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr>'),
        scheme,
      ),
    ).toBe('#4472c4');
  });

  it('returns null for unknown slots, invalid hex and missing colours', () => {
    expect(resolveColor(fill('<a:schemeClr val="accent6"/>'), scheme)).toBeNull();
    expect(resolveColor(fill('<a:schemeClr val="accent1"/>'), new Map())).toBeNull();
    expect(resolveColor(fill('<a:srgbClr val="F00"/>'), scheme)).toBeNull();
    expect(resolveColor(fill('<a:sysClr val="window"/>'), scheme)).toBeNull();
    expect(resolveColor(fill(''), scheme)).toBeNull();
    expect(resolveColor(undefined, scheme)).toBeNull();
  });
});

describe('solidFillOf', () => {
  it('reads the solidFill child of an element', () => {
    const properties = parseXml(
      '<a:rPr><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr>',
    );
    expect(solidFillOf(properties, scheme)).toBe('#000000');
  });

  it('returns null without a solid fill', () => {
    expect(solidFillOf(parseXml('<a:rPr><a:noFill/></a:rPr>'), scheme)).toBeNull();
    expect(solidFillOf(undefined, scheme)).toBeNull();
  });
});
