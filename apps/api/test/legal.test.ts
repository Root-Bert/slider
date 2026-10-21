import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inviteMail } from '../src/mail/mailer';
import { createTestContext, signedInUser, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext({ instanceAdmin: true });
});
afterEach(() => ctx.cleanup());

describe('privacy policy and imprint (BER-141)', () => {
  it('anyone reads them, only the instance admin writes them; blank means none', async () => {
    expect(await (await ctx.request('/api/legal')).json()).toEqual({
      privacy: null,
      imprint: null,
    });
    const person = await signedInUser(ctx, { name: 'Anna', email: 'anna@firma.de' });
    const put = (json: unknown, cookie?: string) =>
      ctx.request('/api/legal', { method: 'PUT', json, cookie });
    expect((await put({ privacy: '# X', imprint: null }, person.cookie)).status).toBe(403);

    const saved = await put({ privacy: '# Datenschutz\n\nText', imprint: '  \n ' });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ privacy: '# Datenschutz\n\nText', imprint: null });
    expect(await (await ctx.request('/api/legal')).json()).toEqual({
      privacy: '# Datenschutz\n\nText',
      imprint: null,
    });
  });

  it('invite mails link imprint and privacy policy of their instance, other mails not', () => {
    const input = {
      to: 'anna@firma.de',
      url: 'https://slider.firma.de/join/abc',
      subject: 'S',
      heading: 'H',
      intro: 'I',
      button: 'B',
      outro: 'O',
    };
    const mail = inviteMail({ ...input, legalLinks: true });
    expect(mail.text).toContain('Impressum: https://slider.firma.de/impressum');
    expect(mail.html).toContain('href="https://slider.firma.de/datenschutz"');
    const plain = inviteMail(input);
    expect(plain.text).not.toContain('Impressum');
    expect(plain.html).not.toContain('/datenschutz');
  });
});
