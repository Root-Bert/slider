import { createTransport, type Transporter } from 'nodemailer';
import type { SmtpConfig } from '../config';
import type { Logger } from '../logger';
import { LOGO_PNG_BASE64 } from './logo';

/** An image the HTML part shows through `cid:<cid>`. */
export interface InlineImage {
  cid: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

/** Outgoing e-mail: invitations to an organisation or a shared deck. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: InlineImage[];
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

const LOGO_CID = 'slider-logo';
const logo: InlineImage = {
  cid: LOGO_CID,
  filename: 'slider.png',
  contentType: 'image/png',
  content: Buffer.from(LOGO_PNG_BASE64, 'base64'),
};

/**
 * Colours of the web app's dark theme (`apps/web/src/styles/index.css`) as solid hex – white at
 * fixed opacities over the canvas, since not every mail client blends `rgba`.
 */
const C = {
  canvas: '#000000',
  card: '#141414', // glass-solid
  hairline: '#262626', // white 8 % on the card
  tile: '#212121', // white 6 % – the logo tile of the login card
  fg: '#e6e6e6', // white 90 % – also the primary button
  muted: '#b8b8b8', // white 70 %
  subtle: '#8a8a8a', // white 50 %
  faint: '#545454', // white 30 %
  onPrimary: '#000000',
};
const FONT =
  "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The mark at `width` px (22×18 proportions); `inline` centres it in a table cell. */
const mark = (width: number, inline = false) =>
  `<img src="cid:${LOGO_CID}" width="${width}" height="${Math.round((width * 18) / 22)}" alt="" style="display:${inline ? 'inline-block;vertical-align:middle' : 'block'};border:0;outline:none;">`;

/**
 * A short German mail in Slider's look: black canvas, the word mark, a dark card like the login
 * page with the mark in a tile, one white button and the plain link as fallback. Marked dark-only
 * (`color-scheme`), so Apple Mail and Gmail don't invert it. The mark travels inline (`cid:`).
 */
export function inviteMail(input: {
  to: string;
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
    subject: input.subject,
    text: `${input.intro}\n\n${input.button}: ${input.url}\n\n${input.outro}\n\n– Slider\n`,
    attachments: [logo],
    html: `<!doctype html>
<html lang="de" style="color-scheme:dark;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.canvas};color-scheme:dark;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.canvas}" style="background:${C.canvas};font-family:${FONT};">
<tr><td align="center" style="padding:40px 16px 48px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
<tr><td style="padding:0 4px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:8px;vertical-align:middle;">${mark(22)}</td>
<td style="vertical-align:middle;font-size:18px;line-height:24px;font-weight:600;letter-spacing:-0.01em;color:${C.fg};">Slider</td>
</tr></table>
</td></tr>
<tr><td align="center" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.hairline};border-radius:16px;padding:40px 32px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td align="center" valign="middle" bgcolor="${C.tile}" width="56" height="56" style="width:56px;height:56px;background:${C.tile};border-radius:16px;">${mark(22, true)}</td>
</tr></table>
<h1 style="margin:24px 0 0;font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.01em;color:${C.fg};">${escapeHtml(input.heading)}</h1>
<p style="margin:8px 0 0;font-size:14px;line-height:22px;color:${C.muted};">${escapeHtml(input.intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 0;"><tr>
<td align="center" bgcolor="${C.fg}" style="background:${C.fg};border-radius:12px;">
<a href="${url}" style="display:inline-block;padding:12px 24px;font-size:14px;line-height:20px;font-weight:600;color:${C.onPrimary};text-decoration:none;border-radius:12px;">${escapeHtml(input.button)}</a>
</td>
</tr></table>
<p style="margin:28px 0 0;font-size:12px;line-height:18px;color:${C.subtle};">${escapeHtml(input.outro)}</p>
<p style="margin:12px 0 0;font-size:12px;line-height:18px;color:${C.faint};word-break:break-all;">Button geht nicht? <a href="${url}" style="color:${C.subtle};text-decoration:underline;">${url}</a></p>
</td></tr>
<tr><td align="center" style="padding:24px 4px 0;font-size:12px;line-height:18px;color:${C.faint};">Slider · Folien teilen, Feedback direkt auf der Folie.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  };
}
