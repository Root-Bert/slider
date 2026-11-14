import { afterEach, describe, expect, it } from 'vitest';
import { RecordingMailer } from '../src/mail/mailer';
import {
  cookiePair,
  createTestContext,
  sessionCookieFrom,
  testConfig,
  type TestContext,
} from './helpers';

let ctx: TestContext;
afterEach(() => ctx.cleanup());

describe('login by mail (BER-168)', () => {
  it('the link signs in only in the browser that asked; elsewhere the mail’s code does, typed there', async () => {
    const mailer = new RecordingMailer();
    ctx = await createTestContext({
      config: { auth: { ...testConfig().auth, devLogin: false, signup: 'open' } },
      mailer,
      instanceAdmin: true,
    });
    const start = await ctx.request('/api/auth/email/start', {
      method: 'POST',
      json: { email: 'anna@firma.de', returnTo: '/' },
    });
    expect(start.status).toBe(204);
    const asked = cookiePair(start, 'slider_email_login');
    const text = mailer.sent[0]?.text ?? '';
    const token = /anmelden\/([\w-]+)/.exec(text)?.[1] ?? '';
    const code = /ein: (\d{6})/.exec(text)?.[1] ?? '';
    expect(token).not.toBe('');
    expect(code).toMatch(/^\d{6}$/);
    expect(mailer.sent[0]?.html).toContain(code);

    const confirm = (cookie: string) =>
      ctx.request('/api/auth/email/confirm', { method: 'POST', json: { token }, cookie });
    const typed = (value: string, cookie: string) =>
      ctx.request('/api/auth/email/code', { method: 'POST', json: { code: value }, cookie });

    // Opened from the mail in another browser (the desktop app asked): refused, pointing to the code.
    const elsewhere = await confirm('');
    expect(elsewhere.status).toBe(403);
    expect(await elsewhere.json()).toMatchObject({
      error: { message: expect.stringContaining('Code') },
    });
    // The code is no use outside the browser that asked, nor a wrong one in it.
    expect((await typed(code, '')).status).toBe(400);
    const wrong = code === '000000' ? '000001' : '000000';
    expect((await typed(wrong, asked)).status).toBe(400);
    expect((await typed('12a', asked)).status).toBe(400);

    // Typed where it was asked for – with a space as in the mail: signed in, the account made.
    const signedIn = await typed(`${code.slice(0, 3)} ${code.slice(3)}`, asked);
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toEqual({ redirectTo: '/', newAccount: true });
    expect(sessionCookieFrom(signedIn)).toBeTruthy();
    // Used up: neither the code nor the link signs in again.
    expect((await typed(code, asked)).status).toBe(400);
    expect((await confirm(asked)).status).toBe(410);

    // Guessing: past ten tries per address the browser's open links are used up, the right
    // code with them.
    const again = await ctx.request('/api/auth/email/start', {
      method: 'POST',
      json: { email: 'anna@firma.de' },
      cookie: asked,
    });
    expect(again.status).toBe(204);
    const next = /ein: (\d{6})/.exec(mailer.sent[1]?.text ?? '')?.[1] ?? '';
    const miss = next === '000000' ? '000001' : '000000';
    const tries: number[] = [];
    for (let i = 0; i < 9; i += 1) tries.push((await typed(miss, asked)).status);
    // Two tries were made above.
    expect(tries).toEqual([400, 400, 400, 400, 400, 400, 400, 400, 429]);
    expect((await typed(next, asked)).status).toBe(400);
  });
});
