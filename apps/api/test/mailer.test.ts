import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { SMTP_TIMEOUTS, SmtpMailer } from '../src/mail/mailer';

/** A mail port that accepts connections and then says nothing – like a filtering firewall. */
let server: Server | null = null;
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function silentSmtpPort(): Promise<number> {
  server = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('SmtpMailer', () => {
  it('gives up within seconds on a server that never answers (no 2-minute hang)', async () => {
    expect(SMTP_TIMEOUTS.connectionTimeout).toBeLessThanOrEqual(15_000);
    expect(SMTP_TIMEOUTS.greetingTimeout).toBeLessThanOrEqual(15_000);
    expect(SMTP_TIMEOUTS.socketTimeout).toBeLessThanOrEqual(30_000);

    const port = await silentSmtpPort();
    const mailer = new SmtpMailer(
      { url: `smtp://user:pass@127.0.0.1:${port}`, from: 'Slider <slider@firma.de>' },
      { connectionTimeout: 200, greetingTimeout: 200, socketTimeout: 400 },
    );
    const started = Date.now();
    await expect(
      mailer.send({ to: 'lena@firma.de', subject: 'Einladung', text: 'Hallo' }),
    ).rejects.toThrow(/greeting|timeout/i);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
