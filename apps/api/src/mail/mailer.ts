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
  /** `dot-grid`: white 14 % dots, 1px, every 22px. */
  dots: 'rgba(255,255,255,0.14)',
  hairline: '#1f1f1f', // white ~12 % edge of the card on the canvas
  fg: '#e6e6e6', // white 90 %
  muted: '#b3b3b3', // white 70 %
  subtle: '#808080', // white 50 %
  faint: '#4d4d4d', // white 30 %
  /** Primary button: white 90 % with black text. */
  primary: '#e6e6e6',
  onPrimary: '#000000',
};
const FONT =
  "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * The mark at `width` px (22×18 proportions). The size is set in CSS too – Apple Mail ignores the
 * attributes and would show the 3× PNG at full size.
 */
const mark = (width: number) => {
  const height = Math.round((width * 18) / 22);
  return `<img src="cid:${LOGO_CID}" width="${width}" height="${height}" alt="" style="display:block;width:${width}px;height:${height}px;max-width:${width}px;border:0;outline:none;">`;
};

/**
 * A short German mail with Slider's look inside one card: the app canvas with its dot grid, the
 * word mark (`Logo`), heading, the white primary button and the plain link as fallback; around it
 * the client's own background. `color-scheme: light dark` tells clients the card needs no
 * inverting. The mark travels inline (`cid:`). Gmail drops CSS gradients, so it shows the card
 * without dots.
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
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT};">
<tr><td align="center" style="padding:32px 16px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;">
<tr><td align="center" bgcolor="${C.canvas}" style="background-color:${C.canvas};background-image:radial-gradient(${C.dots} 1px,transparent 1.2px);background-size:22px 22px;border:1px solid ${C.hairline};border-radius:16px;padding:36px 32px 32px;box-shadow:0 8px 32px rgba(0,0,0,0.12);">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:8px;vertical-align:middle;">${mark(22)}</td>
<td style="vertical-align:middle;font-size:18px;line-height:24px;font-weight:600;letter-spacing:-0.01em;color:${C.fg};">Slider</td>
</tr></table>
<h1 style="margin:32px 0 0;font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.01em;color:${C.fg};">${escapeHtml(input.heading)}</h1>
<p style="margin:8px 0 0;font-size:14px;line-height:22px;color:${C.muted};">${escapeHtml(input.intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:36px auto 0;"><tr>
<td align="center" bgcolor="${C.primary}" style="background-color:${C.primary};border-radius:12px;">
<a href="${url}" style="display:inline-block;padding:13px 20px;font-size:14px;line-height:18px;font-weight:500;color:${C.onPrimary};text-decoration:none;border-radius:12px;">${escapeHtml(input.button)}</a>
</td>
</tr></table>
<p style="margin:36px 0 0;font-size:12px;line-height:18px;color:${C.subtle};">${escapeHtml(input.outro)}</p>
<p style="margin:12px 0 0;font-size:12px;line-height:18px;color:${C.faint};word-break:break-all;">Button geht nicht? <a href="${url}" style="color:${C.subtle};text-decoration:underline;">${url}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
  };
}
