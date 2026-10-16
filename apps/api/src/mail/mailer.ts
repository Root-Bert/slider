import { createTransport, type Transporter } from 'nodemailer';
import type { SmtpConfig } from '../config';
import type { Logger } from '../logger';

/** Outgoing e-mail: invitations to an organisation or a shared deck. */
export interface MailMessage {
  to: string;
  /** Answers go here, e.g. to the person who invited – the sender address has no mailbox. */
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  /** `false` when no SMTP server is configured – the invite link is then shown to copy. */
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

/**
 * Development without SMTP: logs every mail (with its link) to the console instead of sending
 * it, so invitations can be tried right away. Never used in production.
 */
export class DevMailer implements Mailer {
  readonly configured = true;
  constructor(private readonly log: Logger) {}

  async send(message: MailMessage): Promise<void> {
    this.log.info(
      [
        `[dev mail] to ${message.to}: ${message.subject}`,
        ...message.text
          .trim()
          .split('\n')
          .map((line) => `  ${line}`),
      ].join('\n'),
    );
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

/** For tests: a mail server that refuses everything. */
export class FailingMailer implements Mailer {
  readonly configured = true;

  async send(): Promise<void> {
    throw new Error('SMTP refused');
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

/** A short German mail with a heading and one button; plain text and HTML. */
export function inviteMail(input: {
  to: string;
  replyTo?: string;
  subject: string;
  heading: string;
  intro: string;
  button: string;
  url: string;
  outro: string;
}): MailMessage {
  const url = escapeHtml(input.url);
  return {
    to: input.to,
    replyTo: input.replyTo,
    subject: input.subject,
    text: `${input.intro}\n\n${input.button}: ${input.url}\n\n${input.outro}\n`,
    html: `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b1b1a;">
<tr><td style="padding:32px 32px 8px;font-size:15px;font-weight:600;letter-spacing:-0.01em;">Slider</td></tr>
<tr><td style="padding:8px 32px 0;font-size:20px;line-height:28px;font-weight:600;">${escapeHtml(input.heading)}</td></tr>
<tr><td style="padding:8px 32px 0;font-size:14px;line-height:22px;color:#5c5c57;">${escapeHtml(input.intro)}</td></tr>
<tr><td style="padding:24px 32px 8px;">
<a href="${url}" style="display:inline-block;background:#1b1b1a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;line-height:20px;padding:12px 20px;border-radius:6px;">${escapeHtml(input.button)}</a>
</td></tr>
<tr><td style="padding:16px 32px 32px;font-size:12px;line-height:18px;color:#8a8a84;">${escapeHtml(input.outro)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  };
}
