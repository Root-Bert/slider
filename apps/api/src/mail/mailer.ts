import { flatten, THEME } from '@slider/shared';
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

/** Outgoing e-mail: invitations to a workspace or a shared deck. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: InlineImage[];
  /** Where a reply goes, e.g. the sender of a contact message. */
  replyTo?: string;
}

export interface Mailer {
  /** `false` when no SMTP server is configured – the invite link is then shown to copy. */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

/**
 * Invites wait for the mail inside the request, so a blocked port (many hosters drop outgoing
 * 25/465) must fail within seconds – nodemailer's defaults wait 2 minutes, longer than proxies
 * like Cloudflare keep the request open. The invite stands either way; the link is shown.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
};

/** Sends through SMTP (`SMTP_URL`, e.g. `smtps://user:pass@host:465`). */
export class SmtpMailer implements Mailer {
  readonly configured = true;
  private readonly transport: Transporter;

  constructor(
    private readonly config: SmtpConfig,
    timeouts: typeof SMTP_TIMEOUTS = SMTP_TIMEOUTS,
  ) {
    this.transport = createTransport({ url: config.url, ...timeouts });
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
 * Colours of the web app's dark theme (`THEME` in `@slider/shared`, mirroring
 * `apps/web/src/styles/index.css`) as solid hex – white at fixed opacities flattened over the
 * canvas, since not every mail client blends `rgba`.
 */
const C = {
  canvas: THEME.canvas,
  /** `dot-grid`: white 14 % dots, 1px, every 22px. */
  dots: `rgba(255,255,255,${THEME.dot})`,
  // White ~12 % edge of the card on the canvas – brighter than the app's hairline (8 %), kept as
  // its own value so the card still reads in mail clients.
  hairline: '#1f1f1f',
  fg: flatten(THEME.fg.fg), // #e6e6e6
  muted: flatten(THEME.fg.muted), // #b3b3b3
  subtle: flatten(THEME.fg.subtle), // #808080
  faint: flatten(THEME.fg.faint), // #4d4d4d
  /** Primary button: white 90 % with black text. */
  primary: flatten(THEME.fg.fg),
  onPrimary: '#000000',
  /**
   * The reviews page's hover halo, as far as mail allows: no blur filter in mail clients, so a
   * soft white box-shadow around the button – brighter on hover where clients honour `<style>`.
   */
  glow: '0 0 28px rgba(255,255,255,0.45),0 0 72px rgba(255,255,255,0.22)',
  glowHover: '0 0 32px rgba(255,255,255,0.65),0 0 96px rgba(255,255,255,0.32)',
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
  /**
   * A line with imprint and privacy policy of the instance the button leads to, below the card
   * (BER-141). Only invites need it: the invitee's address came from someone else, so the first
   * mail has to point to the privacy policy (Art. 14 DSGVO). Everyone else has an account.
   */
  legalLinks?: boolean;
}): MailMessage {
  const url = escapeHtml(input.url);
  const origin = new URL(input.url).origin;
  const imprint = escapeHtml(`${origin}/impressum`);
  const privacy = escapeHtml(`${origin}/datenschutz`);
  return {
    to: input.to,
    subject: input.subject,
    text: `${input.intro}\n\n${input.button}: ${input.url}\n\n${input.outro}\n\n– Slider\n${input.legalLinks ? `Impressum: ${origin}/impressum | Datenschutz: ${origin}/datenschutz\n` : ''}`,
    attachments: [logo],
    html: `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.subject)}</title>
<style>
.slider-button{transition:box-shadow .3s}
.slider-button:hover{box-shadow:${C.glowHover}!important}
</style>
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
<td class="slider-button" align="center" bgcolor="${C.primary}" style="background-color:${C.primary};border-radius:12px;box-shadow:${C.glow};">
<a href="${url}" style="display:inline-block;padding:13px 20px;font-size:14px;line-height:18px;font-weight:500;color:${C.onPrimary};text-decoration:none;border-radius:12px;">${escapeHtml(input.button)}</a>
</td>
</tr></table>
<p style="margin:36px 0 0;font-size:12px;line-height:18px;color:${C.subtle};">${escapeHtml(input.outro)}</p>
<p style="margin:12px 0 0;font-size:12px;line-height:18px;color:${C.faint};word-break:break-all;">Button geht nicht? <a href="${url}" style="color:${C.subtle};text-decoration:underline;">${url}</a></p>
</td></tr>
${
  input.legalLinks
    ? `<tr><td align="center" style="padding:16px 0 0;font-size:12px;line-height:18px;color:${C.subtle};"><a href="${imprint}" style="color:${C.subtle};text-decoration:underline;">Impressum</a> | <a href="${privacy}" style="color:${C.subtle};text-decoration:underline;">Datenschutz</a></td></tr>\n`
    : ''
}</table>
</td></tr>
</table>
</body>
</html>`,
  };
}
