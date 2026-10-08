import { createTransport, type Transporter } from 'nodemailer';
import type { SmtpConfig } from '../config';
import type { Logger } from '../logger';

/** Outgoing e-mail (BER-129): magic links and workspace invitations. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  /** `false` when no SMTP server is configured – magic links are then not offered. */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Sends through SMTP (`SMTP_URL`, e.g. `smtps://user:pass@host:465`). */
export class SmtpMailer implements Mailer {
  readonly configured = true;
  private readonly transport: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transport = createTransport(config.url);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.from, ...message });
  }
}

/** Without SMTP: nothing is sent, and callers check `configured` before promising a mail. */
export class NullMailer implements Mailer {
  readonly configured = false;
  constructor(private readonly log?: Logger) {}

  async send(message: MailMessage): Promise<void> {
    this.log?.warn(`No SMTP configured – mail to ${message.to} ("${message.subject}") not sent.`);
  }
}

export interface DevMail extends MailMessage {
  sentAt: string;
}

/**
 * Development without SMTP: logs every mail (with its links and codes) to the console and keeps
 * the last {@link DevMailer.KEEP} for `GET /api/dev/mails`, so e-mail login works right away.
 * Never used in production.
 */
export class DevMailer implements Mailer {
  static readonly KEEP = 20;
  readonly configured = true;
  private readonly mails: DevMail[] = [];

  constructor(
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async send(message: MailMessage): Promise<void> {
    this.mails.unshift({ ...message, sentAt: this.now().toISOString() });
    this.mails.length = Math.min(this.mails.length, DevMailer.KEEP);
    this.log.info(
      [
        `[dev mail] to ${message.to}: ${message.subject}`,
        ...message.text
          .trim()
          .split('\n')
          .map((line) => `  ${line}`),
        '  (all recent mails: /api/dev/mails)',
      ].join('\n'),
    );
  }

  /** Newest first. */
  list(): DevMail[] {
    return [...this.mails];
  }
}

/** For tests: keeps every message. */
export class RecordingMailer implements Mailer {
  readonly configured = true;
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

/** SMTP when configured; without it a {@link DevMailer} in development, else nothing. */
export const createMailer = (
  config: SmtpConfig | null,
  log: Logger,
  env: 'development' | 'production' | 'test' = 'production',
): Mailer => {
  if (config) return new SmtpMailer(config);
  return env === 'development' ? new DevMailer(log) : new NullMailer(log);
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A short German mail with one button; plain text and HTML. */
export function buttonMail(input: {
  to: string;
  subject: string;
  intro: string;
  button: string;
  url: string;
  outro: string;
}): MailMessage {
  return {
    to: input.to,
    subject: input.subject,
    text: `${input.intro}\n\n${input.button}: ${input.url}\n\n${input.outro}\n`,
    html: `<p>${escapeHtml(input.intro)}</p><p><a href="${escapeHtml(input.url)}">${escapeHtml(input.button)}</a></p><p style="color:#666">${escapeHtml(input.outro)}</p>`,
  };
}

/**
 * The login mail: a 6-digit code to type into the open login page and a button for the link –
 * whichever is handier (the code helps when the mail is read on another device).
 */
export function loginMail(input: { to: string; code: string; url: string }): MailMessage {
  const spaced = `${input.code.slice(0, 3)} ${input.code.slice(3)}`;
  const intro = 'Gib diesen Code auf der Anmeldeseite von Slider ein:';
  const linkIntro = 'Oder melde dich direkt über diesen Link an:';
  const outro =
    'Code und Link gelten 15 Minuten und nur einmal. Wenn du dich nicht anmelden wolltest, ignoriere diese Mail einfach.';
  const url = escapeHtml(input.url);
  return {
    to: input.to,
    subject: `${spaced} ist dein Anmeldecode für Slider`,
    text: `${intro}\n\n    ${spaced}\n\n${linkIntro}\n${input.url}\n\n${outro}\n`,
    html: `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Anmelden bei Slider</title></head>
<body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b1b1a;">
<tr><td style="padding:32px 32px 8px;font-size:15px;font-weight:600;letter-spacing:-0.01em;">Slider</td></tr>
<tr><td style="padding:8px 32px 0;font-size:20px;line-height:28px;font-weight:600;">Dein Anmeldecode</td></tr>
<tr><td style="padding:8px 32px 0;font-size:14px;line-height:22px;color:#5c5c57;">${escapeHtml(intro)}</td></tr>
<tr><td style="padding:20px 32px;">
<div style="background:#f4f4f2;border-radius:6px;padding:16px 0;text-align:center;font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;line-height:40px;font-weight:600;letter-spacing:8px;color:#1b1b1a;">${escapeHtml(spaced)}</div>
</td></tr>
<tr><td style="padding:0 32px;font-size:14px;line-height:22px;color:#5c5c57;">${escapeHtml(linkIntro)}</td></tr>
<tr><td style="padding:16px 32px 8px;">
<a href="${url}" style="display:inline-block;background:#1b1b1a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;line-height:20px;padding:12px 20px;border-radius:6px;">Bei Slider anmelden</a>
</td></tr>
<tr><td style="padding:16px 32px 32px;font-size:12px;line-height:18px;color:#8a8a84;">${escapeHtml(outro)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  };
}
