import { afterEach, describe, expect, it } from 'vitest';
import { RecordingMailer } from '../src/mail/mailer';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext;
afterEach(() => ctx.cleanup());

const send = (json: Record<string, unknown>) =>
  ctx.request('/api/contact', { method: 'POST', json });

describe('contact form', () => {
  it('mails the message to CONTACT_EMAIL, replies go to the sender', async () => {
    const mailer = new RecordingMailer();
    ctx = await createTestContext({
      instanceAdmin: true,
      mailer,
      config: { contactEmail: 'slider@bertro.dev' },
    });

    const res = await send({ name: 'Anna', email: 'anna@firma.de', message: 'Hallo!' });
    expect(res.status).toBe(202);
    expect(mailer.sent).toEqual([
      expect.objectContaining({
        to: 'slider@bertro.dev',
        replyTo: 'anna@firma.de',
        subject: 'Kontaktformular: Anna',
        text: expect.stringContaining('Hallo!'),
      }),
    ]);
  });

  it('answers a bot like a person but sends nothing', async () => {
    const mailer = new RecordingMailer();
    ctx = await createTestContext({
      instanceAdmin: true,
      mailer,
      config: { contactEmail: 'slider@bertro.dev' },
    });

    const res = await send({ email: 'bot@spam.io', message: 'Buy', website: 'https://spam.io' });
    expect(res.status).toBe(202);
    expect(mailer.sent).toEqual([]);
  });

  it('rejects an empty message and is off without CONTACT_EMAIL', async () => {
    ctx = await createTestContext({
      instanceAdmin: true,
      mailer: new RecordingMailer(),
      config: { contactEmail: 'slider@bertro.dev' },
    });
    expect((await send({ email: 'anna@firma.de', message: '  ' })).status).toBe(400);
    await ctx.cleanup();

    ctx = await createTestContext({ instanceAdmin: true, mailer: new RecordingMailer() });
    expect((await send({ email: 'anna@firma.de', message: 'Hallo' })).status).toBe(503);
  });
});
