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

/** For tests: keeps every message. */
export class RecordingMailer implements Mailer {
  readonly configured = true;
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export const createMailer = (config: SmtpConfig | null, log: Logger): Mailer =>
  config ? new SmtpMailer(config) : new NullMailer(log);

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
