import type { SetupStatus } from '@slider/shared';

/*
 * The legal templates (BER-141) are filled in once, for imprint and privacy policy together:
 * `{{key}}` is a field, `{{#key}}…{{/key}}` is kept only when the option (or the field) `key` is
 * on, `{{^key}}…{{/key}}` only when it is off. A field left empty stays as `[its label]`, a gap
 * the editor offers to fill later – as in texts saved before the templates had fields.
 */

export interface TemplateField {
  key: string;
  label: string;
  hint?: string;
  /** Asked only while this option is on. */
  when?: TemplateOptionKey;
  optional?: boolean;
}

export const TEMPLATE_FIELDS = [
  { key: 'name', label: 'Name oder Firma' },
  { key: 'street', label: 'Straße und Hausnummer' },
  { key: 'city', label: 'PLZ und Ort' },
  { key: 'email', label: 'E-Mail-Adresse' },
  { key: 'phone', label: 'Telefon', optional: true },
  { key: 'vatId', label: 'USt-IdNr.', hint: 'Nur wenn vorhanden (§ 27a UStG)', optional: true },
  {
    key: 'authority',
    label: 'Zuständige Aufsichtsbehörde',
    hint: 'Die Datenschutzbehörde deines Bundeslands, z. B. Bayerisches Landesamt für Datenschutzaufsicht',
  },
  {
    key: 'hoster',
    label: 'Hosting-Anbieter',
    hint: 'Mit Sitz, z. B. Hetzner Online GmbH (Gunzenhausen, Deutschland)',
  },
  {
    key: 'mailer',
    label: 'E-Mail-Versand über',
    hint: 'Mit Sitz, z. B. Brevo (Sendinblue SAS, Frankreich)',
    when: 'mail',
  },
  { key: 'oidcProvider', label: 'Anbieter des Firmen-Logins', when: 'oidc' },
  { key: 'nextcloudOperator', label: 'Betreiber der Nextcloud', when: 'nextcloud' },
  {
    key: 'backupDays',
    label: 'Backups überschrieben nach (Tagen)',
    hint: 'Wie lange gelöschte Daten noch in Sicherungen stehen',
  },
  { key: 'date', label: 'Stand' },
] as const satisfies readonly TemplateField[];

export type TemplateFieldKey = (typeof TEMPLATE_FIELDS)[number]['key'];

export const TEMPLATE_OPTIONS = [
  {
    key: 'microsoft',
    label: 'Anmeldung mit Microsoft',
    description: 'Mit OneDrive und SharePoint',
  },
  { key: 'google', label: 'Anmeldung mit Google', description: 'Mit Google Drive' },
  { key: 'oidc', label: 'Firmen-Login (SSO)' },
  { key: 'nextcloud', label: 'Nextcloud' },
  { key: 'mail', label: 'E-Mails', description: 'Login-Links, Einladungen, Erinnerungen' },
  {
    key: 'domains',
    label: 'Beitritt per E-Mail-Domain',
    description: '„Neue Konten“ nicht nur mit Einladung',
  },
  { key: 'deleteUnused', label: 'Ungenutzte Daten löschen', description: 'Nach 18 Monaten' },
  { key: 'payments', label: 'Bezahlter Plan über Stripe' },
  { key: 'stockPhotos', label: 'Fotosuche über Unsplash' },
  { key: 'cloudflare', label: 'Cloudflare vor dem Server' },
] as const;

export type TemplateOptionKey = (typeof TEMPLATE_OPTIONS)[number]['key'];

export type TemplateValues = Record<TemplateFieldKey, string>;
export type TemplateOptions = Record<TemplateOptionKey, boolean>;

/** The options as this instance is set up, and the fields its settings already know. */
export function templateDefaults(
  settings: NonNullable<SetupStatus['settings']> | undefined,
  today = new Date(),
): { values: TemplateValues; options: TemplateOptions } {
  const field = (key: keyof NonNullable<SetupStatus['settings']>['fields']) =>
    settings?.fields[key];
  const set = (key: Parameters<typeof field>[0]) => field(key)?.set ?? false;
  const nextcloudUrl = field('NEXTCLOUD_URL')?.value;
  return {
    values: {
      name: '',
      street: '',
      city: '',
      email: '',
      phone: '',
      vatId: '',
      authority: '',
      hoster: 'Hetzner Online GmbH (Gunzenhausen, Deutschland)',
      mailer: 'Brevo (Sendinblue SAS, Frankreich)',
      oidcProvider: field('OIDC_LABEL')?.value ?? '',
      nextcloudOperator: nextcloudUrl ? hostOf(nextcloudUrl) : '',
      backupDays: '7',
      date: today.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }),
    },
    options: {
      microsoft: set('MS_CLIENT_ID'),
      google: set('GOOGLE_CLIENT_ID'),
      oidc: set('OIDC_ISSUER'),
      nextcloud: set('NEXTCLOUD_CLIENT_ID') || set('NEXTCLOUD_URL'),
      mail: set('SMTP_URL'),
      domains: (field('SIGNUP')?.value ?? 'open') !== 'invite',
      deleteUnused: !['false', '0'].includes(field('DELETE_UNUSED')?.value ?? ''),
      payments: settings?.features.payments ?? false,
      stockPhotos: settings?.features.stockPhotos ?? false,
      cloudflare: true,
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A block; the line break after its end goes with it only when it is taken out. */
const BLOCK = /\{\{([#^])(\w+)\}\}\n?([\s\S]*?)\{\{\/\2\}\}(\n?)/g;
const FIELD = /\{\{(\w+)\}\}/g;

/** The template with the options and fields of this instance. */
export function fillTemplate(
  template: string,
  values: Partial<TemplateValues>,
  options: Partial<TemplateOptions>,
): string {
  const on = (key: string) =>
    Boolean(options[key as TemplateOptionKey]) || Boolean(values[key as TemplateFieldKey]?.trim());
  let text = template;
  // Inner blocks first, until none is left – blocks of different keys may nest.
  for (let previous = ''; previous !== text;) {
    previous = text;
    text = text.replace(BLOCK, (_, sign: string, key: string, inner: string, after: string) =>
      // A block on lines of its own already ends its line: list items stay one list.
      (sign === '#') === on(key) ? (inner.endsWith('\n') ? inner : inner + after) : '',
    );
  }
  text = text.replace(FIELD, (whole, key: string) => {
    const field = TEMPLATE_FIELDS.find((item) => item.key === key);
    if (!field) return whole;
    return values[field.key]?.trim() || `[${field.label}]`;
  });
  return tidy(text);
}

/** At most one empty line in a row, none at the ends. */
function tidy(text: string): string {
  return `${text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

/** `[…]` still to fill, each once, in order – never a link's `[text](…)`. */
const GAP = /\[([^[\]\n]{1,400})\](?!\()/g;

export function findGaps(text: string): string[] {
  return [...new Set([...text.matchAll(GAP)].map((match) => match[0]))];
}

/** Puts `value` in place of every `gap`; an empty value takes the gap out. */
export function fillGap(text: string, gap: string, value: string): string {
  const filled = text.split(gap).join(value.trim());
  return value.trim() ? filled : tidy(filled);
}
