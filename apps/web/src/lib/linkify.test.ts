import { describe, expect, it } from 'vitest';
import { linkify, shortUrl } from './linkify';

const links = (text: string) =>
  linkify(text)
    .filter((part) => part.kind !== 'text')
    .map((part) => ('href' in part ? `${part.kind} ${part.text} ${part.href}` : ''));

describe('linkify', () => {
  it('finds web addresses, mails and phones – not dates, sums or file names', () => {
    expect(
      links('Siehe www.slider.de/preise, oder (https://de.wikipedia.org/wiki/Foo_(Bar)).'),
    ).toEqual([
      'url www.slider.de/preise https://www.slider.de/preise',
      'url https://de.wikipedia.org/wiki/Foo_(Bar) https://de.wikipedia.org/wiki/Foo_(Bar)',
    ]);
    expect(
      links('Mail an info@firma.de, Tel. 089 1234567, mobil +49 171 2345678, (030) 123 456 78'),
    ).toEqual([
      'email info@firma.de mailto:info@firma.de',
      'phone 089 1234567 tel:+49891234567',
      'phone +49 171 2345678 tel:+491712345678',
      'phone (030) 123 456 78 tel:+493012345678',
    ]);
    expect(
      links('Am 20.11.2026 um 14:30, Rechnung 2026-11-20, PLZ 80331, 1.234.567 €, Nr. 01234'),
    ).toEqual([]);
    expect(links('index.html, Node.js')).toEqual([]);
    // A number inside an address stays the address's; no scheme but these opens.
    expect(links('https://firma.de/089123456 javascript:alert(1)')).toEqual([
      'url https://firma.de/089123456 https://firma.de/089123456',
    ]);
    // Text around stays whole.
    expect(
      linkify('a www.x.de b')
        .map((part) => part.text)
        .join(''),
    ).toBe('a www.x.de b');
    expect(shortUrl('https://click.unsplash.com/click?ZTJBdb9owGIXzWyyxK9l5zodjJKSlCW0xlaQ')).toBe(
      'click.unsplash.com/click?ZTJBdb9owGIXzWyyxK9l5z…',
    );
    expect(shortUrl('https://slider.de/a')).toBe('https://slider.de/a');
  });
});
